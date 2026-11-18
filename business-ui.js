// Business figures — the screen over reporting.js.
//
// Every number on it is computed from records already on the device, so
// nothing here can be stale in a way the diary is not. The arithmetic is in
// reporting.js and is tested; this file decides what gets said first and how
// honestly.
//
// WHAT COMES FIRST AND WHY.
// Work done and not yet invoiced leads, because it is the only figure here
// that is money still on the table rather than a record of something that
// already happened. In a one-person business it is also the one most likely
// to be wrong, because invoicing happens in the evening after a day that ran
// late, and a job finished on a Friday is a job nobody billed.
//
// WHERE A NUMBER CAME FROM IS PART OF THE NUMBER.
// Scope knows what it invoiced, because it wrote the invoice. It does not
// know what was paid — that is Xero's, arriving as xeroStatus and only as
// fresh as the last sync. So the paid figure says so on screen rather than
// sitting next to the others pretending to be equally certain.
(() => {
  'use strict';

  const view = document.getElementById('view-business');
  if (!view) return;

  const periodEl = document.getElementById('business-period');
  const periodLabelEl = document.getElementById('business-period-label');
  const bodyEl = document.getElementById('business-body');
  const backBtn = document.getElementById('business-back-btn');
  const openBtn = document.getElementById('open-business-btn');

  const { escapeHtml } = window.Common;
  const { money } = window.Common;

  // Remembered between visits, because somebody who thinks in financial
  // years does not want to re-pick it every time.
  const PERIOD_KEY = 'scope.business.period';
  function savedPeriod() {
    try { return localStorage.getItem(PERIOD_KEY) || 'this-fy'; } catch (e) { return 'this-fy'; }
  }
  function rememberPeriod(key) {
    try { localStorage.setItem(PERIOD_KEY, key); } catch (e) { /* private window — not worth a message */ }
  }

  function tile(label, value, sub, tone, list) {
    // A tile with invoices behind it is a button that lists them (v165).
    const tag = list ? 'button' : 'div';
    return `
      <${tag} class="stat-tile${tone ? ' stat-' + tone : ''}${list ? ' stat-tap' : ''}"${list ? ` type="button" data-list="${list}" aria-expanded="false"` : ''}>
        <span class="stat-value">${escapeHtml(value)}</span>
        <span class="stat-label">${escapeHtml(label)}${list ? ' ›' : ''}</span>
        ${sub ? `<span class="stat-sub">${escapeHtml(sub)}</span>` : ''}
      </${tag}>`;
  }

  const LIST_TITLES = {
    invoiced: 'Invoiced in this period',
    paid: 'Paid in this period',
    drafts: 'Drafts, not sent yet',
    outstanding: 'Sent, not paid yet',
    overdue: 'Past the due date',
  };
  const fmtDue = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };
  function lineMeta(l) {
    if (l.state === 'paid') {
      const when = l.paidAt ? new Date(l.paidAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '';
      return ['Paid', l.paidMethod ? l.paidMethod.toLowerCase() : '', when].filter(Boolean).join(' · ');
    }
    if (l.state === 'draft') return 'Draft, not sent';
    if (l.overdueDays) return `Overdue ${l.overdueDays} ${plural(l.overdueDays, 'day')} (due ${fmtDue(l.dueDate)})`;
    return l.dueDate ? `Sent · due ${fmtDue(l.dueDate)}` : 'Sent';
  }
  function renderList(key) {
    const box = document.getElementById('business-invoice-list');
    if (!box) return;
    const lines = (lastSummary && lastSummary.money.lists && lastSummary.money.lists[key]) || [];
    box.dataset.list = key;
    box.innerHTML = `
      <div class="business-invoice-head">
        <strong>${escapeHtml(LIST_TITLES[key] || 'Invoices')}</strong>
        <span>
          ${lines.length ? '<button type="button" class="link-btn" id="business-invoice-csv">Download for Excel</button>' : ''}
          <button type="button" class="link-btn" id="business-invoice-close">Close</button>
        </span>
      </div>
      ${lines.length ? `<ul class="business-list business-invoices">${lines.map((l) => `
        <li>
          <button type="button" class="business-invoice-row" data-job="${escapeHtml(l.jobId || '')}">
            <span class="business-list-name">${escapeHtml(l.number)} · ${escapeHtml(l.name || 'Invoice')}</span>
            <span class="business-list-meta${l.overdueDays ? ' business-overdue' : ''}">${escapeHtml(lineMeta(l))}</span>
            <span class="business-invoice-amount">${escapeHtml(money(l.totalCents))}</span>
          </button>
        </li>`).join('')}</ul>` : '<p class="business-note">None.</p>'}`;
    box.classList.remove('hidden');
    view.querySelectorAll('.stat-tap').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.list === key)));
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  // The open list as a spreadsheet file (v165): an office admin reconciles in
  // Excel. CSV, because every spreadsheet opens it and it needs no library.
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    // A leading = + - @ would be run as a formula by Excel; quote it as text.
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  function downloadCsv() {
    const box = document.getElementById('business-invoice-list');
    const key = box && box.dataset.list;
    const lines = (key && lastSummary && lastSummary.money.lists[key]) || [];
    if (!lines.length) return;
    const rows = [['Invoice', 'Client', 'Total incl GST', 'Status', 'Due date', 'Days overdue', 'Paid on', 'Paid by']]
      .concat(lines.map((l) => [
        l.number, l.name, (l.totalCents / 100).toFixed(2),
        l.state === 'paid' ? 'Paid' : l.state === 'sent' ? 'Sent, unpaid' : 'Draft',
        l.dueDate, l.overdueDays || '', l.paidAt ? new Date(l.paidAt).toISOString().slice(0, 10) : '', l.paidMethod,
      ]));
    const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scope-invoices-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function closeList() {
    const box = document.getElementById('business-invoice-list');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; delete box.dataset.list; }
    view.querySelectorAll('.stat-tap').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  let lastSummary = null;
  bodyEl.addEventListener('click', (e) => {
    const t = e.target.closest('.stat-tap');
    if (t) {
      const box = document.getElementById('business-invoice-list');
      if (box && box.dataset.list === t.dataset.list) closeList(); else renderList(t.dataset.list);
      return;
    }
    if (e.target.closest('#business-invoice-close')) { closeList(); return; }
    if (e.target.closest('#business-invoice-csv')) { downloadCsv(); return; }
    const row = e.target.closest('.business-invoice-row');
    if (row && row.dataset.job && window.InvoiceUI) window.InvoiceUI.open(row.dataset.job);
  });

  function plural(n, one, many) {
    return n === 1 ? one : (many || one + 's');
  }

  function render(summary) {
    lastSummary = summary;
    const openList = (document.getElementById('business-invoice-list') || {}).dataset;
    const reopen = openList && openList.list;
    const m = summary.money;
    const n = summary.notInvoiced;
    const u = summary.upcoming;
    const w = summary.work;
    const t = summary.time;

    periodLabelEl.textContent = summary.periodLabel;

    const parts = [];

    // ---- the headline ----
    if (n.count) {
      parts.push(`
        <div class="card business-headline">
          <span class="business-headline-value">${n.count}</span>
          <span class="business-headline-label">${plural(n.count, 'job', 'jobs')} finished, not invoiced</span>
          <p class="business-headline-sub">${n.oldestDays
            ? `The oldest was finished ${n.oldestDays} ${plural(n.oldestDays, 'day')} ago.`
            : 'Finished today.'}</p>
          <ul class="business-list">
            ${n.jobs.slice(0, 6).map((j) => `
              <li>
                <button type="button" class="business-invoice-row" data-job="${escapeHtml(j.jobId)}">
                  <span class="business-list-name">${escapeHtml(j.name || 'Job')}</span>
                  <span class="business-list-meta">${j.daysAgo === 0 ? 'today' : `${j.daysAgo} ${plural(j.daysAgo, 'day')} ago`} · tap to invoice</span>
                </button>
              </li>`).join('')}
          </ul>
          ${n.count > 6 ? `<p class="business-headline-sub">and ${n.count - 6} more.</p>` : ''}
        </div>`);
    } else {
      parts.push(`
        <div class="card business-headline business-headline-clear">
          <span class="business-headline-value">✓</span>
          <span class="business-headline-label">Everything finished has been invoiced</span>
        </div>`);
    }

    // ---- money ----
    parts.push(`
      <h2 class="business-heading">Money</h2>
      <div class="stat-grid">
        ${tile('Invoiced', money(m.invoicedCents), `${m.invoicedCount} ${plural(m.invoicedCount, 'invoice')}, incl GST`, null, 'invoiced')}
        ${tile('Paid', money(m.paidCents || 0), `${m.paidCount || 0} of those paid`, null, 'paid')}
        ${tile('Still drafts', money(m.draftCents), `${m.draftCount} not sent yet`, m.draftCount ? 'warn' : null, 'drafts')}
        ${tile('Outstanding', money(m.outstandingCents), `${m.outstandingCount} sent, unpaid (any date)`, null, 'outstanding')}
        ${tile('Overdue', money(m.overdueCents), `${m.overdueCount} past the due date`, m.overdueCount ? 'bad' : null, 'overdue')}
      </div>
      <div id="business-invoice-list" class="card business-invoice-list hidden"></div>
      <p class="business-note">Tap a figure to see the invoices behind it.</p>
      <p class="business-note">
        Invoiced and drafts come from Scope. <strong>Paid comes from Xero</strong>, or from
        "Mark as paid" on the invoice for money taken outside Xero. Xero's figures are only as fresh as
        the last time each invoice was synced, so one paid this morning can still read as outstanding.
      </p>`);

    // ---- work ----
    parts.push(`
      <h2 class="business-heading">Work done</h2>
      <div class="stat-grid">
        ${tile('Jobs finished', String(w.completed), summary.periodLabel)}
        ${tile('Termite', String(w.byType.termite), 'inspections and treatments')}
        ${tile('General pest', String(w.byType.pest_treatment), 'treatments')}
        ${tile('Reports finalised', String(w.reportsFinalised), 'signed off')}
      </div>`);

    // ---- what is coming ----
    parts.push(`
      <h2 class="business-heading">Coming up</h2>
      <div class="stat-grid">
        ${tile('Due in 30 days', String(u.dueIn30), 'not booked yet', u.dueIn30 ? 'warn' : null)}
        ${tile('Due in 90 days', String(u.dueIn90), 'not booked yet')}
        ${tile('Overdue', String(u.overdueForReinspection), 'past due, not booked', u.overdueForReinspection ? 'bad' : null)}
        ${tile('Need a phone call', String(u.needsACall), 'reminded, never rebooked', u.needsACall ? 'bad' : null)}
      </div>
      ${u.needsACall ? `<p class="business-note">
        Those ${u.needsACall} already had the automatic reminder and still did not book. The automatic path
        has been spent on them — the next move is a person.
      </p>` : ''}`);

    // ---- time ----
    parts.push(`
      <h2 class="business-heading">Time</h2>
      <div class="stat-grid">
        ${tile('Hours booked', `${t.bookedHours}`, summary.periodLabel)}
        ${tile('Days worked', String(t.daysWithWork), 'with at least one job')}
        ${tile('Average day', t.avgMinsPerDay ? `${Math.round(t.avgMinsPerDay / 6) / 10} hrs` : '—', 'booked, not counting driving')}
        ${tile('Waiting to book', String(u.unbooked), 'same list as the diary', u.unbooked ? 'warn' : null)}
      </div>`);

    bodyEl.innerHTML = parts.join('');
    if (reopen) renderList(reopen);
  }

  async function refresh() {
    const [jobs, reports, invoices] = await Promise.all([
      DB.getJobs(), DB.getAllReports(), DB.getAllInvoices(),
    ]);
    render(window.Reporting.summarise({
      jobs, reports, invoices, period: periodEl.value,
    }));
  }

  async function open() {
    if (!periodEl.options.length) {
      for (const p of window.Reporting.PERIODS) {
        const o = document.createElement('option');
        o.value = p.key;
        o.textContent = p.label;
        periodEl.appendChild(o);
      }
      periodEl.value = savedPeriod();
    }
    await refresh();
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  periodEl.addEventListener('change', () => {
    rememberPeriod(periodEl.value);
    refresh();
  });
  backBtn.addEventListener('click', () => {
    if (window.showJobListView) window.showJobListView();
  });
  if (openBtn) openBtn.addEventListener('click', open);

  window.BusinessUI = { open, refresh, render };
})();
