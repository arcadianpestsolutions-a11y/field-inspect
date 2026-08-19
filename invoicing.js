// Invoice model and money arithmetic.
//
// Kept deliberately separate from the Xero client (xero.js): an invoice is a
// real document in its own right, and must be creatable, printable and
// emailable whether or not Xero is connected or reachable. Xero is a
// destination for an invoice, not the source of truth for one.
//
// MONEY IS HANDLED IN WHOLE CENTS, as integers, everywhere except the moment
// it's displayed or sent. Doing GST in floating-point dollars produces the
// classic 0.1 + 0.2 problem — a $181.50 invoice whose lines sum to $181.49 —
// and an invoice that doesn't add up is worse than no invoice at all.
(() => {
  'use strict';

  const GST_RATE = 0.10; // Australia, 10%

  function centsFromInput(value) {
    const n = Number(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function formatMoney(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(Math.round(cents));
    return `${sign}$${Math.floor(abs / 100).toLocaleString('en-AU')}.${String(abs % 100).padStart(2, '0')}`;
  }

  // GST is computed per line and then summed, rather than computed once on the
  // subtotal. Xero rounds per line too, so doing it any other way produces an
  // invoice whose total disagrees with the same invoice in Xero by a cent or
  // two — which is exactly the sort of thing a bookkeeper has to chase down.
  function lineSubtotalCents(line) {
    const qty = Number(line.quantity);
    const unit = Number(line.unitAmountCents);
    if (!Number.isFinite(qty) || !Number.isFinite(unit)) return 0;
    return Math.round(qty * unit);
  }

  function lineGstCents(line, gstRegistered) {
    if (!gstRegistered || line.taxExempt) return 0;
    return Math.round(lineSubtotalCents(line) * GST_RATE);
  }

  function computeTotals(invoice) {
    const gstRegistered = invoice.gstRegistered !== false;
    const lines = invoice.lineItems || [];
    let subtotal = 0;
    let gst = 0;
    for (const line of lines) {
      subtotal += lineSubtotalCents(line);
      gst += lineGstCents(line, gstRegistered);
    }
    return { subtotalCents: subtotal, gstCents: gst, totalCents: subtotal + gst, gstRegistered };
  }

  // Sensible starting lines for a new invoice, by job type. The technician
  // edits these — they're a starting point, not a price list. Last-used
  // amounts are remembered per job type below so the second invoice of a kind
  // is close to a one-tapper.
  const DEFAULT_LINES = {
    termite: [{ description: 'Timber Pest Inspection and Report (AS 4349.3-2010)', quantity: 1 }],
    pest_treatment: [{ description: 'General Pest Treatment', quantity: 1 }],
  };

  const RATE_MEMORY_KEY = 'field-inspect-last-rates';

  function rememberRates(jobType, lineItems) {
    try {
      const all = JSON.parse(localStorage.getItem(RATE_MEMORY_KEY) || '{}');
      all[jobType || 'termite'] = (lineItems || []).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmountCents: l.unitAmountCents,
        taxExempt: !!l.taxExempt,
      }));
      localStorage.setItem(RATE_MEMORY_KEY, JSON.stringify(all));
    } catch (e) {
      // A full or disabled localStorage must never break invoicing.
      console.warn('[invoicing] could not remember rates:', e.message || e);
    }
  }

  function recallRates(jobType) {
    try {
      const all = JSON.parse(localStorage.getItem(RATE_MEMORY_KEY) || '{}');
      const remembered = all[jobType || 'termite'];
      return Array.isArray(remembered) && remembered.length ? remembered : null;
    } catch (e) {
      return null;
    }
  }

  // Dates here are calendar dates in the technician's own timezone, never
  // instants. toISOString() converts to UTC first, so in Australia (UTC+10/11)
  // it reports the PREVIOUS day for anything before ~10am local — an invoice
  // raised at 8am would be dated yesterday, and a 14-day term would land a day
  // early. Formatting from the local components avoids the conversion.
  function toLocalISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayISO() { return toLocalISODate(new Date()); }

  function addDaysISO(iso, days) {
    const d = new Date(iso + 'T00:00:00'); // local midnight
    d.setDate(d.getDate() + days);
    return toLocalISODate(d);
  }

  // Invoice numbers are per-device sequential with a year prefix. Xero assigns
  // its own number on import, so this is our reference, not the accounting
  // one — which is why a clash across two technicians' phones is survivable.
  function nextInvoiceNumber(existingInvoices) {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    let highest = 0;
    for (const inv of existingInvoices || []) {
      if (!inv.number || !inv.number.startsWith(prefix)) continue;
      const n = parseInt(inv.number.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > highest) highest = n;
    }
    return prefix + String(highest + 1).padStart(4, '0');
  }

  function buildDraftInvoice(job, report, existingInvoices) {
    const jobType = (job && job.jobType) || 'termite';
    const remembered = recallRates(jobType);
    const lineItems = (remembered || DEFAULT_LINES[jobType] || DEFAULT_LINES.termite).map((l) => ({
      id: DB.uid(),
      description: l.description || '',
      quantity: Number.isFinite(Number(l.quantity)) ? Number(l.quantity) : 1,
      unitAmountCents: Number.isFinite(Number(l.unitAmountCents)) ? Number(l.unitAmountCents) : 0,
      taxExempt: !!l.taxExempt,
    }));

    const clientDetails = (report && report.sections && report.sections.clientDetails) || {};
    const issueDate = todayISO();

    return {
      id: DB.uid(),
      jobId: job.id,
      number: nextInvoiceNumber(existingInvoices),
      issueDate,
      dueDate: addDaysISO(issueDate, 14),
      clientName: clientDetails.clientName || job.name || '',
      clientEmail: clientDetails.clientEmail || job.clientEmail || '',
      propertyAddress: clientDetails.propertyAddress || job.address || '',
      reference: job.name || '',
      lineItems,
      gstRegistered: true,
      status: 'draft',
      xeroInvoiceId: null,
      xeroStatus: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  window.Invoicing = {
    GST_RATE,
    centsFromInput,
    formatMoney,
    lineSubtotalCents,
    lineGstCents,
    computeTotals,
    buildDraftInvoice,
    nextInvoiceNumber,
    rememberRates,
    recallRates,
    addDaysISO,
    todayISO,
  };
})();
