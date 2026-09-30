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

  const escapeHtml = (s) => (window.FormRender ? window.FormRender.escapeHtml(s) : String(s == null ? '' : s));
  const money = (cents) => (window.Invoicing
    ? window.Invoicing.formatMoney(cents)
    : `$${((cents || 0) / 100).toFixed(2)}`);

  // Remembered between visits, because somebody who thinks in financial
  // years does not want to re-pick it every time.
  const PERIOD_KEY = 'scope.business.period';
  function savedPeriod() {
    try { return localStorage.getItem(PERIOD_KEY) || 'this-fy'; } catch (e) { return 'this-fy'; }
  }
  function rememberPeriod(key) {
    try { localStorage.setItem(PERIOD_KEY, key); } catch (e) { /* private window — not worth a message */ }
  }

  function tile(label, value, sub, tone) {
    return `
      <div class="stat-tile${tone ? ' stat-' + tone : ''}">
        <span class="stat-value">${escapeHtml(value)}</span>
        <span class="stat-label">${escapeHtml(label)}</span>
        ${sub ? `<span class="stat-sub">${escapeHtml(sub)}</span>` : ''}
      </div>`;
  }

  function plural(n, one, many) {
    return n === 1 ? one : (many || one + 's');
  }

  function render(summary) {
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
                <span class="business-list-name">${escapeHtml(j.name || 'Job')}</span>
                <span class="business-list-meta">${j.daysAgo === 0 ? 'today' : `${j.daysAgo} ${plural(j.daysAgo, 'day')} ago`}</span>
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
        ${tile('Invoiced', money(m.invoicedCents), `${m.invoicedCount} ${plural(m.invoicedCount, 'invoice')}`)}
        ${tile('Still drafts', money(m.draftCents), `${m.draftCount} not sent yet`, m.draftCount ? 'warn' : null)}
        ${tile('Outstanding', money(m.outstandingCents), `${m.outstandingCount} sent, unpaid`)}
        ${tile('Overdue', money(m.overdueCents), `${m.overdueCount} past the due date`, m.overdueCount ? 'bad' : null)}
      </div>
      <p class="business-note">
        Invoiced and drafts come from Scope. <strong>Paid and overdue come from Xero</strong>, and are only as
        fresh as the last time each invoice was synced — an invoice paid this morning will still read as
        outstanding here until it syncs.
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
        ${tile('Waiting to book', String(u.unbooked), 'jobs with no time set', u.unbooked ? 'warn' : null)}
      </div>`);

    bodyEl.innerHTML = parts.join('');
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
