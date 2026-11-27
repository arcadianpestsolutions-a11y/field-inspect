// Chemical register: the screen over chem-register.js.
//
// A period, the list, and two ways out: a spreadsheet (every column) and a
// printable page (the columns an officer reads, landscape). Unsigned reports
// are listed, marked, and counted at the top, because a record that exists
// only as a draft is the one that goes missing.
(() => {
  'use strict';

  const view = document.getElementById('view-chem-register');
  if (!view) return;

  const { escapeHtml } = window.Common;
  const periodEl = document.getElementById('chem-period');
  const fromEl = document.getElementById('chem-from');
  const toEl = document.getElementById('chem-to');
  const bodyEl = document.getElementById('chem-body');
  const csvBtn = document.getElementById('chem-csv-btn');
  const printBtn = document.getElementById('chem-print-btn');
  const backBtn = document.getElementById('chem-back-btn');
  const openBtn = document.getElementById('open-chem-register-btn');
  const R = () => window.ChemRegister;

  const PERIODS = [
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
    { key: 'this-quarter', label: 'This quarter' },
    { key: 'this-fy', label: 'This financial year' },
    { key: 'last-fy', label: 'Last financial year' },
    { key: 'last-3-years', label: 'Last 3 years (the legal minimum)' },
    { key: 'all', label: 'Everything' },
    { key: 'custom', label: 'Pick dates…' },
  ];
  const PERIOD_KEY = 'scope.chem.period';

  function rangeFor(key) {
    if (key === 'last-3-years') {
      const now = new Date();
      const from = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()).getTime();
      return { from, to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1 };
    }
    return window.Reporting.periodRange(key);
  }

  // The date boxes always show what is being listed. Picking a period fills
  // them; typing a date switches the period to "Pick dates".
  function fillDates(range) {
    const lo = range.from > 0 ? range.from : null;
    const hi = range.to < Number.MAX_SAFE_INTEGER ? range.to : null;
    fromEl.value = lo == null ? '' : R().isoDay(lo);
    toEl.value = hi == null ? '' : R().isoDay(hi);
  }
  function currentRange() {
    const lo = R().dayMs(fromEl.value);
    const hi = R().dayMs(toEl.value);
    return {
      from: Number.isFinite(lo) ? lo : 0,
      // Inclusive of the whole last day.
      to: Number.isFinite(hi) ? hi + 86400000 - 1 : Number.MAX_SAFE_INTEGER,
    };
  }
  const fmtDay = (iso) => {
    const ms = R().dayMs(iso);
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
  };
  function rangeText() {
    const a = fromEl.value ? fmtDay(fromEl.value) : 'the start';
    const b = toEl.value ? fmtDay(toEl.value) : 'today';
    return `${a} to ${b}`;
  }

  let rows = [];

  async function refresh() {
    const [reports, jobs] = await Promise.all([DB.getAllReports(), DB.getJobs()]);
    const provider = window.Org ? window.Org.provider() : {};
    rows = R().build({ reports, jobs, provider, ...currentRange() });
    render();
  }

  function render() {
    const s = R().summarise(rows);
    csvBtn.disabled = !rows.length;
    printBtn.disabled = !rows.length;
    const parts = [];
    parts.push(`
      <div class="card chem-summary">
        <div class="chem-summary-figure">${s.applications}</div>
        <div class="chem-summary-label">${s.applications === 1 ? 'application' : 'applications'} on ${s.jobs} ${s.jobs === 1 ? 'job' : 'jobs'}</div>
        <div class="chem-summary-range">${escapeHtml(rangeText())}</div>
        ${s.unsignedJobs ? `<p class="chem-warn">⚠ ${s.unsignedJobs} ${s.unsignedJobs === 1 ? 'report is' : 'reports are'} not signed yet. The law gives you 48 hours to make the record: open ${s.unsignedJobs === 1 ? 'it' : 'them'} and sign.</p>` : ''}
        ${s.incomplete ? `<p class="chem-warn">⚠ ${s.incomplete} ${s.incomplete === 1 ? 'line is' : 'lines are'} missing the amount, the area, the date or a licence number.</p>` : ''}
      </div>`);
    if (!rows.length) {
      parts.push('<p class="business-note">No chemicals recorded in these dates. Products go in on the treatment report, under Chemicals / Products Used.</p>');
    } else {
      let day = null;
      parts.push('<ul class="chem-list">');
      for (const r of rows) {
        if (r.date !== day) {
          day = r.date;
          parts.push(`<li class="chem-day">${escapeHtml(fmtDay(r.date))}</li>`);
        }
        const amount = [r.totalApplied, r.concentrateUsed ? `${r.concentrateUsed} concentrate` : ''].filter(Boolean).join(' · ');
        const when = [r.startTime, r.finishTime].filter(Boolean).join('–');
        parts.push(`
          <li>
            <button type="button" class="chem-row${r.signed ? '' : ' chem-unsigned'}" data-job="${escapeHtml(r.jobId)}">
              <span class="chem-row-product">${escapeHtml(r.productName)}${r.activeConstituent ? ` <span class="chem-dim">(${escapeHtml(r.activeConstituent)})</span>` : ''}</span>
              <span class="chem-row-amount">${escapeHtml(amount || 'amount not recorded')}</span>
              <span class="chem-row-where">${escapeHtml(r.propertyAddress || 'No address')}${r.areaApplied ? ` · ${escapeHtml(r.areaApplied)}` : ''}</span>
              <span class="chem-row-meta">${escapeHtml([when, r.applicatorName, r.signed ? '' : 'NOT SIGNED'].filter(Boolean).join(' · '))}</span>
            </button>
          </li>`);
      }
      parts.push('</ul>');
    }
    parts.push(`<p class="business-note">Kept for ${R().RETENTION_YEARS} years: a signed report with chemicals on it cannot be deleted until ${R().RETENTION_YEARS} years after the service date. The spreadsheet has every column the NSW record needs; the printed page has the main ones.</p>`);
    bodyEl.innerHTML = parts.join('');
  }

  function fileStem() {
    return `chemical-register-${fromEl.value || 'start'}-to-${toEl.value || R().isoDay(Date.now())}`;
  }

  function downloadCsv() {
    if (!rows.length) return;
    const blob = new Blob(['﻿' + R().toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileStem() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const PRINT_STYLE = `
    @page { size: A4 landscape; margin: 10mm; }
    body { font: 9pt/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0 8px; }
    h1 { font-size: 14pt; margin: 8px 0 2px; }
    .meta { color: #444; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 3px 4px; text-align: left; vertical-align: top; }
    th { background: #eee; font-size: 8pt; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .unsigned td { background: #fff4e5; }
    .foot { margin-top: 8px; color: #444; font-size: 8pt; }
    @media print { .no-print { display: none; } }`;

  function buildPrintHtml() {
    const prov = window.Org ? window.Org.provider() : {};
    const s = R().summarise(rows);
    const esc = escapeHtml;
    const body = rows.map((r) => `
      <tr class="${r.signed ? '' : 'unsigned'}">
        <td>${esc(r.date)}<br>${esc([r.startTime, r.finishTime].filter(Boolean).join('–'))}</td>
        <td>${esc(r.propertyAddress)}<br><small>${esc(r.ownerDetails)}${r.occupierDetails ? '<br>Occupier: ' + esc(r.occupierDetails) : ''}</small></td>
        <td>${esc(r.situation)}</td>
        <td><b>${esc(r.productName)}</b><br><small>${esc(r.activeConstituent)}</small></td>
        <td>${esc(r.areaApplied)}</td>
        <td>${esc([r.concentrateUsed, r.dilutionRate].filter(Boolean).join(' at '))}</td>
        <td>${esc(r.totalApplied)}</td>
        <td>${esc(r.batchNumber)}</td>
        <td>${esc(r.equipment)}</td>
        <td>${esc(r.weather)}${r.outdoorSpray === 'Yes' ? `<br>Wind ${esc(r.windSpeed)} km/h ${esc(r.windDirection)}${r.temperature ? `, ${esc(r.temperature)}°C` : ''}${r.windChanges ? '<br>' + esc(r.windChanges) : ''}` : ''}</td>
        <td>${esc(r.applicatorName)}<br><small>Lic ${esc(r.applicatorLicence)}<br>${esc(r.applicatorContact)}</small></td>
        <td>${r.signed ? esc(R().isoDay(r.signedAt)) : '<b>NOT SIGNED</b>'}</td>
      </tr>`).join('');
    return `
      <h1>Pesticide application register</h1>
      <p class="meta">${esc(prov.providerName || '')}${prov.providerAbn ? ' · ABN ' + esc(prov.providerAbn) : ''}${prov.providerLicence ? ' · Licence ' + esc(prov.providerLicence) : ''}${prov.providerAddress ? ' · ' + esc(prov.providerAddress) : ''}${prov.providerPhone ? ' · ' + esc(prov.providerPhone) : ''}<br>
        ${esc(rangeText())} · ${s.applications} applications on ${s.jobs} jobs · printed ${esc(new Date().toLocaleString('en-AU'))}</p>
      <table>
        <thead><tr>
          <th>Date / time</th><th>Property and owner</th><th>Situation of use</th><th>Product</th><th>Area applied</th>
          <th>Rate</th><th>Total applied</th><th>Batch</th><th>Equipment</th><th>Weather</th><th>Applicator</th><th>Signed</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <p class="foot">From the treatment reports in Scope. Each report's own PDF is the full record of that job.</p>`;
  }

  function printRegister() {
    if (!rows.length) return;
    const w = window.open('', '_blank');
    if (!w) { if (window.appToast) window.appToast('Allow pop-ups to print the register'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(fileStem())}</title>
      <style>${PRINT_STYLE}</style></head><body>
      <p class="no-print"><button onclick="window.print()">Print / Save as PDF</button></p>
      ${buildPrintHtml()}</body></html>`);
    w.document.close();
  }

  async function open() {
    if (!periodEl.options.length) {
      for (const p of PERIODS) {
        const o = document.createElement('option');
        o.value = p.key;
        o.textContent = p.label;
        periodEl.appendChild(o);
      }
      let saved = 'this-month';
      try { saved = localStorage.getItem(PERIOD_KEY) || saved; } catch (e) { /* private window */ }
      periodEl.value = PERIODS.some((p) => p.key === saved && p.key !== 'custom') ? saved : 'this-month';
      fillDates(rangeFor(periodEl.value));
    }
    await refresh();
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  periodEl.addEventListener('change', () => {
    if (periodEl.value === 'custom') { fromEl.focus(); return; }
    try { localStorage.setItem(PERIOD_KEY, periodEl.value); } catch (e) { /* private window */ }
    fillDates(rangeFor(periodEl.value));
    refresh();
  });
  for (const el of [fromEl, toEl]) {
    el.addEventListener('change', () => { periodEl.value = 'custom'; refresh(); });
  }
  csvBtn.addEventListener('click', downloadCsv);
  printBtn.addEventListener('click', printRegister);
  bodyEl.addEventListener('click', (e) => {
    const row = e.target.closest('.chem-row');
    if (row && row.dataset.job && window.showJobViewById) window.showJobViewById(row.dataset.job);
  });
  backBtn.addEventListener('click', () => {
    if (window.showJobListView) window.showJobListView();
  });
  if (openBtn) openBtn.addEventListener('click', open);

  window.ChemRegisterUI = { open, refresh, buildPrintHtml, rows: () => rows.slice() };
})();
