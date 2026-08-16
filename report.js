(() => {
  'use strict';

  const { isFieldVisible, computeSectionStatus, defaultValuesForSection } = window.ReportSchemaUtils;
  const SCHEMA = window.REPORT_SCHEMA;

  // ---------- Element refs ----------
  const viewReport = document.getElementById('view-report');
  const viewReportSection = document.getElementById('view-report-section');

  const reportBackBtn = document.getElementById('report-back-btn');
  const reportSubtitle = document.getElementById('report-subtitle');
  const reportExportBtn = document.getElementById('report-export-btn');
  const aiDraftBtn = document.getElementById('ai-draft-btn');
  const reportSectionList = document.getElementById('report-section-list');
  const finalizeBtn = document.getElementById('finalize-report-btn');
  const finalizeHint = document.getElementById('finalize-hint');

  const sectionBackBtn = document.getElementById('section-back-btn');
  const sectionTitleEl = document.getElementById('section-title');
  const sectionSubtitleEl = document.getElementById('section-subtitle');
  const sectionFieldsEl = document.getElementById('report-section-fields');
  const sectionSaveBtn = document.getElementById('section-save-btn');

  // ---------- State ----------
  let currentJobId = null;
  let currentReport = null; // { jobId, sections: {id: {fieldId: value}}, finalizedAt, updatedAt }
  let currentSectionId = null;
  let pendingSectionValues = {};
  const objectUrls = [];

  function trackUrl(url) { objectUrls.push(url); return url; }
  function revokeAllUrls() { while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop()); }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function toast(msg) {
    if (window.appToast) { window.appToast(msg); return; }
    console.log(msg);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function findSection(sectionId) {
    return SCHEMA.find((s) => s.id === sectionId);
  }

  // ---------- Report load / prefill ----------
  async function loadOrCreateReport(jobId) {
    let report = await DB.getReport(jobId);
    if (report) return report;

    const job = await DB.getJob(jobId);
    const sections = {};
    for (const section of SCHEMA) {
      sections[section.id] = defaultValuesForSection(section);
    }
    sections.clientDetails = {
      ...sections.clientDetails,
      clientName: job ? job.name : '',
      clientAddress: job ? job.address : '',
      clientPhone: job ? job.clientPhone : '',
      clientEmail: job ? job.clientEmail : '',
      propertyAddress: job ? job.address : '',
      inspectionDate: job && job.inspectionDate ? job.inspectionDate : todayISO(),
    };
    report = { jobId, sections, finalizedAt: null };
    return report;
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  // ---------- Public entry point ----------
  window.ReportUI = {
    async openReview(jobId) {
      currentJobId = jobId;
      currentReport = await loadOrCreateReport(jobId);
      const job = await DB.getJob(jobId);
      reportSubtitle.textContent = job ? job.name : '';
      renderSectionList();
      hideAllAppViews();
      show(viewReport);
    },
  };

  function hideAllAppViews() {
    document.getElementById('view-joblist').classList.add('hidden');
    document.getElementById('view-job').classList.add('hidden');
    hide(viewReport);
    hide(viewReportSection);
  }

  function renderSectionList() {
    reportSectionList.innerHTML = '';
    let allRequiredGreen = true;

    for (const section of SCHEMA) {
      const values = currentReport.sections[section.id] || {};
      const status = computeSectionStatus(section, values);
      if (status !== 'green' && section.id !== 'acknowledgement') allRequiredGreen = false;

      const li = document.createElement('li');
      li.className = 'report-section-item';
      li.innerHTML = `
        <span class="section-icon" style="background:${section.color}">${section.icon}</span>
        <span class="section-info">
          <span class="section-name">${section.number}. ${escapeHtml(section.title)}</span>
        </span>
        <span class="section-status ${status === 'green' ? 'status-dot-green' : 'status-dot-yellow'}">
          ${status === 'green' ? '✓' : '✎'}
        </span>
      `;
      li.addEventListener('click', () => openSectionEditor(section.id));
      reportSectionList.appendChild(li);
    }

    finalizeBtn.disabled = !allRequiredGreen || !!currentReport.finalizedAt;
    finalizeBtn.textContent = currentReport.finalizedAt ? '✓ Report Finalized' : 'Finalize Report';
    finalizeHint.classList.toggle('hidden', allRequiredGreen);
  }

  reportBackBtn.addEventListener('click', async () => {
    hide(viewReport);
    show(document.getElementById('view-job'));
    if (window.refreshJobViewStatus) await window.refreshJobViewStatus(currentJobId);
  });

  finalizeBtn.addEventListener('click', async () => {
    if (finalizeBtn.disabled) return;
    if (!confirm('Finalize this report? You can still reopen sections to make corrections afterwards.')) return;
    currentReport.finalizedAt = Date.now();
    await DB.saveReport(currentReport);
    await DB.updateJob(currentJobId, { status: 'completed' });
    toast('Report finalized');
    renderSectionList();
    if (window.refreshJobViewStatus) await window.refreshJobViewStatus(currentJobId);
  });

  reportExportBtn.addEventListener('click', () => exportPdf());

  // ---------- Section editor ----------
  function openSectionEditor(sectionId) {
    currentSectionId = sectionId;
    const section = findSection(sectionId);
    pendingSectionValues = { ...(currentReport.sections[sectionId] || {}) };

    sectionTitleEl.textContent = `${section.number}. ${section.title}`;
    sectionSubtitleEl.textContent = section.subtitle || '';

    revokeAllUrls();
    sectionFieldsEl.innerHTML = '';

    if (section.id === 'summary') {
      renderSummary();
    } else if (section.fixed) {
      renderFixedTerms();
    } else {
      for (const field of section.fields) {
        renderField(field);
      }
    }

    hide(viewReport);
    show(viewReportSection);
  }

  function refreshVisibility() {
    const section = findSection(currentSectionId);
    for (const field of section.fields) {
      const row = sectionFieldsEl.querySelector(`[data-field-row="${field.id}"]`);
      if (!row) continue;
      row.classList.toggle('hidden', !isFieldVisible(field, pendingSectionValues));
    }
  }

  function fieldRowWrapper(field) {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.dataset.fieldRow = field.id;
    if (!isFieldVisible(field, pendingSectionValues)) row.classList.add('hidden');
    const labelEl = document.createElement('label');
    labelEl.className = 'field-label';
    labelEl.innerHTML = escapeHtml(field.label) + (field.aiFillable ? ' <span class="ai-badge">AI</span>' : '') +
      (field.required ? ' <span class="required-dot">*</span>' : '');
    row.appendChild(labelEl);
    return row;
  }

  function renderField(field) {
    const row = fieldRowWrapper(field);

    if (field.type === 'static') {
      const val = document.createElement('div');
      val.className = 'field-static';
      val.textContent = field.default || '';
      row.appendChild(val);
    } else if (field.type === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = pendingSectionValues[field.id] || '';
      input.addEventListener('input', () => { pendingSectionValues[field.id] = input.value; });
      row.appendChild(input);
    } else if (field.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = pendingSectionValues[field.id] || '';
      ta.addEventListener('input', () => { pendingSectionValues[field.id] = ta.value; });
      row.appendChild(ta);
    } else if (field.type === 'date') {
      const input = document.createElement('input');
      input.type = 'date';
      input.value = pendingSectionValues[field.id] || '';
      input.addEventListener('input', () => { pendingSectionValues[field.id] = input.value; });
      row.appendChild(input);
    } else if (field.type === 'time') {
      const input = document.createElement('input');
      input.type = 'time';
      input.value = pendingSectionValues[field.id] || '';
      input.addEventListener('input', () => { pendingSectionValues[field.id] = input.value; });
      row.appendChild(input);
    } else if (field.type === 'select') {
      const select = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— Select —';
      select.appendChild(blank);
      for (const opt of field.options) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (pendingSectionValues[field.id] === opt) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener('change', () => {
        pendingSectionValues[field.id] = select.value;
        refreshVisibility();
      });
      row.appendChild(select);
    } else if (field.type === 'yesno') {
      const wrap = document.createElement('div');
      wrap.className = 'yesno-toggle';
      for (const opt of ['Yes', 'No']) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'yesno-btn' + (pendingSectionValues[field.id] === opt ? ' active' : '');
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          pendingSectionValues[field.id] = opt;
          wrap.querySelectorAll('.yesno-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          refreshVisibility();
        });
        wrap.appendChild(btn);
      }
      row.appendChild(wrap);
    } else if (field.type === 'multiselect') {
      const current = new Set(pendingSectionValues[field.id] || []);
      const wrap = document.createElement('div');
      wrap.className = 'multiselect-list';
      for (const opt of field.options) {
        const chip = document.createElement('label');
        chip.className = 'checkbox-chip';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = current.has(opt);
        cb.addEventListener('change', () => {
          if (cb.checked) current.add(opt); else current.delete(opt);
          pendingSectionValues[field.id] = Array.from(current);
        });
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(opt));
        wrap.appendChild(chip);
      }
      row.appendChild(wrap);
    } else if (field.type === 'photos') {
      row.appendChild(renderPhotosField(field));
    } else if (field.type === 'signature') {
      row.appendChild(renderSignatureField(field));
    }

    sectionFieldsEl.appendChild(row);
  }

  function renderPhotosField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'photo-field';
    const grid = document.createElement('div');
    grid.className = 'photo-field-grid';

    const photos = pendingSectionValues[field.id] || [];

    function redrawGrid() {
      grid.innerHTML = '';
      photos.forEach((p, idx) => {
        const tile = document.createElement('div');
        tile.className = 'photo-field-tile';
        const url = trackUrl(URL.createObjectURL(p.blob));
        const img = document.createElement('img');
        img.src = url;
        tile.appendChild(img);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'photo-field-remove';
        del.textContent = '✕';
        del.addEventListener('click', () => {
          photos.splice(idx, 1);
          pendingSectionValues[field.id] = photos;
          redrawGrid();
        });
        tile.appendChild(del);
        grid.appendChild(tile);
      });
    }
    redrawGrid();

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.capture = 'environment';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      photos.push({ id: DB.uid(), blob: file });
      pendingSectionValues[field.id] = photos;
      redrawGrid();
      fileInput.value = '';
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline';
    addBtn.textContent = '📷 Add Photo';
    addBtn.addEventListener('click', () => fileInput.click());

    wrap.appendChild(grid);
    wrap.appendChild(addBtn);
    wrap.appendChild(fileInput);
    return wrap;
  }

  function renderSignatureField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'signature-field';
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 130;
    canvas.className = 'signature-canvas';
    wrap.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let hasSignature = false;
    const existing = pendingSectionValues[field.id];
    if (existing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = existing;
      hasSignature = true;
    }

    let drawing = false;
    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) };
    }
    function start(e) { drawing = true; hasSignature = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
    function move(e) { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
    function end() {
      if (!drawing) return;
      drawing = false;
      pendingSectionValues[field.id] = hasSignature ? canvas.toDataURL('image/png') : '';
    }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-secondary';
    clearBtn.textContent = 'Clear Signature';
    clearBtn.addEventListener('click', () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      hasSignature = false;
      pendingSectionValues[field.id] = '';
    });
    wrap.appendChild(clearBtn);
    return wrap;
  }

  function renderSummary() {
    const s = (id) => currentReport.sections[id] || {};
    const access = s('access');
    const findings = s('findings');
    const conducive = s('conducive');

    const rows = [
      ['Are there any areas that were hindered and access should be gained?', access.hinderedObstructions, 'access'],
      ['Are there any areas that were restricted and access should be gained?', access.restrictedAccess, 'access'],
      ['Are there any areas that are High Risk and access should be gained?', access.highRiskAreas, 'access'],
      ['Were active termites found?', findings.liveTermitesFound, 'findings'],
      ['Was a termite nest located?', findings.nestFound, 'findings'],
      ['Was visible evidence of termite workings or damage found?', findings.workingsFound, 'findings'],
      ['Was visible evidence of damage caused by fungal decay?', conducive.fungalDecayFound, 'conducive'],
      ['Is a termite treatment recommended?', findings.treatmentRecommended, 'findings'],
      ['Susceptibility of this property to termites', findings.susceptibility, 'findings'],
    ];

    const wrap = document.createElement('div');
    wrap.className = 'summary-list';
    for (const [label, value, srcSection] of rows) {
      const flagged = value === 'Yes' || value === 'HIGH' || value === 'MODERATE';
      const row = document.createElement('div');
      row.className = 'summary-row';
      row.innerHTML = `
        <span class="summary-flag ${flagged ? 'flag-red' : 'flag-green'}"></span>
        <span class="summary-label">${escapeHtml(label)}</span>
        <span class="summary-value">${value ? escapeHtml(value) : '—'}</span>
      `;
      row.addEventListener('click', () => openSectionEditor(srcSection));
      wrap.appendChild(row);
    }
    wrap.appendChild(Object.assign(document.createElement('p'), {
      className: 'empty-hint',
      textContent: 'This summary updates automatically from your answers in Findings, Access and Conducive Conditions — tap any row to jump there.',
    }));
    sectionFieldsEl.appendChild(wrap);
  }

  function renderFixedTerms() {
    const wrap = document.createElement('div');
    wrap.className = 'terms-text';
    wrap.innerHTML = `
      <p>This Report does not conclusively determine that the Property is free of Termites and damage caused by Termites. Use of and reliance upon this Report is solely at the reader's own risk.</p>
      <p>The Inspection undertaken was a Non-Invasive Inspection of the Property for evidence of Termites, Termite activity, and damage caused by Termites, carried out in accordance with AS 3660.2-2017.</p>
      <p>This section is fixed and applies to every report — it does not need to be filled in.</p>
    `;
    sectionFieldsEl.appendChild(wrap);
  }

  sectionSaveBtn.addEventListener('click', async () => {
    currentReport.sections[currentSectionId] = pendingSectionValues;
    await DB.saveReport(currentReport);
    hide(viewReportSection);
    renderSectionList();
    show(viewReport);
  });

  sectionBackBtn.addEventListener('click', () => {
    hide(viewReportSection);
    show(viewReport);
  });

  // ---------- PDF export (print view) ----------
  function fmtVal(v) {
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (v === undefined || v === null || v === '') return '—';
    return String(v);
  }

  async function exportPdf() {
    const job = await DB.getJob(currentJobId);
    const printWin = window.open('', '_blank');
    if (!printWin) { toast('Allow pop-ups to export the PDF'); return; }

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Termite Inspection Report</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:24px;}
        h1{color:#c0552a;} h2{margin:0;color:#fff;}
        .brand{font-weight:bold;font-size:20px;color:#c0552a;margin-bottom:4px;}
        .section{margin-bottom:28px;page-break-inside:avoid;}
        .section-head{padding:8px 14px;border-radius:4px;margin-bottom:8px;}
        .field{padding:6px 0;border-bottom:1px dotted #ccc;}
        .field-label{color:#555;font-size:13px;}
        .field-value{font-size:15px;}
        .photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}
        .photos img{width:140px;height:100px;object-fit:cover;border-radius:4px;}
        img.sig{max-width:280px;border:1px solid #ddd;}
        @media print { .no-print{display:none;} }
      </style></head><body>
      <div class="brand">ARCADIAN PEST SOLUTIONS</div>
      <h1>Termite Inspection Report</h1>
      <p>In Accordance with AS 3660.2-2017<br>${escapeHtml(job ? job.address : '')}</p>
      <p><button class="no-print" onclick="window.print()">Print / Save as PDF</button></p>`;

    for (const section of SCHEMA) {
      const values = currentReport.sections[section.id] || {};
      html += `<div class="section"><div class="section-head" style="background:${section.color}"><h2>${section.number}. ${escapeHtml(section.title)}</h2></div>`;

      if (section.id === 'summary') {
        html += `<p>See Findings, Access and Conducive Conditions sections for full detail.</p>`;
      } else if (section.fixed) {
        html += `<p>This Report does not conclusively determine that the Property is free of Termites. Non-Invasive Inspection carried out in accordance with AS 3660.2-2017.</p>`;
      } else {
        for (const field of section.fields) {
          if (!isFieldVisible(field, values)) continue;
          const val = values[field.id];
          if (field.type === 'photos') {
            const photos = val || [];
            if (!photos.length) continue;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="photos">`;
            for (const p of photos) {
              const url = trackUrl(URL.createObjectURL(p.blob));
              html += `<img src="${url}">`;
            }
            html += `</div></div>`;
          } else if (field.type === 'signature') {
            if (!val) continue;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><img class="sig" src="${val}"></div>`;
          } else {
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(fmtVal(val))}</div></div>`;
          }
        }
      }
      html += `</div>`;
    }

    html += `</body></html>`;
    printWin.document.write(html);
    printWin.document.close();
  }
})();
