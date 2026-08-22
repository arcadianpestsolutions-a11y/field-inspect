// Invoice screen — create, edit, total, push to Xero, email, print.
//
// Deliberately usable with Xero disconnected: an invoice can still be built,
// saved, printed and emailed. Xero is one destination for a finished invoice,
// not a prerequisite for having one.
(() => {
  'use strict';

  const I = window.Invoicing;
  if (!I) { console.warn('[invoice-ui] invoicing.js not loaded'); return; }

  const view = document.getElementById('view-invoice');
  if (!view) { console.warn('[invoice-ui] invoice view missing from the page'); return; }

  const el = (id) => document.getElementById(id);
  const backBtn = el('invoice-back-btn');
  const printBtn = el('invoice-print-btn');
  const subtitle = el('invoice-subtitle');
  const clientNameInput = el('invoice-client-name');
  const clientEmailInput = el('invoice-client-email');
  const propertyInput = el('invoice-property');
  const issueDateInput = el('invoice-issue-date');
  const dueDateInput = el('invoice-due-date');
  const linesWrap = el('invoice-lines');
  const addLineBtn = el('invoice-add-line');
  const subtotalEl = el('invoice-subtotal');
  const gstEl = el('invoice-gst');
  const gstRow = el('invoice-gst-row');
  const totalEl = el('invoice-total');
  const gstCheckbox = el('invoice-gst-registered');
  const xeroStateEl = el('invoice-xero-state');
  const saveBtn = el('invoice-save-btn');
  const xeroBtn = el('invoice-xero-btn');
  const emailBtn = el('invoice-email-btn');

  let current = null;   // the invoice being edited
  let returnToJobId = null;

  const toast = (msg) => (window.appToast ? window.appToast(msg) : console.log(msg));
  const show = (e) => e.classList.remove('hidden');
  const hide = (e) => e.classList.add('hidden');

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // ---------- rendering ----------
  function renderTotals() {
    const totals = I.computeTotals(current);
    subtotalEl.textContent = I.formatMoney(totals.subtotalCents);
    gstEl.textContent = I.formatMoney(totals.gstCents);
    totalEl.textContent = I.formatMoney(totals.totalCents);
    gstRow.classList.toggle('hidden', !totals.gstRegistered);
  }

  function renderLines() {
    linesWrap.innerHTML = '';
    if (!current.lineItems.length) {
      linesWrap.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty-hint',
        textContent: 'No line items yet — tap "+ Add line".',
      }));
    }

    current.lineItems.forEach((line, idx) => {
      const card = document.createElement('div');
      card.className = 'invoice-line';

      const head = document.createElement('div');
      head.className = 'invoice-line-head';
      head.appendChild(Object.assign(document.createElement('span'), { textContent: `Line ${idx + 1}` }));
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'product-card-remove';
      removeBtn.textContent = '✕ Remove';
      removeBtn.addEventListener('click', () => {
        current.lineItems.splice(idx, 1);
        renderLines();
        renderTotals();
      });
      head.appendChild(removeBtn);
      card.appendChild(head);

      const descRow = document.createElement('div');
      descRow.className = 'product-card-field';
      descRow.appendChild(Object.assign(document.createElement('label'), { textContent: 'Description' }));
      const desc = document.createElement('input');
      desc.type = 'text';
      desc.value = line.description || '';
      desc.addEventListener('input', () => { line.description = desc.value; });
      descRow.appendChild(desc);
      card.appendChild(descRow);

      const numRow = document.createElement('div');
      numRow.className = 'row gap';

      const qtyWrap = document.createElement('div');
      qtyWrap.className = 'product-card-field flex1';
      qtyWrap.appendChild(Object.assign(document.createElement('label'), { textContent: 'Qty' }));
      const qty = document.createElement('input');
      qty.type = 'number';
      qty.min = '0';
      qty.step = '0.01';
      qty.value = line.quantity;
      qty.addEventListener('input', () => {
        const n = Number(qty.value);
        line.quantity = Number.isFinite(n) ? n : 0;
        renderTotals();
      });
      qtyWrap.appendChild(qty);
      numRow.appendChild(qtyWrap);

      const amtWrap = document.createElement('div');
      amtWrap.className = 'product-card-field flex1';
      amtWrap.appendChild(Object.assign(document.createElement('label'), { textContent: 'Unit price (ex GST)' }));
      const amt = document.createElement('input');
      amt.type = 'text';
      amt.inputMode = 'decimal';
      amt.placeholder = '0.00';
      amt.value = line.unitAmountCents ? (line.unitAmountCents / 100).toFixed(2) : '';
      // Parse on input so the running total tracks typing, but don't reformat
      // the field mid-keystroke — that fights the cursor. Tidy up on blur.
      amt.addEventListener('input', () => {
        line.unitAmountCents = I.centsFromInput(amt.value);
        renderTotals();
      });
      amt.addEventListener('blur', () => {
        amt.value = line.unitAmountCents ? (line.unitAmountCents / 100).toFixed(2) : '';
      });
      amtWrap.appendChild(amt);
      numRow.appendChild(amtWrap);
      card.appendChild(numRow);

      const exemptLabel = document.createElement('label');
      exemptLabel.className = 'checkbox-chip';
      const exempt = document.createElement('input');
      exempt.type = 'checkbox';
      exempt.checked = !!line.taxExempt;
      exempt.addEventListener('change', () => { line.taxExempt = exempt.checked; renderTotals(); });
      exemptLabel.appendChild(exempt);
      exemptLabel.appendChild(document.createTextNode('GST-free line'));
      card.appendChild(exemptLabel);

      const lineTotal = document.createElement('div');
      lineTotal.className = 'invoice-line-total';
      lineTotal.textContent = I.formatMoney(I.lineSubtotalCents(line));
      card.appendChild(lineTotal);

      linesWrap.appendChild(card);
    });
  }

  async function renderXeroState() {
    // The invoice view is reused for every invoice, so the button has to be
    // reset each time: without this it keeps whatever label the previously
    // opened invoice left on it, and a fresh draft reads "Already sent to
    // Xero".
    xeroBtn.textContent = 'Send to Xero as draft';
    xeroBtn.disabled = false;

    // Whether this invoice reached Xero is a fact about the invoice, not about
    // this device — so it's reported before anything is asked of the local
    // Xero client. Otherwise an invoice that was pushed weeks ago reads
    // "Xero not configured" on a phone that hasn't connected Xero, or offline.
    if (current.xeroInvoiceId) {
      xeroStateEl.innerHTML =
        `<span class="xero-pill xero-on">In Xero as ${escapeHtml(current.xeroStatus || 'DRAFT')}</span>`;
      xeroBtn.textContent = 'Already sent to Xero';
      xeroBtn.disabled = true;
      return;
    }
    if (!window.Xero) {
      xeroStateEl.innerHTML = '<span class="xero-pill xero-off">Xero not configured</span>';
      xeroBtn.disabled = true;
      return;
    }
    xeroBtn.disabled = false;
    xeroBtn.textContent = 'Send to Xero as draft';
    try {
      const s = await window.Xero.status();
      xeroStateEl.innerHTML = s.connected
        ? `<span class="xero-pill xero-on">Xero connected — ${escapeHtml(s.tenantName || 'organisation')}</span>`
        : '<span class="xero-pill xero-off">Xero not connected</span>' +
          `<a class="xero-connect-link" href="${escapeHtml(s.authorizeUrl)}">Connect Xero</a>`;
    } catch (err) {
      xeroStateEl.innerHTML = `<span class="xero-pill xero-off">${escapeHtml(err.message || 'Xero unavailable')}</span>`;
    }
  }

  function renderAll() {
    subtitle.textContent = `${current.number} · ${current.clientName || 'Unnamed client'}`;
    clientNameInput.value = current.clientName || '';
    clientEmailInput.value = current.clientEmail || '';
    propertyInput.value = current.propertyAddress || '';
    issueDateInput.value = current.issueDate || '';
    dueDateInput.value = current.dueDate || '';
    gstCheckbox.checked = current.gstRegistered !== false;
    renderLines();
    renderTotals();
    renderXeroState();
  }

  // ---------- field wiring ----------
  clientNameInput.addEventListener('input', () => { current.clientName = clientNameInput.value; });
  clientEmailInput.addEventListener('input', () => { current.clientEmail = clientEmailInput.value; });
  propertyInput.addEventListener('input', () => { current.propertyAddress = propertyInput.value; });
  issueDateInput.addEventListener('input', () => { current.issueDate = issueDateInput.value; });
  dueDateInput.addEventListener('input', () => { current.dueDate = dueDateInput.value; });
  gstCheckbox.addEventListener('change', () => { current.gstRegistered = gstCheckbox.checked; renderTotals(); });

  addLineBtn.addEventListener('click', () => {
    current.lineItems.push({ id: DB.uid(), description: '', quantity: 1, unitAmountCents: 0, taxExempt: false });
    renderLines();
    renderTotals();
  });

  async function save() {
    current = await DB.saveInvoice(current);
    // Remember what was charged so the next invoice of this kind starts close
    // to done — the second one should be nearly a single tap.
    const job = await DB.getJob(current.jobId);
    I.rememberRates(job && job.jobType, current.lineItems);
    return current;
  }

  saveBtn.addEventListener('click', async () => {
    await save();
    toast('Invoice saved');
  });

  backBtn.addEventListener('click', async () => {
    await save();
    hide(view);
    if (returnToJobId && window.showJobViewById) window.showJobViewById(returnToJobId);
    else if (window.showJobListView) window.showJobListView();
  });

  xeroBtn.addEventListener('click', async () => {
    if (!window.Xero) { toast('Xero is not configured.'); return; }
    const totals = I.computeTotals(current);
    if (totals.totalCents <= 0) { toast('Add at least one line with an amount before sending to Xero.'); return; }
    if (!current.clientName.trim()) { toast('Enter who the invoice is billed to first.'); return; }

    // Pushing into a real accounting system is not undoable from here, so it
    // is always an explicit confirmation naming the amount and the client.
    const ok = confirm(
      `Create a DRAFT invoice in Xero?\n\n${current.number}\n${current.clientName}\n${I.formatMoney(totals.totalCents)} incl GST\n\n` +
      `It will not be sent to the client — you review and send it from Xero.`
    );
    if (!ok) return;

    await save();
    xeroBtn.disabled = true;
    xeroBtn.textContent = 'Sending to Xero…';
    try {
      const result = await window.Xero.createInvoice(current);
      current.xeroInvoiceId = result.xeroInvoiceId;
      current.xeroStatus = result.xeroStatus;
      current.status = 'sent';
      await DB.saveInvoice(current);
      toast(`Draft created in Xero (${result.xeroInvoiceNumber || current.number})`);
    } catch (err) {
      toast('Xero: ' + (err.message || err));
    } finally {
      renderXeroState();
    }
  });

  emailBtn.addEventListener('click', async () => {
    if (!window.EmailService) { toast('Email sending is not set up.'); return; }
    const to = (current.clientEmail || '').trim();
    if (!to) { toast('Add the client email address first.'); return; }
    const totals = I.computeTotals(current);
    if (!confirm(`Email ${current.number} for ${I.formatMoney(totals.totalCents)} to ${to}?`)) return;

    await save();
    emailBtn.disabled = true;
    const originalLabel = emailBtn.textContent;
    emailBtn.textContent = 'Sending…';
    try {
      const pdfBlob = await generateInvoicePdfBlob();
      await window.EmailService.sendReportEmail({
        recipientEmail: to,
        recipientName: current.clientName,
        jobName: `${current.number}`,
        documentKind: 'invoice',
        pdfBlob,
      });
      toast('Invoice emailed to ' + to);
    } catch (err) {
      toast('Could not email the invoice: ' + (err.message || err));
    } finally {
      emailBtn.disabled = false;
      emailBtn.textContent = originalLabel;
    }
  });

  // ---------- printable / PDF ----------
  const INVOICE_STYLE = `
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:28px;}
    .brand{font-weight:bold;font-size:20px;color:#c0552a;}
    h1{font-size:26px;margin:6px 0 2px;}
    .muted{color:#666;font-size:13px;}
    .meta{display:flex;justify-content:space-between;margin:22px 0;gap:24px;}
    table{width:100%;border-collapse:collapse;margin-top:10px;}
    th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666;border-bottom:2px solid #ddd;padding:8px 6px;}
    td{padding:9px 6px;border-bottom:1px solid #eee;font-size:14px;}
    td.num,th.num{text-align:right;}
    .totals{margin-left:auto;margin-top:16px;width:280px;}
    .totals div{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;}
    .totals .grand{border-top:2px solid #333;font-weight:bold;font-size:17px;padding-top:10px;}
    @media print{.no-print{display:none;}}
  `;

  function buildInvoiceHtml() {
    const totals = I.computeTotals(current);
    const rows = current.lineItems.map((l) => `
      <tr>
        <td>${escapeHtml(l.description || '')}${l.taxExempt ? ' <span class="muted">(GST-free)</span>' : ''}</td>
        <td class="num">${escapeHtml(String(l.quantity))}</td>
        <td class="num">${I.formatMoney(l.unitAmountCents)}</td>
        <td class="num">${I.formatMoney(I.lineSubtotalCents(l))}</td>
      </tr>`).join('');

    return `
      <div class="brand">ARCADIAN PEST SOLUTIONS</div>
      <h1>Tax Invoice</h1>
      <div class="muted">${escapeHtml(current.number)}</div>
      <div class="meta">
        <div>
          <div class="muted">Bill to</div>
          <div><strong>${escapeHtml(current.clientName || '')}</strong></div>
          <div class="muted">${escapeHtml(current.propertyAddress || '')}</div>
          <div class="muted">${escapeHtml(current.clientEmail || '')}</div>
        </div>
        <div>
          <div class="muted">Issued: ${escapeHtml(current.issueDate || '')}</div>
          <div class="muted">Due: ${escapeHtml(current.dueDate || '')}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div><span>Subtotal</span><span>${I.formatMoney(totals.subtotalCents)}</span></div>
        ${totals.gstRegistered ? `<div><span>GST (10%)</span><span>${I.formatMoney(totals.gstCents)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${I.formatMoney(totals.totalCents)}</span></div>
      </div>
    `;
  }

  printBtn.addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print the invoice'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(current.number)}</title>
      <style>${INVOICE_STYLE}</style></head><body>
      <p><button class="no-print" onclick="window.print()">Print / Save as PDF</button></p>
      ${buildInvoiceHtml()}</body></html>`);
    w.document.close();
  });

  // Same on-screen-overlay approach report.js uses — html2canvas captures from
  // real viewport position, so an off-screen element rasterizes blank.
  async function generateInvoicePdfBlob() {
    if (!window.html2pdf) throw new Error('PDF library not loaded');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow:auto;';
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.margin = '0 auto';
    const style = document.createElement('style');
    style.textContent = INVOICE_STYLE;
    container.appendChild(style);
    const content = document.createElement('div');
    content.innerHTML = buildInvoiceHtml();
    container.appendChild(content);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return await window.html2pdf()
        .set({ margin: 10, filename: current.number + '.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'pt', format: 'a4' } })
        .from(container)
        .outputPdf('blob');
    } finally {
      document.body.removeChild(overlay);
    }
  }

  // ---------- public entry ----------
  window.InvoiceUI = {
    // Opens the newest invoice for a job, or builds a fresh draft.
    async open(jobId) {
      returnToJobId = jobId;
      const job = await DB.getJob(jobId);
      if (!job) return;
      const existing = await DB.getInvoicesForJob(jobId);
      if (existing.length) {
        current = existing[0];
      } else {
        const report = await DB.getReport(jobId);
        current = I.buildDraftInvoice(job, report, await DB.getAllInvoices());
        current = await DB.saveInvoice(current);
      }
      renderAll();
      if (window.hideAllAppViews) window.hideAllAppViews();
      else document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
      show(view);
    },
  };
})();
