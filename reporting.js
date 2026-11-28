// Business reporting — what the year actually looked like, from the records
// already on the device.
//
// Pure: jobs, reports and invoices go in, numbers come out. No DOM, no
// database, injectable clock. Same shape as availability.js and routing.js,
// and for the same reason — a number that decides whether somebody chases an
// invoice is worth a test.
//
// THE HEADLINE IS WORK DONE AND NOT YET INVOICED.
// Every other figure here is a record of something that already happened.
// That one is money sitting on the table right now, it is entirely knowable
// from local records, and in a one-person business it is the number most
// likely to be wrong — because invoicing happens in the evening, after a day
// that ran late, and a job finished on a Friday is a job nobody billed.
//
// WHAT IS AND IS NOT RELIABLE, STATED PLAINLY.
// Scope knows what it invoiced, because it wrote the invoice. It does NOT
// know what was paid: that lives in Xero, arrives on the record as
// xeroStatus, and is only as fresh as the last time that invoice was pushed
// or opened. So paid and overdue are reported as coming from Xero rather than
// presented as facts of their own, and nothing here silently treats an
// unsynced invoice as unpaid.
//
// The financial year is 1 July to 30 June. This is an Australian business and
// a January-to-December "year to date" would be the wrong answer to every
// question a BAS or a tax agent asks.
(() => {
  'use strict';

  const FY_START_MONTH = 6; // July, zero-based

  const PERIODS = [
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
    { key: 'this-quarter', label: 'This quarter' },
    { key: 'this-fy', label: 'This financial year' },
    { key: 'last-fy', label: 'Last financial year' },
    { key: 'all', label: 'All time' },
  ];

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // The financial year a date falls in, named by the year it starts in:
  // 30 June 2027 is FY2026, 1 July 2027 is FY2027.
  function fyStartYear(d) {
    return d.getMonth() >= FY_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  }

  function periodRange(key, nowMs) {
    const now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
    const y = now.getFullYear();
    const m = now.getMonth();

    switch (key) {
      case 'this-month':
        return { from: new Date(y, m, 1).getTime(), to: new Date(y, m + 1, 1).getTime() - 1 };
      case 'last-month':
        return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() - 1 };
      case 'this-quarter': {
        // Calendar quarters, which is what a BAS is lodged on.
        const q = Math.floor(m / 3) * 3;
        return { from: new Date(y, q, 1).getTime(), to: new Date(y, q + 3, 1).getTime() - 1 };
      }
      case 'this-fy': {
        const s = fyStartYear(now);
        return { from: new Date(s, FY_START_MONTH, 1).getTime(), to: new Date(s + 1, FY_START_MONTH, 1).getTime() - 1 };
      }
      case 'last-fy': {
        const s = fyStartYear(now) - 1;
        return { from: new Date(s, FY_START_MONTH, 1).getTime(), to: new Date(s + 1, FY_START_MONTH, 1).getTime() - 1 };
      }
      case 'all':
      default:
        return { from: 0, to: Number.MAX_SAFE_INTEGER };
    }
  }

  function periodLabel(key, nowMs) {
    const now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
    if (key === 'this-fy') { const s = fyStartYear(now); return `FY ${s}–${String(s + 1).slice(2)}`; }
    if (key === 'last-fy') { const s = fyStartYear(now) - 1; return `FY ${s}–${String(s + 1).slice(2)}`; }
    const found = PERIODS.find((p) => p.key === key);
    return found ? found.label : 'All time';
  }

  const inRange = (ts, range) => typeof ts === 'number' && ts >= range.from && ts <= range.to;

  function totalCents(invoice) {
    if (!window.Invoicing) return 0;
    try { return window.Invoicing.computeTotals(invoice).totalCents; } catch (e) { return 0; }
  }

  // An ISO date string ('2026-09-30') compared against a clock. Parsed as a
  // local date, not through Date.parse, which reads a bare ISO date as UTC
  // and makes a Sydney morning fall on the previous day.
  function isoToLocalMs(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).getTime();
  }

  // Paid is Xero's word, or "Mark as paid" for money that never went through
  // Xero (v121). Before v157 only Xero counted here, so cash marked paid by
  // hand sat in Outstanding and Overdue for ever.
  const isPaid = (inv) => window.Invoicing.isPaid(inv);
  // Sent means the client has been asked for the money, or it is in Xero. An
  // invoice emailed straight from Scope kept status 'draft' until v157, so for
  // a business without Xero nothing ever reached Outstanding.
  const isSent = (inv) => inv.status === 'sent' || !!inv.emailedAt || !!inv.xeroInvoiceId;
  const isVoided = (inv) => String(inv.xeroStatus || '').toUpperCase() === 'VOIDED';

  // What the diary calls "Waiting to be booked" (v165): new jobs with no time,
  // and properties due within 30 days (or overdue) that nobody has booked.
  // Business figures said "Waiting to book 0" while the diary listed 2, because
  // it counted only the first kind. One rule now, used by both screens.
  function waitingToBook(jobs, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const soon = t + 30 * 86400000;
    return (jobs || []).filter((j) => {
      if (j.scheduledAt && j.status !== 'completed') return false;
      if (j.followUp && j.followUp.stoppedAt) return false;
      if (j.status === 'completed' && !j.nextDueAt) return false;
      if (j.nextDueAt) return j.nextDueAt <= soon;
      return j.status !== 'completed';
    });
  }

  // One line per invoice for the lists behind the money tiles (v165).
  function invoiceLine(inv, now) {
    const due = isoToLocalMs(inv.dueDate);
    const state = isPaid(inv) ? 'paid' : isSent(inv) ? 'sent' : 'draft';
    return {
      id: inv.id,
      jobId: inv.jobId || null,
      number: inv.number || '',
      name: inv.clientName || inv.propertyAddress || '',
      totalCents: totalCents(inv),
      state,
      paidAt: inv.paidAt || null,
      paidMethod: inv.paidMethod || '',
      dueDate: inv.dueDate || '',
      overdueDays: state === 'sent' && due !== null && due < startOfDay(new Date(now)).getTime()
        ? Math.floor((startOfDay(new Date(now)).getTime() - due) / 86400000) : 0,
      createdAt: inv.createdAt || 0,
    };
  }

  function summarise(opts) {
    const o = opts || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const periodKey = o.period || 'this-fy';
    const range = periodRange(periodKey, now);

    const jobs = o.jobs || [];
    const reports = o.reports || [];
    const invoices = (o.invoices || []).filter((i) => !isVoided(i));

    // ---- work done ----
    // A job counts as done when its inspection ended, falling back to the
    // report being finalised. Its status alone is not enough: 'completed' has
    // no date on it, so it cannot be put in a period.
    const doneAt = (job) => {
      if (job.inspectionEndedAt) return job.inspectionEndedAt;
      const rep = reports.find((r) => r.jobId === job.id);
      return (rep && rep.finalizedAt) || null;
    };
    const completed = jobs.filter((j) => inRange(doneAt(j), range));
    const byType = {
      termite: completed.filter((j) => j.jobType !== 'pest_treatment').length,
      pest_treatment: completed.filter((j) => j.jobType === 'pest_treatment').length,
    };
    const finalisedReports = reports.filter((r) => inRange(r.finalizedAt, range));
    const byDocument = {};
    for (const r of finalisedReports) {
      const key = r.documentType || 'timber_pest_inspection';
      byDocument[key] = (byDocument[key] || 0) + 1;
    }

    // ---- money ----
    const invoicedInPeriod = invoices.filter((i) => inRange(i.createdAt, range));
    const invoicedCents = invoicedInPeriod.reduce((sum, i) => sum + totalCents(i), 0);
    const drafts = invoicedInPeriod.filter((i) => !isSent(i) && !isPaid(i));
    const draftCents = drafts.reduce((sum, i) => sum + totalCents(i), 0);
    const paid = invoicedInPeriod.filter(isPaid);
    const paidCents = paid.reduce((sum, i) => sum + totalCents(i), 0);

    // Outstanding and overdue are deliberately NOT restricted to the period.
    // An invoice from April that is still unpaid in October is the whole
    // point of the number, and a period filter would hide it.
    const outstanding = invoices.filter((i) => isSent(i) && !isPaid(i));
    const overdue = outstanding.filter((i) => {
      const due = isoToLocalMs(i.dueDate);
      return due !== null && due < startOfDay(new Date(now)).getTime();
    });

    // ---- the headline: done and not billed ----
    // Restricted to completed work, because a job still in progress is not
    // late to be invoiced. Counted rather than valued: Scope has no price for
    // a job until somebody writes the invoice, and inventing one would make
    // this figure a guess dressed as a total.
    const invoicedJobIds = new Set(invoices.map((i) => i.jobId).filter(Boolean));
    const notInvoiced = jobs
      .filter((j) => doneAt(j) && !invoicedJobIds.has(j.id))
      .sort((a, b) => (doneAt(b) || 0) - (doneAt(a) || 0));
    const oldestNotInvoicedDays = notInvoiced.length
      ? Math.floor((now - doneAt(notInvoiced[notInvoiced.length - 1])) / 86400000)
      : 0;

    // ---- what is coming ----
    const DAY = 86400000;
    // Booked means booked on a job not yet done: a finished job keeps its
    // old booking time as history (v162; it hid every diary-booked property
    // from these counts). Chasing stopped (offboarded) is not owed either.
    const booked = (j) => !!j.scheduledAt && j.status !== 'completed';
    const chased = (j) => j.nextDueAt && !booked(j) && !(j.followUp && j.followUp.stoppedAt);
    const dueWithin = (days) => jobs.filter((j) =>
      chased(j) && j.nextDueAt > now && j.nextDueAt <= now + days * DAY).length;
    const overdueForReinspection = jobs.filter((j) => chased(j) && j.nextDueAt <= now);
    // The ones the automatic path has already been spent on: an email went
    // out for this due date, the date has passed, and nothing was booked.
    // That is the list that needs a person to pick up the phone.
    const needsACall = overdueForReinspection.filter((j) => j.reminderSentForDueAt === j.nextDueAt);
    const unbooked = waitingToBook(jobs, now).length;

    // ---- time ----
    const bookedInPeriod = jobs.filter((j) => inRange(j.scheduledAt, range));
    const bookedMins = bookedInPeriod.reduce((sum, j) => sum + (j.scheduledDurationMins || 60), 0);
    const daysWithWork = new Set(bookedInPeriod.map((j) => {
      const d = new Date(j.scheduledAt);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    })).size;

    return {
      period: periodKey,
      periodLabel: periodLabel(periodKey, now),
      range,

      work: {
        completed: completed.length,
        byType,
        reportsFinalised: finalisedReports.length,
        byDocument,
      },

      money: {
        invoicedCents,
        invoicedCount: invoicedInPeriod.length,
        draftCents,
        draftCount: drafts.length,
        paidCents,
        paidCount: paid.length,
        outstandingCents: outstanding.reduce((sum, i) => sum + totalCents(i), 0),
        outstandingCount: outstanding.length,
        overdueCents: overdue.reduce((sum, i) => sum + totalCents(i), 0),
        overdueCount: overdue.length,
        // Said out loud rather than assumed, so a screen built on this can
        // tell the technician where the figure came from.
        paidFrom: 'xero-or-marked',
        // The invoices behind each figure, newest first (v165): the tiles
        // said "2 sent, unpaid" and there was no way to see which two.
        lists: {
          invoiced: invoicedInPeriod.map((i) => invoiceLine(i, now)).sort((a, b) => b.createdAt - a.createdAt),
          paid: paid.map((i) => invoiceLine(i, now)).sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt)),
          drafts: drafts.map((i) => invoiceLine(i, now)).sort((a, b) => b.createdAt - a.createdAt),
          outstanding: outstanding.map((i) => invoiceLine(i, now)).sort((a, b) => b.overdueDays - a.overdueDays || a.createdAt - b.createdAt),
          overdue: overdue.map((i) => invoiceLine(i, now)).sort((a, b) => b.overdueDays - a.overdueDays),
        },
      },

      notInvoiced: {
        count: notInvoiced.length,
        oldestDays: oldestNotInvoicedDays,
        jobs: notInvoiced.slice(0, 20).map((j) => ({
          jobId: j.id, name: j.name, address: j.address || '',
          doneAt: doneAt(j),
          daysAgo: Math.floor((now - doneAt(j)) / DAY),
        })),
      },

      upcoming: {
        dueIn30: dueWithin(30),
        dueIn60: dueWithin(60),
        dueIn90: dueWithin(90),
        overdueForReinspection: overdueForReinspection.length,
        needsACall: needsACall.length,
        unbooked,
      },

      time: {
        bookedMins,
        bookedHours: Math.round(bookedMins / 6) / 10,
        daysWithWork,
        avgMinsPerDay: daysWithWork ? Math.round(bookedMins / daysWithWork) : 0,
      },
    };
  }

  window.Reporting = {
    waitingToBook, PERIODS, periodRange, periodLabel, summarise, fyStartYear };
})();
