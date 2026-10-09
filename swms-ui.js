// Safe Work Method Statement screens — the register, one statement, one
// section being filled in.
//
// This file is short, and that is the point of the three versions that came
// before it. The schema is swms-schema.js, the store is DB.createSwms and
// friends, the section gating is ReportSchemaUtils.visibleSchema, and every
// control on screen is drawn by form-render.js. None of that is written
// twice: what is here is the flow between three screens and nothing else.
//
// It deliberately mirrors the report flow a technician already knows — a list
// of sections with a tick or a pencil against each, tap one, fill it, save
// and come back. A safety document that works differently from the
// inspection screen is a safety document that gets filled in wrong.
(() => {
  'use strict';

  const listView = document.getElementById('view-swms-list');
  const docView = document.getElementById('view-swms');
  const sectionView = document.getElementById('view-swms-section');
  if (!listView || !docView || !sectionView) return; // markup not present

  const el = (id) => document.getElementById(id);
  const listEl = el('swms-list');
  const newBtn = el('swms-new-btn');
  const listBackBtn = el('swms-list-back-btn');
  const titleEl = el('swms-title');
  const subtitleEl = el('swms-subtitle');
  const gateHintEl = el('swms-gate-hint');
  const sectionListEl = el('swms-section-list');
  const backBtn = el('swms-back-btn');
  const deleteBtn = el('swms-delete-btn');
  const sectionTitleEl = el('swms-section-title');
  const sectionSubtitleEl = el('swms-section-subtitle');
  const sectionFieldsEl = el('swms-section-fields');
  const sectionBackBtn = el('swms-section-back-btn');
  const sectionSaveBtn = el('swms-section-save-btn');

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog
    ? window.Dialog.confirm(msg, opts)
    : Promise.resolve(window.confirm(msg)));
  const utils = () => window.ReportSchemaUtils;
  const schema = () => window.SWMS_SCHEMA || [];
  const escapeHtml = window.HtmlSafe.escape;

  let current = null;            // the statement being edited
  let currentSectionId = null;
  let pendingValues = {};        // scratch copy, same model as the report editor

  // One renderer for the whole screen, re-pointed at each section's values as
  // it opens. No decorateRow and no custom field types: a safety statement
  // has no AI draft to offer and no bait stations to register, which is
  // exactly why the split in v85 was worth doing.
  const renderer = window.FormRender.create({
    values: pendingValues,
    container: sectionFieldsEl,
  });

  function show(view) {
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  function findSection(id) {
    return schema().find((s) => s.id === id);
  }

  function statementLabel(s) {
    if (s.siteAddress) return s.siteAddress;
    if (s.title && s.title !== 'Safe Work Method Statement') return s.title;
    return 'Untitled statement';
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------- the register ----------
  async function renderList() {
    const all = await DB.getAllSwms();
    listEl.innerHTML = '';

    if (!all.length) {
      listEl.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty-hint',
        textContent: 'No statements yet. Write one for a job, or once for an activity and reuse it.',
      }));
      return;
    }

    for (const s of all) {
      const li = document.createElement('li');
      li.className = 'report-section-item';
      const done = completedCount(s);
      // A statement nobody has signed is a draft, whatever else is filled in.
      // Saying so on the register is the difference between handing a builder
      // a document and handing them an empty form.
      const state = s.signedAt
        ? `Signed ${fmtDate(s.signedAt)}`
        : `${done.green} of ${done.total} sections done`;
      li.innerHTML = `
        <span class="section-icon" style="background:${s.signedAt ? '#0f766e' : '#b45309'}">${s.signedAt ? '✅' : '🦺'}</span>
        <span class="section-info">
          <span class="section-name">${escapeHtml(statementLabel(s))}</span>
          <span class="section-sub">${escapeHtml(state)}</span>
        </span>
        <span class="section-status ${s.signedAt ? 'status-dot-green' : 'status-dot-yellow'}">
          ${s.signedAt ? '✓' : '✎'}
        </span>
      `;
      li.addEventListener('click', () => openStatement(s.id));
      listEl.appendChild(li);
    }
  }

  function completedCount(statement) {
    const visible = utils().visibleSchema(schema(), statement);
    let green = 0;
    for (const section of visible) {
      const values = (statement.sections && statement.sections[section.id]) || {};
      if (utils().computeSectionStatus(section, values) === 'green') green++;
    }
    return { green, total: visible.length };
  }

  // ---------- one statement ----------
  async function openStatement(id) {
    current = await DB.getSwms(id);
    if (!current) { toast('That statement is no longer here.'); return openList(); }
    renderSectionList();
    show(docView);
  }

  function renderSectionList() {
    titleEl.textContent = statementLabel(current);
    const done = completedCount(current);
    subtitleEl.textContent = current.signedAt
      ? `Signed ${fmtDate(current.signedAt)}`
      : `${done.green} of ${done.total} sections done`;

    const visible = utils().visibleSchema(schema(), current);
    // The hint only earns its place while the gate questions are unanswered.
    const activities = (current.sections && current.sections.swmsActivities) || {};
    gateHintEl.classList.toggle('hidden', Object.keys(activities).length > 0);

    sectionListEl.innerHTML = '';
    // Numbered by position among the sections actually on screen, not by the
    // static number in the schema — with the subfloor and roof void pages
    // hidden, a list reading 1-3 then 6 looks like pages went missing rather
    // than pages that were never needed.
    let displayNumber = 0;
    for (const section of visible) {
      displayNumber++;
      const values = (current.sections && current.sections[section.id]) || {};
      const status = utils().computeSectionStatus(section, values);
      const li = document.createElement('li');
      li.className = 'report-section-item';
      li.dataset.sectionId = section.id;
      li.innerHTML = `
        <span class="section-icon" style="background:${section.color}">${section.icon}</span>
        <span class="section-info">
          <span class="section-name">${displayNumber}. ${escapeHtml(section.title)}</span>
        </span>
        <span class="section-status ${status === 'green' ? 'status-dot-green' : 'status-dot-yellow'}">
          ${status === 'green' ? '✓' : '✎'}
        </span>
      `;
      li.addEventListener('click', () => openSection(section.id));
      sectionListEl.appendChild(li);
    }
  }

  // ---------- one section ----------
  function openSection(sectionId) {
    const section = findSection(sectionId);
    if (!section) return;
    currentSectionId = sectionId;

    const saved = (current.sections && current.sections[sectionId]) || null;
    // Defaults only fill a section that has never been opened. Doing it every
    // time would overwrite an answer with the schema's suggestion each time
    // the technician came back to check something.
    pendingValues = saved
      ? JSON.parse(JSON.stringify(saved))
      : utils().defaultValuesForSection(section, window.Org);

    sectionTitleEl.textContent = section.title;
    sectionSubtitleEl.textContent = section.subtitle || '';

    // Re-point the renderer at this section's values. Not re-created: the
    // same trap report.js hit in v85 — a renderer still holding the previous
    // section's object goes on writing into it, which looks like edits
    // vanishing on save.
    renderer.setValues(pendingValues);
    renderer.renderSection(section);
    show(sectionView);
  }

  async function saveSection() {
    if (!current || !currentSectionId) return;
    current.sections = current.sections || {};
    current.sections[currentSectionId] = pendingValues;

    // The signature is what turns a form into a statement, so the record
    // carries the date rather than making the register go digging for it.
    const signoff = (current.sections.swmsSignoff) || {};
    current.signedAt = signoff.technicianSignature ? (current.signedAt || Date.now()) : null;
    if (signoff.reviewDate) {
      const parsed = Date.parse(signoff.reviewDate);
      current.reviewDueAt = Number.isNaN(parsed) ? null : parsed;
    }
    const details = (current.sections.swmsDetails) || {};
    if (details.siteAddress) current.siteAddress = details.siteAddress;

    current = await DB.saveSwms(current);
    currentSectionId = null;
    renderSectionList();
    show(docView);
  }

  // ---------- create and delete ----------
  // One at a time: a second tap before the first finished made a second statement.
  let creatingStatement = false;
  async function createStatement() {
    if (creatingStatement) return;
    creatingStatement = true;
    try {
      await createStatementNow();
    } finally {
      creatingStatement = false;
    }
  }

  async function createStatementNow() {
    // Offered against the job on screen when there is one, because that is
    // where the address and the client already are. A statement with no job
    // is equally valid — see the store — so this is a default, not a rule.
    const job = window.currentJobForSwms ? await window.currentJobForSwms() : null;
    const created = await DB.createSwms({
      jobId: job ? job.id : null,
      siteAddress: job ? (job.address || '') : '',
    });
    await openStatement(created.id);
    toast('Statement started — answer “What This Job Involves” first');
  }

  async function deleteStatement() {
    if (!current) return;
    const ok = await askConfirm(
      `${statementLabel(current)} will be deleted. If it was handed to a builder or a site, `
      + 'they keep their copy — this only removes yours.',
      { title: 'Delete this statement?', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    const statement = current;
    current = null;
    // Held back for ten seconds with an Undo (undo-delete.js).
    await openList();
    await window.UndoDelete.start({
      kind: 'swms',
      ids: [statement.id],
      message: `${statementLabel(statement)} deleted`,
      commit: () => DB.deleteSwms(statement.id),
      refresh: async () => { if (!listView.classList.contains('hidden')) await openList(); },
    });
  }

  async function openList() {
    await renderList();
    show(listView);
  }

  newBtn.addEventListener('click', createStatement);
  deleteBtn.addEventListener('click', deleteStatement);
  sectionSaveBtn.addEventListener('click', saveSection);
  sectionBackBtn.addEventListener('click', () => {
    // Back discards, exactly like the report's section editor. Save is the
    // only thing that writes, so there is one rule to remember rather than
    // two screens with different ones.
    currentSectionId = null;
    renderSectionList();
    show(docView);
  });
  backBtn.addEventListener('click', openList);
  listBackBtn.addEventListener('click', () => {
    if (window.showJobListView) window.showJobListView();
  });

  const openBtn = document.getElementById('open-swms-btn');
  if (openBtn) openBtn.addEventListener('click', openList);

  window.SwmsUI = {
    open: openList,
    openStatement,
    // Exposed for the suite, same reasoning as the other modules here: the
    // wording and the state a technician actually sees is worth asserting on.
    renderSectionList,
    completedCount,
    statementLabel,
  };
})();
