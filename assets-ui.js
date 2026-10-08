// Station register screens — which properties have stations, what is at each
// one, what each station has done, and the QR stickers that go on the caps.
//
// The arithmetic is assets.js and is derived from the reports themselves, so
// nothing here can disagree with the register a technician edits on site.
(() => {
  'use strict';

  const listView = document.getElementById('view-assets');
  const propertyView = document.getElementById('view-asset-property');
  const stickerView = document.getElementById('view-asset-stickers');
  if (!listView || !propertyView || !stickerView) return;

  const el = (id) => document.getElementById(id);
  const propertyListEl = el('assets-property-list');
  const stationListEl = el('asset-station-list');
  const titleEl = el('asset-property-title');
  const subtitleEl = el('asset-property-subtitle');
  const stickerSheetEl = el('asset-sticker-sheet');
  const stickerSubtitleEl = el('asset-stickers-subtitle');

  const escapeHtml = window.HtmlSafe.escape;
  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));

  let currentProperty = null;
  let currentAssets = [];

  function show(view) {
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  function fmtDate(ts) {
    if (!ts) return 'never';
    return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function load() {
    const [jobs, reports] = await Promise.all([DB.getJobs(), DB.getAllReports()]);
    return { jobs, reports };
  }

  // ---------- properties ----------
  async function openList() {
    const { jobs, reports } = await load();
    const properties = window.Assets.propertiesWithStations({ jobs, reports });
    propertyListEl.innerHTML = '';

    if (!properties.length) {
      propertyListEl.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty-hint',
        textContent: 'No stations recorded yet. A register appears here once a monitoring or rodent '
          + 'programme has its first visit.',
      }));
      show(listView);
      return;
    }

    for (const p of properties) {
      const li = document.createElement('li');
      li.className = 'report-section-item';
      li.innerHTML = `
        <span class="section-icon" style="background:#7c3aed">🏷</span>
        <span class="section-info">
          <span class="section-name">${escapeHtml(p.name || p.address || 'Property')}</span>
          <span class="section-sub">${p.stationCount} ${p.stationCount === 1 ? 'station' : 'stations'} · last visit ${escapeHtml(fmtDate(p.lastVisitAt))}</span>
        </span>
        <span class="section-status status-dot-green">›</span>`;
      li.addEventListener('click', () => openProperty(p));
      propertyListEl.appendChild(li);
    }
    show(listView);
  }

  // ---------- one property ----------
  async function openProperty(property) {
    const { jobs, reports } = await load();
    currentProperty = property;
    currentAssets = window.Assets.registerFor({ jobs, reports, propertyKey: property.propertyKey });

    titleEl.textContent = property.name || property.address || 'Property';
    subtitleEl.textContent = `${currentAssets.length} ${currentAssets.length === 1 ? 'station' : 'stations'}`;

    stationListEl.innerHTML = '';
    for (const a of currentAssets) {
      const last = a.history[0];
      const li = document.createElement('li');
      li.className = 'report-section-item asset-station';
      // Amber when the last visit found something. A register whose whole
      // point is spotting activity should not make you read every row to
      // find the one that matters.
      const active = last && /activity|taken|damaged|missing/i.test(last.status);
      li.innerHTML = `
        <span class="section-icon" style="background:${active ? '#b45309' : '#1f7a4d'}">${a.kind === 'rodent_station' ? '🐀' : '🪵'}</span>
        <span class="section-info">
          <span class="section-name">Station ${escapeHtml(a.stationNumber || '?')}${a.location ? ` — ${escapeHtml(a.location)}` : ''}</span>
          <span class="section-sub">${last
            ? `${escapeHtml(last.status || 'not recorded')} · ${escapeHtml(fmtDate(last.at))}`
            : 'no visits recorded'}</span>
        </span>
        <span class="section-status ${active ? 'status-dot-yellow' : 'status-dot-green'}">${a.history.length}</span>`;
      li.addEventListener('click', () => toggleHistory(li, a));
      stationListEl.appendChild(li);
    }
    show(propertyView);
  }

  // The history opens under the row rather than on its own screen. It is
  // usually three or four lines, and a screen transition to read three lines
  // is how somebody stops bothering to look.
  function toggleHistory(li, asset) {
    const existing = li.nextElementSibling;
    if (existing && existing.classList.contains('asset-history')) { existing.remove(); return; }
    const row = document.createElement('li');
    row.className = 'asset-history';
    row.innerHTML = asset.history.length
      ? asset.history.map((h) => `
          <div class="asset-history-row">
            <span class="asset-history-date">${escapeHtml(fmtDate(h.at))}</span>
            <span class="asset-history-what">${escapeHtml(h.status || '—')}${h.action ? ` · ${escapeHtml(h.action)}` : ''}</span>
            ${h.note ? `<span class="asset-history-note">${escapeHtml(h.note)}</span>` : ''}
          </div>`).join('')
      : '<div class="asset-history-row"><span class="asset-history-what">Nothing recorded yet.</span></div>';
    li.insertAdjacentElement('afterend', row);
  }

  // ---------- stickers ----------
  function openStickers() {
    if (!currentAssets.length) { toast('No stations to label yet.'); return; }
    if (!window.QRCode) { toast('The QR library did not load. Reopen the app and try again.'); return; }

    stickerSubtitleEl.textContent = `${currentAssets.length} for ${currentProperty.name || currentProperty.address || 'this property'}`;
    stickerSheetEl.innerHTML = '';

    for (const a of currentAssets) {
      const card = document.createElement('div');
      card.className = 'sticker';
      const code = document.createElement('div');
      code.className = 'sticker-qr';
      card.appendChild(code);
      const label = document.createElement('div');
      label.className = 'sticker-label';
      label.innerHTML = `<strong>Station ${escapeHtml(a.stationNumber || '?')}</strong>`
        + (a.location ? `<span>${escapeHtml(a.location)}</span>` : '');
      card.appendChild(label);
      stickerSheetEl.appendChild(card);

      // Error correction H, because this sticker lives inside a bait station
      // cap in a garden bed and will be scuffed, damp and half covered in
      // dirt long before anybody reprints it.
      new window.QRCode(code, {
        text: window.Assets.qrPayload(a.assetId),
        width: 150,
        height: 150,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H,
      });
    }
    show(stickerView);
  }

  el('assets-back-btn').addEventListener('click', () => {
    if (window.showJobListView) window.showJobListView();
  });
  el('asset-property-back-btn').addEventListener('click', openList);
  el('asset-stickers-btn').addEventListener('click', openStickers);
  el('asset-stickers-back-btn').addEventListener('click', () => show(propertyView));
  el('asset-print-btn').addEventListener('click', () => window.print());

  const openBtn = el('open-assets-btn');
  if (openBtn) openBtn.addEventListener('click', openList);

  window.AssetsUI = { open: openList, openProperty, openStickers };
})();
