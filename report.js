(() => {
  'use strict';

  const { isFieldVisible, computeSectionStatus, defaultValuesForSection } = window.ReportSchemaUtils;

  // Two report types share this file: the termite inspection report
  // (window.REPORT_SCHEMA) and the general pest treatment / chemical
  // application report (window.PEST_TREATMENT_SCHEMA, pest-treatment-
  // schema.js) — picked per-job at job creation (job.jobType) and never
  // changed afterwards. Everything below resolves the right schema
  // dynamically instead of capturing one at script-load time, so both
  // report types share this exact same editor/PDF/AI-draft code path.
  // ---------- Document types ----------
  // A job used to imply exactly one document: termite jobs got the termite
  // report, pest jobs got the pest report. That matched about half the real
  // work. The other half — action plans, certificates of installation, service
  // visits — had nowhere to go, so 215 of Arcadian's last 1,400 documents were
  // produced somewhere else entirely.
  //
  // A job now chooses which document it is producing. jobType still decides
  // what is offered (nobody needs a bait-station service record on a general
  // pest call) and still drives invoicing defaults, so nothing downstream of
  // it changes.
  const DOCUMENT_TYPES = {
    timber_pest_inspection: {
      id: 'timber_pest_inspection',
      title: 'Timber Pest Inspection Report',
      short: 'Inspection',
      standard: 'AS 4349.3-2010',
      blurb: 'Full timber pest inspection — termites, borers and decay.',
      jobTypes: ['termite'],
      schema: () => window.REPORT_SCHEMA,
    },
    termite_action_plan: {
      id: 'termite_action_plan',
      title: 'Termite Management Action Plan',
      short: 'Action Plan',
      standard: 'AS 3660.2-2017',
      blurb: 'What you propose to do about what the inspection found, and what it costs.',
      jobTypes: ['termite'],
      schema: () => window.TERMITE_ACTION_PLAN_SCHEMA,
    },
    termite_certificate: {
      id: 'termite_certificate',
      title: 'Certificate of Installation',
      short: 'Certificate',
      standard: 'AS 3660.1-2014 / AS 3660.2-2017',
      blurb: 'Issued once a management system is installed. Asked for years later.',
      jobTypes: ['termite'],
      schema: () => window.TERMITE_CERTIFICATE_SCHEMA,
    },
    termite_service_record: {
      id: 'termite_service_record',
      title: 'Termite Management Plan Service Record',
      short: 'Service Record',
      standard: 'AS 3660.2-2017',
      blurb: 'A periodic visit to an installed system — this is what keeps the warranty alive.',
      jobTypes: ['termite'],
      schema: () => window.TERMITE_SERVICE_RECORD_SCHEMA,
    },
    general_pest: {
      id: 'general_pest',
      title: 'General Pest Treatment Report',
      short: 'Service Report',
      standard: '',
      blurb: 'Chemical application record for a general pest treatment.',
      jobTypes: ['pest_treatment'],
      schema: () => window.PEST_TREATMENT_SCHEMA,
    },
  };

  function defaultDocumentType(jobType) {
    return jobType === 'pest_treatment' ? 'general_pest' : 'timber_pest_inspection';
  }

  function documentTypesFor(jobType) {
    const wanted = jobType === 'pest_treatment' ? 'pest_treatment' : 'termite';
    return Object.values(DOCUMENT_TYPES).filter((d) => d.jobTypes.includes(wanted));
  }

  // The document type lives on the report, not the job: one property can need
  // an inspection this year and a service record next, and the job record
  // should not have to be recreated to say so.
  function documentTypeOf(report, job) {
    const stamped = report && report.documentType;
    if (stamped && DOCUMENT_TYPES[stamped]) return DOCUMENT_TYPES[stamped];
    return DOCUMENT_TYPES[defaultDocumentType(job && job.jobType)];
  }

  function schemaFor(jobType, report) {
    // Reports written before document types existed carry no stamp, and must
    // keep resolving to the schema they were answered against.
    const docType = documentTypeOf(report, { jobType });
    const schema = docType && docType.schema();
    return schema || window.REPORT_SCHEMA;
  }
  // Convenience for the many call sites that only run once a report is open
  // (currentJob is set in openReview before any of them can be reached).
  function currentSchema() {
    return schemaFor(currentJob && currentJob.jobType, currentReport);
  }

  function currentDocumentType() {
    return documentTypeOf(currentReport, currentJob);
  }

  // Single source of truth for the report's display name — used by the
  // on-screen header, the print window's <title>, and the PDF cover line,
  // so those three can never drift out of sync.
  function reportTitleFor(jobType, report) {
    const docType = documentTypeOf(report, { jobType });
    return docType ? docType.title : 'Inspection Report';
  }

  // ---------- Element refs ----------
  const viewReport = document.getElementById('view-report');
  const viewReportSection = document.getElementById('view-report-section');

  const reportBackBtn = document.getElementById('report-back-btn');
  const reportTitle = document.getElementById('report-title');
  const reportSubtitle = document.getElementById('report-subtitle');
  const reportExportBtn = document.getElementById('report-export-btn');
  const aiDraftBtn = document.getElementById('ai-draft-btn');
  const reportSectionList = document.getElementById('report-section-list');
  const finalizeBtn = document.getElementById('finalize-report-btn');
  const finalizeHint = document.getElementById('finalize-hint');
  const finalizePostActions = document.getElementById('finalize-post-actions');
  const reportSendBtn = document.getElementById('report-send-btn');
  const reportSaveBtn = document.getElementById('report-save-btn');

  // These four are newer than some deployed index.html files. GitHub Pages
  // serves assets through a CDN that does not invalidate them together, so a
  // returning device can briefly pair a fresh report.js with a stale cached
  // index.html. Referencing a missing element unguarded throws at module load
  // and takes the whole report screen down with it — which is how "Finish
  // Inspection hangs" once presented itself. Every use below is guarded.
  const preflightCard = document.getElementById("preflight-card");
  const preflightBody = document.getElementById("preflight-body");
  const auditCard = document.getElementById("audit-trail-card");
  const auditToggleBtn = document.getElementById('audit-toggle-btn');
  const auditBody = document.getElementById('audit-trail-body');
  const schemaMismatchNotice = document.getElementById('schema-mismatch-notice');

  const sectionBackBtn = document.getElementById('section-back-btn');
  const sectionTitleEl = document.getElementById('section-title');
  const sectionSubtitleEl = document.getElementById('section-subtitle');
  const sectionFieldsEl = document.getElementById('report-section-fields');
  const sectionSaveBtn = document.getElementById('section-save-btn');

  const viewArchive = document.getElementById('view-archive');
  const archiveBackBtn = document.getElementById('archive-back-btn');
  const archiveList = document.getElementById('archive-list');
  const archiveEmpty = document.getElementById('archive-empty');

  // ---------- State ----------
  let currentJobId = null;
  let currentJob = null; // full job record, needed for address coords (aerial mud-map backdrop)
  let currentReport = null; // { jobId, sections: {id: {fieldId: value}}, finalizedAt, updatedAt, aiDraft }
  let currentSectionId = null;
  let pendingSectionValues = {};
  // Basis text for fields filled from the address, keyed by fieldId, so the
  // section editor can explain where a value came from.
  let derivedSiteNotes = {};
  let aiAppliedFieldIds = new Set(); // fields in the currently-open section pre-filled from an AI suggestion, not yet reviewed
  let aiDraftInProgress = false;
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
    return currentSchema().find((s) => s.id === sectionId);
  }

  // ---------- Audit trail ----------
  // A termite report is evidence. If a slab fails two years from now and the
  // owner's insurer asks whether "Live termites found: No" was the answer the
  // technician gave on site, "the file says No" is not an answer — the file
  // can be edited. What settles it is a record of when each answer was given,
  // what it was changed from, by whom, and why.
  //
  // The design follows ODK Collect's form audit log, which solves exactly this
  // problem for field data whose consequences are legal: per-answer change
  // tracking, a recorded identity, and — the part that matters most here — a
  // mandatory reason before an already-finalized document can be amended.
  //
  // Events live on the report itself (report.auditLog) rather than in their
  // own store, so they travel with the report through the existing sync path
  // and can never be separated from the document they describe.

  const AUDIT_TEXT_LIMIT = 140;

  // Audit entries must stay small and readable. Values here can be a 200KB
  // sketch data URL or an array of photo blobs, so nothing is ever stored
  // verbatim — what's recorded is enough to see that a change happened and
  // what kind, without turning the report row into a media archive.
  function summariseValue(value) {
    if (value === undefined || value === null || value === '') return '(blank)';
    if (Array.isArray(value)) {
      if (!value.length) return '(none)';
      if (value.every((v) => typeof v === 'string')) {
        const joined = value.join(', ');
        return joined.length > AUDIT_TEXT_LIMIT ? joined.slice(0, AUDIT_TEXT_LIMIT) + '…' : joined;
      }
      // Photo lists and product lists are arrays of objects.
      if (value.length && value[0] && value[0].blob !== undefined) {
        return `${value.length} photo${value.length === 1 ? '' : 's'}`;
      }
      if (value.length && value[0] && value[0].productName !== undefined) {
        const names = value.map((p) => p.productName || '(unnamed)').join(', ');
        return `${value.length} product${value.length === 1 ? '' : 's'}: ${names}`.slice(0, AUDIT_TEXT_LIMIT);
      }
      return `${value.length} item${value.length === 1 ? '' : 's'}`;
    }
    const str = String(value);
    if (str.startsWith('data:image/')) return '(image)';
    return str.length > AUDIT_TEXT_LIMIT ? str.slice(0, AUDIT_TEXT_LIMIT) + '…' : str;
  }

  // Deep-ish equality for the value shapes a section can hold. Photo arrays
  // hold Blobs, which never compare equal through JSON, so they're compared by
  // identity and length — enough to notice an added or removed photo without
  // reporting a spurious change every time a section is opened and saved.
  function valuesEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => {
        const other = b[i];
        if (item && typeof item === 'object' && other && typeof other === 'object') {
          if (item.blob !== undefined || other.blob !== undefined) return item === other || item.id === other.id;
          return JSON.stringify(item) === JSON.stringify(other);
        }
        return item === other;
      });
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    // Treat null/undefined/'' as the same "not answered" state, so merely
    // opening a section and saving it doesn't manufacture change events.
    const aBlank = a === undefined || a === null || a === '';
    const bBlank = b === undefined || b === null || b === '';
    return aBlank && bBlank;
  }

  function fieldLabel(section, fieldId) {
    const field = (section.fields || []).find((f) => f.id === fieldId);
    return field ? field.label : fieldId;
  }

  // Returns [{ fieldId, label, from, to }] for everything that actually
  // changed between the saved section and what's about to replace it.
  function diffSection(section, before, after) {
    const changes = [];
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const fieldId of ids) {
      const from = before ? before[fieldId] : undefined;
      const to = after ? after[fieldId] : undefined;
      if (valuesEqual(from, to)) continue;
      changes.push({
        fieldId,
        label: fieldLabel(section, fieldId),
        from: summariseValue(from),
        to: summariseValue(to),
      });
    }
    return changes;
  }

  function auditActor() {
    const user = window.Sync && window.Sync.currentUser ? window.Sync.currentUser() : null;
    if (user) return { userId: user.id || null, userEmail: user.email || '' };
    if (window.IS_DEMO) return { userId: null, userEmail: 'demo' };
    return { userId: null, userEmail: '' };
  }

  function appendAudit(report, entry) {
    if (!Array.isArray(report.auditLog)) report.auditLog = [];
    report.auditLog.push({
      at: Date.now(),
      ...auditActor(),
      // Whether the document was already finalized when this happened is the
      // single most important fact in the log: amendments to a signed-off
      // report are what get argued about.
      afterFinalize: !!report.finalizedAt,
      schemaVersion: window.REPORT_SCHEMA_VERSION || null,
      ...entry,
    });
    return report.auditLog;
  }

  // ---------- Report load / prefill ----------
  async function loadOrCreateReport(jobId, wantedDocumentType) {
    let report = await DB.getReport(jobId);
    if (report) return report;

    const job = await DB.getJob(jobId);
    const documentType = (wantedDocumentType && DOCUMENT_TYPES[wantedDocumentType])
      ? wantedDocumentType
      : defaultDocumentType(job && job.jobType);
    const sections = {};
    for (const section of schemaFor(job && job.jobType, { documentType })) {
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
    report = {
      jobId,
      sections,
      finalizedAt: null,
      // Which of the five documents this is. Stamped at creation and never
      // inferred afterwards, because the same property can need an inspection
      // one visit and a service record the next.
      documentType,
      // The question set this report was answered against. Reports outlive
      // schema edits, so without this stamp a later change to report-schema.js
      // silently rewrites what old reports appear to say. See SCHEMA_VERSION
      // in report-schema.js.
      schemaVersion: window.REPORT_SCHEMA_VERSION || null,
      auditLog: [],
    };
    appendAudit(report, { event: 'created' });
    return report;
  }

  // An inspection date is a calendar date where the technician is standing,
  // not a UTC instant. toISOString() converts to UTC first, so in Australia
  // (UTC+10/11) every inspection started before ~10am local was being dated
  // the PREVIOUS DAY on a legal compliance document. Formatting from local
  // components is what makes the date match the day the work happened.
  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------- Public entry point ----------
  window.ReportUI = {
    async openReview(jobId, documentType) {
      currentJobId = jobId;
      currentReport = await loadOrCreateReport(jobId, documentType);
      const job = await DB.getJob(jobId);
      currentJob = job || null;
      // The header is the technician's main cue for which report they're in —
      // it must follow the job type, not stay hardcoded to the termite wording.
      if (reportTitle) reportTitle.textContent = reportTitleFor(job && job.jobType, currentReport);
      const docType = currentDocumentType();
      reportSubtitle.textContent = (job ? job.name : '')
        + (docType && docType.standard ? '  ·  ' + docType.standard : '');
      renderSectionList();
      updateAiDraftButton();
      hideAllAppViews();
      show(viewReport);
      // Best-effort and deliberately not awaited: the report must open at once
      // even when the address lookups are slow or the site has no signal.
      autoPopulateSiteFields().catch((err) => console.warn('[report] site auto-fill failed:', err.message || err));
    },
    // Puts the front-elevation shot straight into the report's cover field.
    // The technician photographed it for exactly this purpose, so making them
    // find it again in the gallery and attach it by hand is the kind of step
    // that turns into "the cover was blank again".
    async attachCoverPhoto(jobId, blob) {
      const report = await loadOrCreateReport(jobId);
      const job = await DB.getJob(jobId);
      const schema = schemaFor(job && job.jobType, report);
      // Termite documents carry it as the property photo, pest reports as the
      // cover — whichever this document actually has.
      const target = schema
        .flatMap((s) => (s.fields || []).map((f) => ({ sectionId: s.id, field: f })))
        .find((x) => x.field.id === 'coverPhoto')
        || schema
          .flatMap((s) => (s.fields || []).map((f) => ({ sectionId: s.id, field: f })))
          .find((x) => x.field.id === 'propertyPhotos');
      if (!target) return;

      const section = { ...(report.sections[target.sectionId] || {}) };
      const existing = Array.isArray(section[target.field.id]) ? section[target.field.id] : [];
      // Never displace a photo the technician chose deliberately.
      if (existing.length) return;
      section[target.field.id] = [{ id: DB.uid(), blob }];
      report.sections[target.sectionId] = section;
      await DB.saveReport(report);
      if (currentJobId === jobId) { currentReport = report; renderSectionList(); }
    },
    // The jobCategory picked on Client & Site (pest treatment jobs only) —
    // read by app.js at Start Inspection to pick which photo checklist to
    // show (photo-checklists.js). Returns null for termite jobs and for any
    // pest job where the technician hasn't picked a category yet.
    async getJobCategory(jobId) {
      const report = await loadOrCreateReport(jobId);
      return (report.sections.clientDetails || {}).jobCategory || null;
    },
    // Copies each checklist item's captures into the report photo field it
    // names (photo-checklists.js's schemaSection/schemaField), the same way
    // attachCoverPhoto above copies the front-elevation shot into the cover
    // field — called once from finishInspection so a checklist-guided photo
    // lands where the report already expects one, instead of only living in
    // the gallery under a zone name that happens to match.
    async attachChecklistPhotos(jobId) {
      if (!window.PhotoChecklists) return;
      const job = await DB.getJob(jobId);
      const jobCategory = job && job.jobType === 'pest_treatment'
        ? await this.getJobCategory(jobId)
        : null;
      const items = window.PhotoChecklists.forJob(job, jobCategory).filter((item) => item.schemaField);
      if (!items.length) return;

      const captures = await DB.getCaptures(jobId);
      if (!captures.length) return;

      const report = await loadOrCreateReport(jobId);
      let changed = false;
      for (const item of items) {
        const matches = captures.filter((c) => c.photoBlob && c.zone === item.label);
        if (!matches.length) continue;
        const section = { ...(report.sections[item.schemaSection] || {}) };
        const existing = Array.isArray(section[item.schemaField]) ? section[item.schemaField] : [];
        const existingIds = new Set(existing.map((p) => p.captureId).filter(Boolean));
        const additions = matches
          .filter((c) => !existingIds.has(c.id))
          .map((c) => ({ id: DB.uid(), captureId: c.id, blob: c.photoBlob }));
        if (!additions.length) continue;
        section[item.schemaField] = [...existing, ...additions];
        report.sections[item.schemaSection] = section;
        changed = true;
      }
      if (!changed) return;
      await DB.saveReport(report);
      if (currentJobId === jobId) { currentReport = report; renderSectionList(); }
    },
    documentTypesFor,
    documentTypeOf,
    async openArchive() {
      await renderArchiveList();
      hideAllAppViews();
      show(viewArchive);
    },
    // Called by app.js once footage analysis comes back — either the
    // background run right after "Finish Inspection", or a manual re-run
    // from the AI Draft button. Never writes into report.sections directly;
    // suggestions only apply when a section is opened (see openSectionEditor).
    async applyAiDraft(jobId, result) {
      const report = await loadOrCreateReport(jobId);
      report.aiDraft = {
        generatedAt: Date.now(),
        transcript: result.transcript || '',
        draftFields: result.draftFields || {},
        // Which photograph each suggestion came from. A suggested answer the
        // technician cannot trace back to an image is one they have to
        // re-derive from scratch, which costs more time than a blank field.
        fieldReasons: result.fieldReasons || {},
        frameNotes: result.frameNotes || [],
      };
      await DB.saveReport(report);
      if (currentJobId === jobId) {
        currentReport = report;
        updateAiDraftButton();
      }
      await applySuggestedZones(jobId, report.aiDraft.frameNotes);
    },
    // Generic "fill this field if it's still empty" helper — used by app.js
    // for things determined at Start Inspection time (the actual clock time,
    // real-time weather) that don't fit the AI-draft or static-default
    // mechanisms. Never overwrites a value that's already there.
    async prefillFieldValue(jobId, sectionId, fieldId, value) {
      if (value === undefined || value === null || value === '') return;
      const report = await loadOrCreateReport(jobId);
      const current = report.sections[sectionId] && report.sections[sectionId][fieldId];
      if (current !== undefined && current !== null && current !== '') return;
      report.sections[sectionId] = { ...(report.sections[sectionId] || {}), [fieldId]: value };
      await DB.saveReport(report);
      if (currentJobId === jobId) currentReport = report;
    },
    // Generates a real PDF Blob for a job's report (for emailing — see
    // email.js) — jobId defaults to whichever report is currently open.
    async generatePdfBlob(jobId) {
      const targetJobId = jobId || currentJobId;
      const job = await DB.getJob(targetJobId);
      const report = await loadOrCreateReport(targetJobId);
      return generateReportPdfBlob(job, report);
    },
  };

  // Matches untagged captures to a frameNotes time range (relative seconds
  // into the inspection recording) and persists a suggestedZone onto the
  // capture — a suggestion only, never writing over an existing zone tag
  // and never applied as the real zone until the technician taps to accept
  // it (see the gallery badge / detail-modal affordance in app.js).
  async function applySuggestedZones(jobId, frameNotes) {
    if (!frameNotes || !frameNotes.length) return;
    const job = await DB.getJob(jobId);
    if (!job || !job.inspectionStartedAt) return;

    const captures = await DB.getCaptures(jobId);
    for (const capture of captures) {
      if (capture.zone) continue; // already tagged, real or accepted-suggestion — leave it alone
      const elapsedSeconds = (capture.createdAt - job.inspectionStartedAt) / 1000;
      const match = frameNotes.find((n) => elapsedSeconds >= n.startSeconds && elapsedSeconds <= n.endSeconds);
      if (match && match.zone && capture.suggestedZone !== match.zone) {
        await DB.updateCapture(capture.id, { suggestedZone: match.zone });
      }
    }
  }

  // ---------- AI Draft ----------
  function updateAiDraftButton() {
    if (!window.AI) {
      aiDraftBtn.textContent = '🤖 AI Draft (not configured)';
      aiDraftBtn.disabled = true;
      return;
    }
    aiDraftBtn.disabled = aiDraftInProgress;
    if (aiDraftInProgress) { aiDraftBtn.textContent = '🤖 Analyzing footage…'; return; }
    aiDraftBtn.textContent = currentReport && currentReport.aiDraft ? '🤖 Regenerate AI Draft' : '🤖 Generate AI Draft';
  }

  aiDraftBtn.addEventListener('click', async () => {
    if (!window.AI || aiDraftInProgress) return;
    const footage = await DB.getFootage(currentJobId);
    const liveVideo = footage
      .filter((f) => f.kind === 'video' && f.source === 'live')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!liveVideo) { toast('No recorded inspection footage found for this job yet — run Start/Finish Inspection first.'); return; }

    aiDraftInProgress = true;
    updateAiDraftButton();
    try {
      const result = await window.AI.analyzeInspection(liveVideo.blob, currentJob && currentJob.jobType);
      await ReportUI.applyAiDraft(currentJobId, result);
      toast('AI draft ready — suggested values will appear when you open each section');
    } catch (err) {
      console.error('[ai draft]', err);
      toast('AI draft failed: ' + (err.message || err));
    } finally {
      aiDraftInProgress = false;
      updateAiDraftButton();
    }
  });

  // Hides every full-screen view rather than a hardcoded list. The list
  // version silently rotted: the scheduler and invoice screens were added
  // later and never got added here, so opening a report or the archive while
  // the scheduler was up left the scheduler on screen underneath.
  function hideAllAppViews() {
    if (window.hideAllAppViews) { window.hideAllAppViews(); return; }
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  }

  // ---------- Saved Reports archive ----------
  async function renderArchiveList() {
    const reports = await DB.getAllReports();
    archiveList.innerHTML = '';
    archiveEmpty.classList.toggle('hidden', reports.length > 0);

    for (const report of reports) {
      const job = await DB.getJob(report.jobId);
      const clientDetails = report.sections && report.sections.clientDetails ? report.sections.clientDetails : {};
      const clientName = (job && job.name) || clientDetails.clientName || 'Unknown client';
      const address = (job && job.address) || clientDetails.propertyAddress || '';
      const finalized = !!report.finalizedAt;
      const dateLabel = fmtDate(finalized ? report.finalizedAt : report.updatedAt);

      const li = document.createElement('li');
      li.className = 'report-section-item archive-item';
      li.innerHTML = `
        <span class="section-icon" style="background:${finalized ? '#1f7a4d' : '#8a7a2a'}">${finalized ? '✓' : '✎'}</span>
        <span class="section-info">
          <span class="section-name">${escapeHtml(clientName)}</span>
          <span class="archive-meta">${escapeHtml(address ? address + ' · ' : '')}${finalized ? 'Submitted' : 'Draft'} ${escapeHtml(dateLabel)}</span>
        </span>
        <span class="section-status archive-chevron">›</span>
      `;
      li.addEventListener('click', () => ReportUI.openReview(report.jobId));
      archiveList.appendChild(li);
    }
  }

  archiveBackBtn.addEventListener('click', () => {
    hide(viewArchive);
    if (window.showJobListView) window.showJobListView();
    else show(document.getElementById('view-joblist'));
  });

  // ---------- Audit trail + schema version UI ----------
  // Every element used here can be absent on a device pairing this script with
  // a stale cached index.html, so each function bails rather than throwing.

  function fmtAuditTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function auditEntryLine(entry) {
    const who = entry.userEmail ? escapeHtml(entry.userEmail) : 'unknown user';
    const when = fmtAuditTime(entry.at);
    if (entry.event === 'created') return `<strong>Report created</strong> — ${when} by ${who}`;
    if (entry.event === 'finalized') return `<strong>Report finalized</strong> — ${when} by ${who}`;
    if (entry.event === 'field-changed') {
      const where = entry.sectionTitle ? escapeHtml(entry.sectionTitle) : escapeHtml(entry.sectionId || '');
      return `<strong>${escapeHtml(entry.label || entry.fieldId || 'Field')}</strong> `
        + `<span class="audit-where">(${where})</span><br>`
        + `<span class="audit-change">${escapeHtml(entry.from)} → ${escapeHtml(entry.to)}</span><br>`
        + `<span class="audit-meta">${when} by ${who}</span>`
        + (entry.reason ? `<br><span class="audit-reason">Reason: ${escapeHtml(entry.reason)}</span>` : '');
    }
    return `<strong>${escapeHtml(entry.event || 'event')}</strong> — ${when} by ${who}`;
  }

  function renderAuditTrail() {
    if (!auditCard || !auditBody) return;
    const log = (currentReport && currentReport.auditLog) || [];
    if (!log.length) { auditCard.classList.add('hidden'); return; }
    auditCard.classList.remove('hidden');

    const amendments = log.filter((e) => e.afterFinalize).length;
    if (auditToggleBtn) {
      const events = `${log.length} event${log.length === 1 ? '' : 's'}`;
      auditToggleBtn.textContent = amendments
        ? `🕓 Audit Trail — ${events}, ${amendments} after finalizing`
        : `🕓 Audit Trail — ${events}`;
    }

    // Newest first: when something is disputed, the most recent change is
    // almost always the one being asked about.
    const rows = [...log].sort((a, b) => b.at - a.at).map((entry) => (
      `<li class="audit-entry${entry.afterFinalize ? ' audit-amendment' : ''}">`
      + (entry.afterFinalize ? '<span class="audit-flag">AMENDED AFTER FINALIZING</span>' : '')
      + auditEntryLine(entry)
      + '</li>'
    )).join('');

    auditBody.innerHTML = `<ul class="audit-list">${rows}</ul>`;
  }

  if (auditToggleBtn && auditBody) {
    auditToggleBtn.addEventListener('click', () => {
      auditBody.classList.toggle('hidden');
    });
  }

  function renderSchemaNotice() {
    if (!schemaMismatchNotice) return;
    const current = window.REPORT_SCHEMA_VERSION || null;
    const stamped = currentReport ? currentReport.schemaVersion : null;
    // Reports written before versioning existed have no stamp. That is not a
    // mismatch to shout about — it is simply unknown, and saying so would be
    // noise on every legacy report.
    if (stamped == null || current == null || stamped === current) {
      schemaMismatchNotice.classList.add('hidden');
      return;
    }
    schemaMismatchNotice.classList.remove('hidden');
    schemaMismatchNotice.innerHTML =
      `<strong>Question set has changed since this report was written.</strong>`
      + `<p class="empty-hint">This report was answered against version ${escapeHtml(String(stamped))}; `
      + `the app is now on version ${escapeHtml(String(current))}. Some questions may have been added, `
      + `renamed or removed since. Read the answers as they were recorded — do not assume a blank field `
      + `means the technician left it empty.</p>`;
  }

  // ---------- Site fields derived from the address ----------
  // Two questions in "About the Property Inspected" have answers that can be
  // worked out from where the property is, before anyone opens the section:
  // which way the frontage faces, and which way the land falls. Both are
  // tedious to judge on site and easy to get wrong from memory.
  //
  // The rule everywhere else in this app is that AI suggests and never
  // commits. These are treated differently on purpose: they are derived from
  // public survey data rather than inferred from imagery, so they are filled
  // in — but the fill is recorded in the audit trail as machine-derived, and
  // only ever lands on a field the technician has not answered. A value they
  // changed is never overwritten, on this visit or any later one.
  const DERIVED_SITE_FIELDS = ['facade', 'topography'];

  function isUnanswered(section, values, fieldId) {
    const current = values ? values[fieldId] : undefined;
    if (current === undefined || current === null || current === '') return true;
    // Still sitting on the schema default counts as unanswered — nobody has
    // made a decision about it yet.
    const field = (section.fields || []).find((f) => f.id === fieldId);
    return !!(field && field.default !== undefined && current === field.default);
  }

  async function autoPopulateSiteFields() {
    if (!(window.Geo && currentJob && currentReport)) return;
    const schema = currentSchema();
    const property = schema.find((s) => s.id === 'property');
    if (!property) return;

    const values = currentReport.sections.property || {};
    const wanted = DERIVED_SITE_FIELDS.filter((id) => isUnanswered(property, values, id));
    if (!wanted.length) return;

    let coords;
    try {
      coords = await window.Geo.ensureJobCoords(currentJob);
    } catch (err) {
      console.warn('[report] could not resolve job coordinates:', err.message || err);
      return;
    }
    if (!coords) return;

    const [facade, topo] = await Promise.all([
      wanted.includes('facade')
        ? window.Geo.fetchFacadeOrientation(coords.lat, coords.lng).catch(() => null)
        : Promise.resolve(null),
      wanted.includes('topography')
        ? window.Geo.fetchSiteTopography(coords.lat, coords.lng).catch(() => null)
        : Promise.resolve(null),
    ]);

    const filled = [];
    if (facade && facade.facade && wanted.includes('facade')) {
      filled.push({
        fieldId: 'facade',
        value: facade.facade,
        label: 'The front facade of the dwelling faces',
        basis: facade.street
          ? `frontage to ${facade.street}, ${facade.metres}m away`
          : `nearest street ${facade.metres}m away`,
        confident: facade.confident,
      });
    }
    if (topo && topo.topography && wanted.includes('topography')) {
      filled.push({
        fieldId: 'topography',
        value: topo.topography,
        label: 'Site Topography',
        basis: `${Math.round(topo.drop)}m of fall across the surrounding 240m`,
        confident: topo.confident,
      });
    }
    if (!filled.length) return;

    currentReport.sections.property = { ...values };
    for (const item of filled) {
      currentReport.sections.property[item.fieldId] = item.value;
      appendAudit(currentReport, {
        event: 'auto-filled',
        sectionId: 'property',
        sectionTitle: property.title,
        fieldId: item.fieldId,
        label: item.label,
        from: '(blank)',
        to: item.value,
        basis: item.basis,
        confident: !!item.confident,
      });
    }
    // Remember what was derived so the section editor can show its basis and
    // invite the technician to correct it.
    derivedSiteNotes = filled.reduce((acc, item) => {
      acc[item.fieldId] = item;
      return acc;
    }, derivedSiteNotes || {});

    await DB.saveReport(currentReport);
    renderSectionList();
    const names = filled.map((f) => f.label).join(' and ');
    toast(`Filled ${names} from the address — check before finalising.`);
  }

  // Picking a Job Category on Client & Site prefills PPE (safety section)
  // and Application Equipment (treatment section) with what that kind of
  // job typically needs. Same rule as everywhere else in this app: it only
  // ever lands on a field nobody has answered yet, and it's a starting
  // point to correct, not a recorded fact — the technician still has to
  // open each section and confirm it against what they actually used.
  function applyJobCategoryPrefill(categoryLabel) {
    if (!(window.PEST_JOB_CATEGORIES && currentReport)) return;
    const cat = window.PEST_JOB_CATEGORIES.find((c) => c.label === categoryLabel);
    if (!cat) return;
    const schema = currentSchema();
    const safetySection = schema.find((s) => s.id === 'safety');
    const treatmentSection = schema.find((s) => s.id === 'treatmentDetails');
    if (!safetySection || !treatmentSection) return;

    const filled = [];
    if (isUnanswered(safetySection, currentReport.sections.safety || {}, 'ppeUsed')) {
      filled.push({ sectionId: 'safety', sectionTitle: safetySection.title, fieldId: 'ppeUsed', label: 'PPE worn', value: cat.ppe });
    }
    if (isUnanswered(treatmentSection, currentReport.sections.treatmentDetails || {}, 'equipmentUsed')) {
      filled.push({ sectionId: 'treatmentDetails', sectionTitle: treatmentSection.title, fieldId: 'equipmentUsed', label: 'Application equipment', value: cat.equipment });
    }
    if (!filled.length) return;

    for (const item of filled) {
      currentReport.sections[item.sectionId] = { ...(currentReport.sections[item.sectionId] || {}), [item.fieldId]: item.value };
      appendAudit(currentReport, {
        event: 'auto-filled',
        sectionId: item.sectionId,
        sectionTitle: item.sectionTitle,
        fieldId: item.fieldId,
        label: item.label,
        from: '(blank)',
        to: item.value.join(', '),
        basis: `Job Category: ${categoryLabel}`,
        confident: true,
      });
    }

    DB.saveReport(currentReport).catch((err) => console.warn('[report] job category prefill failed to save:', err.message || err));
    renderSectionList();
    const names = filled.map((f) => f.label).join(' and ');
    toast(`${names} pre-filled for ${categoryLabel} — check before finalising.`);
  }

  // ---------- Pre-flight check ----------
  // The last thing between a report and a client.
  //
  // Section ticks already show what is outstanding, but they show it on a
  // screen the technician has usually stopped looking at by the time they hit
  // Finalize. Every problem found in past reports — a missing cover photo, a
  // blank concentrate quantity, a temperature of 222 — was visible somewhere
  // if you went looking. Nobody goes looking at 4pm.
  //
  // So this collects everything outstanding into one screen, says why each
  // one matters in the technician's own terms rather than "field required",
  // and takes them straight to it. Compliance items are listed first because
  // those are the ones that cost money later.
  const COMPLIANCE_FIELDS = new Set([
    'windSpeed', 'windDirection', 'temperature', 'inspectionTime', 'applicationFinishTime',
    'products', 'ppeUsed', 'safeToCommence', 'reEntryPeriod', 'inspectorLicence',
    'inspectorSignature', 'clientSignature', 'agreementSignature',
  ]);

  const WHY_IT_MATTERS = {
    coverPhoto: 'The report cover prints a blank band without it.',
    windSpeed: 'Required by the NSW Pesticides Regulation for outdoor spraying.',
    windDirection: 'Required by the NSW Pesticides Regulation for outdoor spraying.',
    temperature: 'Recorded with the pesticide application.',
    inspectionTime: 'The regulation requires both a start and a finish time.',
    applicationFinishTime: 'The regulation requires both a start and a finish time.',
    products: 'The pesticide-use record is incomplete without it.',
    ppeUsed: 'Part of the safety record for a chemical application.',
    clientPhone: 'Needed to reach the client about the follow-up.',
    inspectorLicence: 'A pest report without a licence number is not much of a document.',
  };

  function preflightItems() {
    const schema = currentSchema();
    const utils = window.ReportSchemaUtils;
    if (!utils || !utils.reportValidationErrors) return [];
    const errors = utils.reportValidationErrors(schema, currentReport.sections || {});
    return errors
      .map((error) => ({
        ...error,
        compliance: COMPLIANCE_FIELDS.has(error.fieldId),
        why: WHY_IT_MATTERS[error.fieldId] || '',
      }))
      .sort((a, b) => (b.compliance ? 1 : 0) - (a.compliance ? 1 : 0));
  }

  function renderPreflight() {
    if (!preflightCard || !preflightBody) return [];
    const items = preflightItems();

    if (!items.length) {
      preflightCard.classList.remove('hidden');
      preflightCard.classList.add('preflight-clear');
      preflightBody.innerHTML =
        '<p class="preflight-ok">✓ Nothing outstanding. Every required answer is in and every value looks sane.</p>';
      return items;
    }

    preflightCard.classList.remove('hidden');
    preflightCard.classList.remove('preflight-clear');
    const complianceCount = items.filter((i) => i.compliance).length;
    const heading = complianceCount
      ? `${items.length} to fix before sending — ${complianceCount} of them compliance`
      : `${items.length} to fix before sending`;

    const rows = items.map((item, i) => `
      <li class="preflight-item${item.compliance ? ' preflight-compliance' : ''}" data-section="${escapeHtml(item.sectionId)}" data-index="${i}">
        <span class="preflight-where">${escapeHtml(item.sectionTitle)}</span>
        <span class="preflight-what">${escapeHtml(item.message)}</span>
        ${item.why ? `<span class="preflight-why">${escapeHtml(item.why)}</span>` : ''}
      </li>`).join('');

    preflightBody.innerHTML = `<p class="preflight-heading">${escapeHtml(heading)}</p><ul class="preflight-list">${rows}</ul>`;

    // Tap an item to land in the section that owns it, rather than making the
    // technician find it again.
    preflightBody.querySelectorAll('.preflight-item').forEach((el) => {
      el.addEventListener('click', () => {
        const sectionId = el.getAttribute('data-section');
        if (sectionId) openSectionEditor(sectionId);
      });
    });
    return items;
  }

  function renderSectionList() {
    renderPreflight();
    renderAuditTrail();
    renderSchemaNotice();
    reportSectionList.innerHTML = '';
    let allRequiredGreen = true;

    for (const section of currentSchema()) {
      const values = currentReport.sections[section.id] || {};
      const status = computeSectionStatus(section, values);
      if (status !== 'green' && !section.softRequired) allRequiredGreen = false;

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
    // Send/Save only make sense once the report is actually finalized —
    // stays visible on reopen too, so a technician can come back and send
    // it later without having to re-finalize.
    if (finalizePostActions) finalizePostActions.classList.toggle('hidden', !currentReport.finalizedAt);
  }

  reportBackBtn.addEventListener('click', async () => {
    hide(viewReport);
    show(document.getElementById('view-job'));
    if (window.refreshJobViewStatus) await window.refreshJobViewStatus(currentJobId);
  });

  finalizeBtn.addEventListener('click', async () => {
    if (finalizeBtn.disabled) return;
    if (!confirm('Finalize this report? You can still reopen sections to make corrections afterwards — each correction is recorded in the audit trail with a reason.')) return;
    // Recorded before finalizedAt is set, so the event itself is correctly
    // stamped afterFinalize: false — this is the moment of sign-off, not an
    // amendment to an already-signed document.
    appendAudit(currentReport, { event: 'finalized' });
    currentReport.finalizedAt = Date.now();
    await DB.saveReport(currentReport);
    await DB.updateJob(currentJobId, {
      status: 'completed',
      nextDueAt: computeNextDueAt(currentJob, currentReport),
    });
    toast('Report finalized');
    renderSectionList();
    if (window.refreshJobViewStatus) await window.refreshJobViewStatus(currentJobId);
    offerForemanFollowUpTask(currentJobId);
  });

  // When is this property next due? Termite reports carry a recommended
  // re-inspection interval (AS 3660.2 recommends no more than 12 months, and
  // shorter on high-risk sites); pest treatments carry an explicit follow-up
  // date. Returns epoch ms, or null when the report gives us nothing to go on
  // — better to show no due date than to invent one.
  function computeNextDueAt(job, report) {
    const sections = (report && report.sections) || {};
    if (job && job.jobType === 'pest_treatment') {
      const recs = sections.recommendations || {};
      if (recs.followUpRequired !== 'Yes' || !recs.followUpDate) return null;
      const due = Date.parse(recs.followUpDate + 'T09:00:00');
      return Number.isFinite(due) ? due : null;
    }

    const months = { '3 months': 3, '6 months': 6, '12 months': 12 }[(sections.findings || {}).reinspectionInterval];
    if (!months) return null;
    // Count forward from the inspection date rather than today, so finalizing
    // a report late doesn't quietly push the whole schedule out.
    const client = sections.clientDetails || {};
    const base = client.inspectionDate ? new Date(client.inspectionDate + 'T09:00:00') : new Date();
    if (!Number.isFinite(base.getTime())) return null;
    const due = new Date(base);
    due.setMonth(due.getMonth() + months);
    return due.getTime();
  }

  // The technician decides when to actually send, via the "Send Report"
  // button that appears once finalized (renderSectionList) — nothing emails
  // automatically just because the report was finalized.
  // Guarded: a GitHub Pages deploy can take a minute or two to fully
  // propagate through its CDN, so a page loaded mid-propagation can end up
  // with a mismatched index.html (missing these buttons) paired with a
  // newer report.js that expects them. Without this guard, a null element
  // here throws at script-load time and aborts everything below it in this
  // file — which previously masqueraded as "Finish Inspection hangs", since
  // openReview() depends on code defined later in this same script.
  if (reportSendBtn) reportSendBtn.addEventListener('click', () => emailReport(currentJobId));

  // "Save Report" is a no-op beyond what's already true: the report is
  // saved continuously as it's edited. This just lets the technician
  // confirm they're done without being forced through the send flow.
  if (reportSaveBtn) reportSaveBtn.addEventListener('click', () => toast('Report saved'));

  // Emails the finalized report's PDF to the client, prefilled with the
  // job's saved clientEmail if there is one. Cancelling the prompt (or
  // leaving it blank) skips sending entirely — this is a real message to a
  // real client, so it's always an explicit per-report confirmation, never
  // silent/automatic.
  async function emailReport(jobId) {
    if (!window.EmailService) { toast('Email sending is not set up.'); return; }
    try {
      const job = await DB.getJob(jobId);
      const defaultEmail = job.clientEmail || '';
      const recipientEmail = window.prompt(
        'Send the finalized report to the client.\n\nEnter their email address (or Cancel to skip):',
        defaultEmail
      );
      if (!recipientEmail || !recipientEmail.trim()) return;

      // toast() auto-hides after ~2.2s, but PDF generation + uploading a
      // multi-MB attachment over a real mobile connection can genuinely take
      // much longer than that — re-toast on an interval so the message
      // doesn't vanish while it's still working and get mistaken for a hang.
      toast('Generating PDF and sending…');
      let waitedSeconds = 0;
      const keepAlive = setInterval(() => {
        waitedSeconds += 3;
        toast('Still sending the report… (' + waitedSeconds + 's)');
      }, 3000);
      try {
        const pdfBlob = await generateReportPdfBlob(job, currentReport);
        const clientDetails = currentReport.sections.clientDetails || {};
        await window.EmailService.sendReportEmail({
          recipientEmail: recipientEmail.trim(),
          recipientName: clientDetails.clientName || job.name,
          jobName: job.name,
          jobType: job.jobType,
          pdfBlob,
        });
      } finally {
        clearInterval(keepAlive);
      }
      toast('Report emailed to ' + recipientEmail.trim());
    } catch (err) {
      console.error('[report] email send failed:', err);
      toast('Could not email the report: ' + (err.message || err));
    }
  }

  // DELIBERATE, KEEP: Foreman is a companion app Tal is building; this hook
  // is the join between them, not leftover scaffolding. It looks dormant
  // because it no-ops unless the technician has a Foreman workspace.
  //
  // Cross-app hook (optional, non-blocking): Foreman and Field Inspect now
  // share one Supabase project (own `foreman` schema, same login) — see the
  // plan's "shared login + cross-app talk" addendum. If this technician
  // also has a Foreman workspace, offer to drop a follow-up task there.
  // Wrapped so any failure (not signed in, offline, Foreman schema not set
  // up yet) never affects report finalization, which already succeeded above.
  async function offerForemanFollowUpTask(jobId) {
    try {
      if (!window.supabaseClient || !window.Sync || !window.Sync.currentUserId()) return;
      const uid = window.Sync.currentUserId();
      const { data: membership } = await window.supabaseClient
        .schema('foreman').from('memberships').select('org_id').eq('user_id', uid).limit(1).maybeSingle();
      if (!membership) return;

      const job = await DB.getJob(jobId);
      const who = job.clientEmail || job.clientPhone || job.name;
      if (!confirm(`Also add a Foreman task to send this report to ${who}?`)) return;

      await window.supabaseClient.schema('foreman').from('tasks').insert({
        org_id: membership.org_id,
        title: `Send finalized report to ${who}`,
        description: `Job: ${job.name}${job.address ? ` (${job.address})` : ''}`,
        status: 'todo',
        source: 'manual',
        created_by: uid,
      });
      toast('Added to Foreman');
    } catch (e) {
      console.warn('[report] Foreman follow-up task skipped:', e.message || e);
    }
  }

  reportExportBtn.addEventListener('click', () => exportPdf());

  // ---------- Section editor ----------
  // Per-login Inspector Details defaults, keyed by the technician's Supabase
  // Auth email (case-insensitive). Extend this table as more technicians
  // are added; anyone not listed just gets blank fields as before.
  const INSPECTOR_DEFAULTS_BY_EMAIL = {
    'talpavlich@hotmail.com': {
      inspectorName: 'Tal Pavlich',
      inspectorAddress: 'Ingleburn',
      inspectorLicence: '5095443',
      inspectorPhone: '0291271320', // Arcadian Pest Solutions office number (matches providerPhone's default)
    },
  };

  // Merges AI-suggested values into pendingSectionValues, same rule
  // everywhere: only replaces a field that's still empty or still sitting
  // at its untouched schema default, flagging it in aiAppliedFieldIds so
  // renderField can mark it. Shared by report-level AI Draft suggestions
  // (openSectionEditor) and single-section photo-triggered suggestions
  // (applySectionPhotoAiResults below).
  function applyDraftFieldsToPending(section, draftFieldsForSection) {
    for (const [fieldId, suggestedValue] of Object.entries(draftFieldsForSection || {})) {
      const current = pendingSectionValues[fieldId];
      const fieldDef = section.fields.find((f) => f.id === fieldId);
      const isEmpty = current === undefined || current === null || current === '' ||
        (Array.isArray(current) && current.length === 0);
      const isUntouchedDefault = fieldDef && fieldDef.default !== undefined && current === fieldDef.default;
      if ((isEmpty || isUntouchedDefault) && suggestedValue !== undefined && suggestedValue !== null && suggestedValue !== '') {
        pendingSectionValues[fieldId] = suggestedValue;
        aiAppliedFieldIds.add(fieldId);
      }
    }
  }

  // Re-renders the currently-open section's fields from the current
  // pendingSectionValues, without resetting it from the saved report (unlike
  // openSectionEditor, which would discard any in-progress unsaved edits —
  // needed so photo-triggered AI suggestions can refresh the visible fields
  // while the technician is still mid-edit on this section).
  function renderCurrentSectionFields() {
    const section = findSection(currentSectionId);
    revokeAllUrls();
    sectionFieldsEl.innerHTML = '';
    if (section.id === 'summary') {
      if (currentJob && currentJob.jobType === 'pest_treatment') renderPestTreatmentSummary();
      else renderSummary();
    } else if (section.id === 'terms') {
      renderFixedTerms();
    } else {
      for (const field of section.fields) {
        renderField(field);
      }
    }
  }

  // Called after a triggersAiFill photos field's background analysis
  // completes. Only applies if the technician is still looking at that same
  // section (otherwise it'd be a surprising change to a screen they've
  // already left) — the result isn't lost, it's still sitting in
  // currentReport.aiDraft for next time that section opens.
  async function applySectionPhotoAiResults(sectionId, draftFieldsForSection) {
    if (currentSectionId !== sectionId) return;
    const section = findSection(sectionId);
    applyDraftFieldsToPending(section, draftFieldsForSection);
    renderCurrentSectionFields();
    toast('AI suggestions added below from your photos — review and adjust as needed');
  }

  async function getCurrentUserEmail() {
    if (!window.supabaseClient) return null;
    try {
      const { data } = await window.supabaseClient.auth.getSession();
      return data && data.session && data.session.user ? data.session.user.email : null;
    } catch (err) {
      return null;
    }
  }

  // Takes a working copy of a section's saved values, deep enough that
  // editing it can't reach back into currentReport. A plain spread only
  // copies the top level, so arrays of objects (productList entries, photo
  // lists) stayed shared by reference — editing one then pressing Back to
  // discard still mutated the saved report, and the change got written out
  // by the next unrelated section save. Photo entries hold Blobs, which
  // structuredClone/JSON would either duplicate wastefully or destroy, so
  // arrays are cloned one level down and their non-photo objects copied.
  function cloneSectionValues(values) {
    const out = {};
    for (const [fieldId, value] of Object.entries(values || {})) {
      if (Array.isArray(value)) {
        out[fieldId] = value.map((entry) => (
          entry && typeof entry === 'object' && !('blob' in entry) ? { ...entry } : entry
        ));
      } else {
        out[fieldId] = value;
      }
    }
    return out;
  }

  async function openSectionEditor(sectionId) {
    currentSectionId = sectionId;
    const section = findSection(sectionId);
    pendingSectionValues = cloneSectionValues(currentReport.sections[sectionId]);

    if (sectionId === 'inspector') {
      const email = await getCurrentUserEmail();
      const defaults = email && INSPECTOR_DEFAULTS_BY_EMAIL[email.toLowerCase()];
      if (defaults) {
        for (const [fieldId, value] of Object.entries(defaults)) {
          const current = pendingSectionValues[fieldId];
          const isEmpty = current === undefined || current === null || current === '';
          if (isEmpty) pendingSectionValues[fieldId] = value;
        }
      }
    }

    // Pre-fill any AI-suggested value for fields the technician hasn't
    // genuinely answered yet — either still empty, or still sitting at the
    // schema's generic typical default (see defaultValuesForSection in
    // report-schema.js). A real human edit away from the default is never
    // overwritten; only untouched fields get the AI's evidence-based value,
    // flagged via aiAppliedFieldIds so renderField can mark them, cleared
    // the moment the technician actually touches that field.
    aiAppliedFieldIds = new Set();
    const aiFieldsForSection = (currentReport.aiDraft && currentReport.aiDraft.draftFields && currentReport.aiDraft.draftFields[sectionId]) || {};
    applyDraftFieldsToPending(section, aiFieldsForSection);

    sectionTitleEl.textContent = `${section.number}. ${section.title}`;
    sectionSubtitleEl.textContent = section.subtitle || '';

    renderCurrentSectionFields();

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

    if (aiAppliedFieldIds.has(field.id)) {
      row.classList.add('ai-suggested-value');
      const note = document.createElement('span');
      note.className = 'ai-suggested-note';
      // Naming the photograph the answer came from turns "the computer said
      // so" into something the technician can check in two seconds.
      const reasons = (currentReport.aiDraft && currentReport.aiDraft.fieldReasons
        && currentReport.aiDraft.fieldReasons[currentSectionId]) || {};
      const why = reasons[field.id];
      note.textContent = why
        ? `✨ AI suggested — ${why}`
        : '✨ AI suggested — review and edit if needed';
      row.appendChild(note);

      // A single delegated listener covers every field type (text inputs,
      // selects, yesno buttons, multiselect checkboxes) without needing to
      // touch each renderer's own event handler — once the technician
      // interacts with it at all, it's no longer just a suggestion.
      const clearMark = () => {
        aiAppliedFieldIds.delete(field.id);
        row.classList.remove('ai-suggested-value');
        note.remove();
      };
      row.addEventListener('input', clearMark, { once: true });
      row.addEventListener('change', clearMark, { once: true });
      row.addEventListener('click', (e) => { if (e.target.closest('button, input[type="checkbox"]')) clearMark(); });
    }

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
    } else if (field.type === 'choiceCards') {
      // A single-pick set of big tappable cards rather than a dropdown —
      // built for jobCategory, where the choice itself is the useful action
      // (it prefills PPE and equipment elsewhere in the report), not just a
      // value to record. See applyJobCategoryPrefill.
      const wrap = document.createElement('div');
      wrap.className = 'choice-cards';
      for (const cat of field.categories || []) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'choice-card' + (pendingSectionValues[field.id] === cat.label ? ' active' : '');
        card.innerHTML = `<span class="choice-card-label">${escapeHtml(cat.label)}</span>`
          + (cat.blurb ? `<span class="choice-card-blurb">${escapeHtml(cat.blurb)}</span>` : '');
        card.addEventListener('click', () => {
          pendingSectionValues[field.id] = cat.label;
          wrap.querySelectorAll('.choice-card').forEach((c) => c.classList.remove('active'));
          card.classList.add('active');
          if (field.id === 'jobCategory') applyJobCategoryPrefill(cat.label);
        });
        wrap.appendChild(card);
      }
      row.appendChild(wrap);
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

      function addChip(opt, isCustom) {
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
        chip.appendChild(document.createTextNode(opt + (isCustom ? ' (custom)' : '')));
        wrap.insertBefore(chip, wrap.lastElementChild); // keep the add-row pinned at the bottom
      }

      const addRow = document.createElement('div');
      addRow.className = 'row gap multiselect-add-row';
      const addInput = document.createElement('input');
      addInput.type = 'text';
      addInput.placeholder = 'Add other…';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-secondary';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => {
        const val = addInput.value.trim();
        if (!val || current.has(val)) return;
        current.add(val);
        pendingSectionValues[field.id] = Array.from(current);
        addInput.value = '';
        addChip(val, true);
      });
      addRow.appendChild(addInput);
      addRow.appendChild(addBtn);
      wrap.appendChild(addRow);

      for (const opt of field.options) addChip(opt, false);
      // Already-saved values not in the fixed option list (added via "+ Add"
      // on a previous edit) still need to render, or they'd silently vanish
      // from view despite still being part of the saved value.
      for (const val of current) {
        if (!field.options.includes(val)) addChip(val, true);
      }

      row.appendChild(wrap);
    } else if (field.type === 'photos') {
      row.appendChild(renderPhotosField(field));
    } else if (field.type === 'signature') {
      row.appendChild(renderSignatureField(field));
    } else if (field.type === 'sketch') {
      row.appendChild(renderSketchField(field));
    } else if (field.type === 'productList') {
      row.appendChild(renderProductListField(field));
    } else if (field.type === 'stationList') {
      row.appendChild(renderStationListField(field));
    }

    sectionFieldsEl.appendChild(row);
  }


  // Per-station records for a termite baiting system service.
  //
  // Deliberately not the chemical product list wearing a different label: a
  // station has a number, a physical condition and a bait status, and none of
  // that is a product. Sharing the renderer would have meant asking for a
  // dilution rate on a bait station.
  //
  // The whole row is chips rather than typing. A service visit is 8 to 20
  // stations, and anything that takes typing per station gets abbreviated to
  // "all OK" by station six — which is how a service record stops being a
  // record. Adding a station is one tap; a status is one tap.
  const STATION_STATUS = ['No activity', 'Termite activity', 'Bait taken', 'Bait exhausted', 'Damaged', 'Missing', 'Buried'];
  const STATION_ACTION = ['Nothing required', 'Bait replenished', 'Bait replaced', 'Station repaired', 'Station replaced', 'Station relocated', 'Cleared of debris'];

  function renderStationListField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'station-list-field';
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'station-list-cards';

    const stations = pendingSectionValues[field.id] || [];
    pendingSectionValues[field.id] = stations;

    function chipRow(labelText, options, current, onPick) {
      const row = document.createElement('div');
      row.className = 'station-chip-row';
      row.appendChild(Object.assign(document.createElement('span'), {
        className: 'station-chip-label', textContent: labelText,
      }));
      const chips = document.createElement('div');
      chips.className = 'station-chips';
      for (const option of options) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'station-chip' + (current === option ? ' active' : '');
        chip.textContent = option;
        chip.addEventListener('click', () => onPick(option));
        chips.appendChild(chip);
      }
      row.appendChild(chips);
      return row;
    }

    function redraw() {
      cardsWrap.innerHTML = '';
      if (!stations.length) {
        cardsWrap.appendChild(Object.assign(document.createElement('p'), {
          className: 'empty-hint',
          textContent: 'No stations recorded yet — tap "+ Add Station" for each one you checked.',
        }));
      }

      stations.forEach((station, idx) => {
        const card = document.createElement('div');
        // Anything that isn't a clean "no activity" is worth seeing at a
        // glance when scrolling back through twenty stations.
        const notable = station.status && station.status !== 'No activity';
        card.className = 'station-card' + (notable ? ' station-notable' : '');

        const header = document.createElement('div');
        header.className = 'station-card-header';
        const numberInput = document.createElement('input');
        numberInput.type = 'text';
        numberInput.className = 'station-number';
        numberInput.value = station.stationNumber || String(idx + 1);
        numberInput.setAttribute('aria-label', 'Station number');
        numberInput.addEventListener('input', () => { station.stationNumber = numberInput.value; });
        const label = document.createElement('span');
        label.className = 'station-card-title';
        label.textContent = 'Station';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'product-card-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => { stations.splice(idx, 1); redraw(); });
        header.appendChild(label);
        header.appendChild(numberInput);
        header.appendChild(removeBtn);
        card.appendChild(header);

        card.appendChild(chipRow('Found', STATION_STATUS, station.status, (v) => {
          station.status = v;
          redraw();
        }));
        card.appendChild(chipRow('Did', STATION_ACTION, station.action, (v) => {
          station.action = v;
          redraw();
        }));

        // Only ask for detail where something actually happened — a note box
        // on every one of twenty stations is a note box nobody fills in.
        if (notable) {
          const noteRow = document.createElement('div');
          noteRow.className = 'product-card-field';
          noteRow.appendChild(Object.assign(document.createElement('label'), { textContent: 'What you saw' }));
          const note = document.createElement('input');
          note.type = 'text';
          note.placeholder = 'e.g. live workings in the bait matrix';
          note.value = station.note || '';
          note.addEventListener('input', () => { station.note = note.value; });
          noteRow.appendChild(note);
          card.appendChild(noteRow);
        }

        cardsWrap.appendChild(card);
      });
    }
    redraw();

    const controls = document.createElement('div');
    controls.className = 'row gap';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline flex1';
    addBtn.textContent = '+ Add Station';
    addBtn.addEventListener('click', () => {
      stations.push({ id: DB.uid(), stationNumber: String(stations.length + 1) });
      redraw();
    });

    // Most visits are "all of them, all clear". Doing that in one tap and then
    // correcting the two that weren't is far faster than twenty additions, and
    // it produces a complete record rather than a partial one.
    const allClearBtn = document.createElement('button');
    allClearBtn.type = 'button';
    allClearBtn.className = 'btn btn-secondary flex1';
    allClearBtn.textContent = 'All checked, no activity';
    allClearBtn.addEventListener('click', () => {
      const count = Number(window.prompt('How many stations are on this property?', String(stations.length || 8)));
      if (!Number.isFinite(count) || count < 1 || count > 100) return;
      stations.length = 0;
      for (let i = 1; i <= count; i++) {
        stations.push({ id: DB.uid(), stationNumber: String(i), status: 'No activity', action: 'Nothing required' });
      }
      redraw();
    });

    controls.appendChild(addBtn);
    controls.appendChild(allClearBtn);
    wrap.appendChild(cardsWrap);
    wrap.appendChild(controls);
    return wrap;
  }

  // Renders a repeatable list of structured chemical-product records.
  //
  // The product itself is picked from the shelf list in pest-products.js
  // rather than typed, and choosing it fills the active constituent in — the
  // constituent and its concentration are a legal particular of a
  // pesticide-use record, and asking someone to retype "Beta-cyfluthrin
  // 25 g/L, Imidacloprid 50 g/L" on a phone at a job is asking for a
  // transcription error on a document that has to hold up years later.
  //
  // The concentrate field only appears for products that are actually
  // diluted. Every past report examined had it blank on every row, which is
  // unsurprising when it was also being shown for gels and baits, where the
  // honest answer is "not applicable" — a field that can't be answered
  // truthfully teaches people to skip the ones next to it too.
  function renderProductListField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'product-list-field';
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'product-list-cards';

    const products = pendingSectionValues[field.id] || [];
    pendingSectionValues[field.id] = products;

    const AREAS = ['Internal', 'External', 'Roof Void', 'Subfloor', 'Garden / Landscape', 'Bin area'];

    function redraw() {
      cardsWrap.innerHTML = '';
      if (!products.length) {
        cardsWrap.appendChild(Object.assign(document.createElement('p'), {
          className: 'empty-hint',
          textContent: 'No products recorded yet — tap "+ Add Product" for each one you applied.',
        }));
      }

      products.forEach((product, idx) => {
        const readyToUse = window.PestProducts && window.PestProducts.isReadyToUse(product.productName);
        const card = document.createElement('div');
        card.className = 'product-card';

        const header = document.createElement('div');
        header.className = 'product-card-header';
        const title = document.createElement('span');
        title.textContent = product.productName || 'Product ' + (idx + 1);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'product-card-remove';
        removeBtn.textContent = '✕ Remove';
        removeBtn.addEventListener('click', () => { products.splice(idx, 1); redraw(); });
        header.appendChild(title);
        header.appendChild(removeBtn);
        card.appendChild(header);

        // --- product picker ---
        const pickRow = document.createElement('div');
        pickRow.className = 'product-card-field';
        pickRow.appendChild(Object.assign(document.createElement('label'), { textContent: 'Product *' }));
        const select = document.createElement('select');
        select.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: 'Choose a product…' }));
        for (const p of (window.PEST_PRODUCTS || [])) {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = window.PestProducts.productLabel(p);
          if (product.productName === p.name) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => {
          product.productName = select.value;
          // The chemistry travels with the product — never typed.
          product.activeConstituent = window.PestProducts.activeFor(select.value);
          if (window.PestProducts.isReadyToUse(select.value)) delete product.concentrateUsed;
          redraw();
        });
        pickRow.appendChild(select);
        card.appendChild(pickRow);

        if (product.activeConstituent) {
          const active = document.createElement('p');
          active.className = 'product-active';
          active.textContent = 'Active constituent: ' + product.activeConstituent;
          card.appendChild(active);
        }

        // --- areas applied (multi) ---
        const areaRow = document.createElement('div');
        areaRow.className = 'product-card-field';
        areaRow.appendChild(Object.assign(document.createElement('label'), { textContent: 'Applied to *' }));
        const areaWrap = document.createElement('div');
        areaWrap.className = 'product-area-chips';
        product.areaApplied = Array.isArray(product.areaApplied) ? product.areaApplied : [];
        for (const area of AREAS) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'product-area-chip' + (product.areaApplied.includes(area) ? ' active' : '');
          chip.textContent = area;
          chip.addEventListener('click', () => {
            const at = product.areaApplied.indexOf(area);
            if (at >= 0) product.areaApplied.splice(at, 1); else product.areaApplied.push(area);
            redraw();
          });
          areaWrap.appendChild(chip);
        }
        areaRow.appendChild(areaWrap);
        card.appendChild(areaRow);

        // --- quantities ---
        function textRow(labelText, key, placeholder) {
          const row = document.createElement('div');
          row.className = 'product-card-field';
          row.appendChild(Object.assign(document.createElement('label'), { textContent: labelText }));
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = placeholder || '';
          input.value = product[key] || '';
          input.addEventListener('input', () => { product[key] = input.value; });
          row.appendChild(input);
          card.appendChild(row);
        }

        if (!readyToUse) {
          textRow('Concentrate used *', 'concentrateUsed', 'e.g. 60 mL');
          textRow('Total mix applied *', 'totalMixApplied', 'e.g. 8 L');
          textRow('Dilution rate', 'dilutionRate', 'e.g. 8 mL / L');
        } else {
          textRow('Amount applied *', 'totalMixApplied', 'e.g. 35 g, 14 stations');
        }
        textRow('Batch / lot number', 'batchNumber', 'from the label');

        cardsWrap.appendChild(card);
      });
    }
    redraw();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline';
    addBtn.textContent = '+ Add Product';
    addBtn.addEventListener('click', () => {
      products.push({ id: DB.uid(), areaApplied: [] });
      redraw();
    });

    wrap.appendChild(cardsWrap);
    wrap.appendChild(addBtn);
    return wrap;
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

    let aiStatusEl = null;
    let aiAnalysisInFlight = false;
    if (field.triggersAiFill) {
      aiStatusEl = document.createElement('p');
      aiStatusEl.className = 'photo-field-ai-status hidden';
      wrap.appendChild(aiStatusEl);
    }

    async function runAiFillFromPhotos() {
      if (!field.triggersAiFill || !window.AI || !photos.length || aiAnalysisInFlight) return;
      aiAnalysisInFlight = true;
      const sectionIdAtStart = currentSectionId;
      aiStatusEl.textContent = '🤖 Analyzing photo' + (photos.length === 1 ? '' : 's') + '…';
      aiStatusEl.classList.remove('hidden');
      try {
        const result = await window.AI.analyzeSectionPhotos(photos.map((p) => p.blob), sectionIdAtStart, currentJob && currentJob.jobType);
        await applySectionPhotoAiResults(sectionIdAtStart, (result.draftFields && result.draftFields[sectionIdAtStart]) || {});
      } catch (err) {
        console.warn('[report] photo-driven AI fill failed:', err.message || err);
        toast('Could not analyze those photos: ' + (err.message || err));
      } finally {
        aiAnalysisInFlight = false;
        if (aiStatusEl) aiStatusEl.classList.add('hidden');
      }
    }

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
      runAiFillFromPhotos();
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

  function renderSketchField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'sketch-field';

    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 420;
    canvas.className = 'sketch-canvas';
    wrap.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    // The technician's own strokes and labels live on their own offscreen
    // layer rather than being painted straight onto the visible canvas.
    // That separation is what makes the traced outline correctable: the base
    // (grid, aerial photo, polygons) can be re-rendered as many times as the
    // corners are dragged without ever destroying hand-drawn work.
    const ink = document.createElement('canvas');
    ink.width = canvas.width;
    ink.height = canvas.height;
    const inkCtx = ink.getContext('2d');
    inkCtx.strokeStyle = '#1a1a1a';
    inkCtx.lineWidth = 2.5;
    inkCtx.lineJoin = 'round';
    inkCtx.lineCap = 'round';

    function drawGrid() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#eef1f6';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= canvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }

    function saveSnapshot() { pendingSectionValues[field.id] = canvas.toDataURL('image/png'); }

    // ---------- Aerial backdrop ----------
    // Three things can sit underneath the technician's own drawing, and they
    // stack in this order:
    //   backdropImage   — an aerial photo of the property, when no vector
    //                     geometry exists for it and it has to be traced
    //   sitePolygon     — the legal lot boundary from the NSW cadastre,
    //                     drawn dashed: it's the site, not the structure
    //   buildingPolygon — the building's exterior perimeter, drawn solid
    // Any of them can be absent. Exterior shapes only — nothing here ever
    // draws the inside of the house.
    let sitePolygon = null;
    let buildingPolygon = null;
    let backdropImage = null;
    let hasFreehandWork = false;
    let mode = 'draw'; // 'draw' | 'label' | 'corners'

    // Declared up here, not with the rest of the UI at the bottom, because
    // the backdrop loader below reports what it found by rewriting it — and
    // that runs before the controls are built.
    const hint = Object.assign(document.createElement('p'), {
      className: 'empty-hint',
      textContent: 'Draw the outline with your finger, then switch to Add Label and tap anywhere to name a room or flag something. Trace Building reads the exterior perimeter off an aerial photo to start you off.',
    });

    function drawPolygon(polygon, style) {
      ctx.save();
      ctx.strokeStyle = style.stroke;
      ctx.fillStyle = style.fill;
      ctx.lineWidth = style.width;
      if (style.dash) ctx.setLineDash(style.dash);
      ctx.beginPath();
      polygon.forEach(([x, y], i) => {
        const px = x * canvas.width, py = y * canvas.height;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Corner handles are deliberately large: this gets used one-handed on a
    // phone at a job site, so a 9px target with a 22px touch radius (below)
    // is the difference between usable and infuriating.
    function drawCornerHandles() {
      if (!buildingPolygon) return;
      ctx.save();
      buildingPolygon.forEach(([x, y]) => {
        const px = x * canvas.width, py = y * canvas.height;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#2c7a4b';
        ctx.stroke();
      });
      ctx.restore();
    }

    function redrawBase() {
      drawGrid();
      if (backdropImage) ctx.drawImage(backdropImage, 0, 0, canvas.width, canvas.height);
      if (sitePolygon) {
        drawPolygon(sitePolygon, { stroke: '#b26a00', fill: 'rgba(178,106,0,0.05)', width: 2, dash: [6, 4] });
      }
      if (buildingPolygon) {
        drawPolygon(buildingPolygon, { stroke: '#2c7a4b', fill: 'rgba(44,122,75,0.10)', width: 2.5, dash: null });
      }
      ctx.drawImage(ink, 0, 0);
      if (mode === 'corners') drawCornerHandles();
    }

    // Every redraw goes through here so the saved snapshot never drifts out
    // of sync with what's on screen. Handles are a transient editing aid, so
    // the snapshot is taken without them.
    function commit() {
      const editing = mode === 'corners';
      if (editing) { mode = 'draw'; redrawBase(); mode = 'corners'; }
      else redrawBase();
      saveSnapshot();
      if (editing) redrawBase();
    }

    function setBackdropImage(url) {
      return new Promise((resolve) => {
        const img = new Image();
        // The imagery services send Access-Control-Allow-Origin, so this
        // keeps the canvas untainted and saveSnapshot()'s toDataURL() working.
        img.crossOrigin = 'anonymous';
        img.onload = () => { backdropImage = img; resolve(true); };
        img.onerror = () => { console.warn('[report] aerial backdrop image failed to load'); resolve(false); };
        img.src = url;
      });
    }

    // shouldDraw=false when restoring an already-saved sketch: the footprint
    // is still worth fetching so a later redraw has it, but the canvas must
    // not be touched — it already shows the technician's saved work.
    async function loadFootprintData(shouldDraw) {
      if (!(window.Geo && currentJob)) return;
      // Jobs created by typing the address rather than tapping a suggestion
      // carry no coordinates, which is why the mud map often came up blank
      // with nothing said about why. Resolve the address now instead.
      const coords = await window.Geo.ensureJobCoords(currentJob);
      if (!coords) {
        hint.textContent = 'No map location for this address yet, so there is no aerial backdrop. Draw the outline by hand, or check the address on the job.';
        return;
      }
      try {
        const footprint = await window.Geo.fetchFootprint(coords.lat, coords.lng);
        const polygon = footprint.polygon;
        const usable = Array.isArray(polygon) && polygon.length >= 3;

        if (footprint.source === 'osm' && usable) {
          buildingPolygon = polygon;
          hint.textContent = 'Outline loaded from map data. Adjust Corners to correct it, or draw over it.';
        } else if (footprint.source === 'cadastre' && usable) {
          sitePolygon = polygon;
          if (footprint.lotId) hint.textContent = `Site boundary shown for ${footprint.lotId}. Trace the building inside it.`;
        } else if (footprint.source === 'satellite' && footprint.imageUrl) {
          if (!(await setBackdropImage(footprint.imageUrl))) return;
        } else {
          return;
        }

        if (shouldDraw) commit();
      } catch (err) {
        console.warn('[report] aerial backdrop fetch failed:', err.message || err);
      }
    }

    const existing = pendingSectionValues[field.id];
    if (existing) {
      // A saved sketch is a flat image — the polygon behind it is gone, so it
      // is restored onto the ink layer and treated as hand-drawn work.
      const img = new Image();
      img.onload = () => { inkCtx.drawImage(img, 0, 0, canvas.width, canvas.height); redrawBase(); };
      img.src = existing;
      hasFreehandWork = true;
      loadFootprintData(false);
    } else {
      drawGrid();
      loadFootprintData(true);
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
      return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) };
    }

    // ---------- Corner editing ----------
    const GRAB_RADIUS = 22;
    let draggingCorner = -1;
    let lastTapAt = 0;
    let lastTapCorner = -1;

    function cornerAt(p) {
      if (!buildingPolygon) return -1;
      let best = -1, bestDist = GRAB_RADIUS;
      buildingPolygon.forEach(([x, y], i) => {
        const d = Math.hypot(x * canvas.width - p.x, y * canvas.height - p.y);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }

    // Where along the perimeter a tap falls, so tapping an edge can insert a
    // corner the model missed — common where tree canopy hid a whole wing.
    function edgeAt(p) {
      if (!buildingPolygon || buildingPolygon.length < 2) return -1;
      let best = -1, bestDist = 18;
      for (let i = 0; i < buildingPolygon.length; i++) {
        const a = buildingPolygon[i];
        const b = buildingPolygon[(i + 1) % buildingPolygon.length];
        const ax = a[0] * canvas.width, ay = a[1] * canvas.height;
        const bx = b[0] * canvas.width, by = b[1] * canvas.height;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (!lenSq) continue;
        let t = ((p.x - ax) * dx + (p.y - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    }

    function startCornerEdit(e) {
      const p = pos(e);
      const idx = cornerAt(p);
      const now = Date.now();

      if (idx >= 0) {
        // Double-tap a corner to delete it (never below a triangle).
        if (idx === lastTapCorner && now - lastTapAt < 400 && buildingPolygon.length > 3) {
          buildingPolygon.splice(idx, 1);
          lastTapCorner = -1;
          commit();
          e.preventDefault();
          return;
        }
        lastTapCorner = idx;
        lastTapAt = now;
        draggingCorner = idx;
        e.preventDefault();
        return;
      }

      const edge = edgeAt(p);
      if (edge >= 0) {
        buildingPolygon.splice(edge + 1, 0, [p.x / canvas.width, p.y / canvas.height]);
        draggingCorner = edge + 1;
        commit();
      }
      e.preventDefault();
    }

    function moveCorner(e) {
      if (draggingCorner < 0) return;
      const p = pos(e);
      buildingPolygon[draggingCorner] = [
        Math.max(0, Math.min(1, p.x / canvas.width)),
        Math.max(0, Math.min(1, p.y / canvas.height)),
      ];
      redrawBase();
      e.preventDefault();
    }

    function endCornerEdit() {
      if (draggingCorner < 0) return;
      draggingCorner = -1;
      commit();
    }

    // ---------- Freehand drawing ----------
    let drawing = false;
    function start(e) {
      if (mode === 'corners') { startCornerEdit(e); return; }
      if (mode === 'label') {
        const p = pos(e);
        const text = window.prompt('Label for this spot (e.g. Kitchen, High moisture, Damage):', '');
        if (text) {
          inkCtx.fillStyle = '#c0552a';
          inkCtx.beginPath();
          inkCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          inkCtx.fill();
          inkCtx.font = '13px sans-serif';
          inkCtx.fillText(text, p.x + 8, p.y + 4);
          hasFreehandWork = true;
          commit();
        }
        e.preventDefault();
        return;
      }
      drawing = true;
      const p = pos(e);
      inkCtx.beginPath();
      inkCtx.moveTo(p.x, p.y);
      e.preventDefault();
    }

    function move(e) {
      if (mode === 'corners') { moveCorner(e); return; }
      if (!drawing || mode !== 'draw') return;
      const p = pos(e);
      inkCtx.lineTo(p.x, p.y);
      inkCtx.stroke();
      redrawBase();
      e.preventDefault();
    }

    function end() {
      if (mode === 'corners') { endCornerEdit(); return; }
      if (!drawing) return;
      drawing = false;
      hasFreehandWork = true;
      commit();
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    const controls = document.createElement('div');
    controls.className = 'row gap sketch-controls';

    const drawBtn = document.createElement('button');
    drawBtn.type = 'button';
    drawBtn.className = 'btn btn-secondary flex1 active';
    drawBtn.textContent = '✏️ Draw';

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'btn btn-secondary flex1';
    labelBtn.textContent = '🏷️ Add Label';

    const cornersBtn = document.createElement('button');
    cornersBtn.type = 'button';
    cornersBtn.className = 'btn btn-secondary flex1';
    cornersBtn.textContent = '📐 Adjust Corners';

    function setMode(next) {
      if (next === 'corners' && !buildingPolygon) {
        toast('No outline to adjust yet — use Trace Building first, or draw one by hand.');
        return;
      }
      mode = next;
      drawBtn.classList.toggle('active', mode === 'draw');
      labelBtn.classList.toggle('active', mode === 'label');
      cornersBtn.classList.toggle('active', mode === 'corners');
      redrawBase();
      if (mode === 'corners') {
        hint.textContent = 'Drag a corner to move it. Tap an edge to add a corner. Double-tap a corner to delete it.';
      }
    }
    drawBtn.addEventListener('click', () => setMode('draw'));
    labelBtn.addEventListener('click', () => setMode('label'));
    cornersBtn.addEventListener('click', () => setMode('corners'));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-secondary';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      // Clear wipes the technician's own drawing and labels back to the base
      // layer — it does not lose an already-loaded backdrop or outline.
      inkCtx.clearRect(0, 0, ink.width, ink.height);
      hasFreehandWork = false;
      commit();
    });

    // Australian houses are overwhelmingly rectilinear, so a trace read off a
    // partly-obscured roof can be snapped back to right angles: take the
    // dominant wall direction and force every edge onto that axis or its
    // perpendicular. This is deterministic geometry, not another guess — it
    // turns an approximately-right outline into a plausible footprint, and
    // it's the cheapest way to recover from canopy blurring the corners.
    function squareUp(polygon) {
      if (!polygon || polygon.length < 4) return polygon;
      // Aspect-correct so angles are measured in real-world space, not in the
      // canvas's stretched coordinates.
      const ar = canvas.width / canvas.height;
      const pts = polygon.map(([x, y]) => [x * ar, y]);

      let bestAngle = 0, bestLen = -1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > bestLen) { bestLen = len; bestAngle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      }
      const cos = Math.cos(-bestAngle), sin = Math.sin(-bestAngle);
      const rot = pts.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);

      // In the rotated frame every wall should be axis-aligned: for each edge,
      // move whichever coordinate varies less onto a shared value.
      for (let i = 0; i < rot.length; i++) {
        const j = (i + 1) % rot.length;
        const dx = Math.abs(rot[j][0] - rot[i][0]);
        const dy = Math.abs(rot[j][1] - rot[i][1]);
        if (dx < dy) {
          const mid = (rot[i][0] + rot[j][0]) / 2;
          rot[i][0] = mid; rot[j][0] = mid;
        } else {
          const mid = (rot[i][1] + rot[j][1]) / 2;
          rot[i][1] = mid; rot[j][1] = mid;
        }
      }

      const back = rot.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
      return back.map(([x, y]) => [
        Math.max(0, Math.min(1, x / ar)),
        Math.max(0, Math.min(1, y)),
      ]);
    }

    const squareBtn = document.createElement('button');
    squareBtn.type = 'button';
    squareBtn.className = 'btn btn-secondary flex1';
    squareBtn.textContent = '📏 Square Up';
    squareBtn.addEventListener('click', () => {
      if (!buildingPolygon) { toast('No outline to square up yet.'); return; }
      buildingPolygon = squareUp(buildingPolygon);
      commit();
      hint.textContent = 'Corners squared to right angles. Adjust Corners if any wall moved the wrong way.';
    });

    // Reads the building's exterior perimeter off aerial photos and lays it
    // down as the base shape, for when no open dataset has a vector outline
    // for the property — or has one, but for the wrong building. A starting
    // shape to correct, not an answer — hence a button the technician presses
    // rather than something that happens to them.
    const traceBtn = document.createElement('button');
    traceBtn.type = 'button';
    traceBtn.className = 'btn btn-secondary flex1';
    traceBtn.textContent = '🛰️ Trace Building';
    traceBtn.addEventListener('click', async () => {
      if (!(window.Geo && currentJob)) return;
      // The trace itself runs on the Edge Function, unlike the rest of the
      // sketch pad's geo features — so it is the one thing here that needs a
      // signed-in session, and says so rather than appearing to do nothing.
      if (!window.AI) {
        toast('Tracing needs you to be signed in. The aerial backdrop still works — trace the outline by hand.');
        return;
      }
      const label = traceBtn.textContent;
      traceBtn.disabled = true;
      traceBtn.textContent = '🛰️ Tracing…';
      try {
        const coords = await window.Geo.ensureJobCoords(currentJob);
        if (!coords) {
          toast('Could not find this address on the map. Check the address on the job, then try again.');
          return;
        }
        const traced = await window.AI.traceBuildingOutline(coords.lat, coords.lng);
        // Show the photo underneath the outline so the technician can see
        // what was traced and judge it, rather than trusting a bare shape.
        if (!backdropImage && traced.imageUrl) await setBackdropImage(traced.imageUrl);
        buildingPolygon = traced.polygon;
        setMode('corners');
        commit();
        const obscured = traced.obscured ? ` Uncertain near: ${traced.obscured}.` : '';
        hint.textContent = `Traced outline (${traced.confidence} confidence).${traced.note ? ' ' + traced.note : ''}${obscured} Drag any corner that looks wrong.`;
        toast(traced.confidence === 'low'
          ? 'Traced, but the roof was hard to see — check every corner.'
          : 'Outline traced — drag any corner that looks wrong.');
      } catch (err) {
        toast(err.message || 'Could not trace the building outline.');
      } finally {
        traceBtn.disabled = false;
        traceBtn.textContent = label;
      }
    });

    controls.appendChild(drawBtn);
    controls.appendChild(labelBtn);
    controls.appendChild(clearBtn);
    wrap.appendChild(controls);

    const shapeRow = document.createElement('div');
    shapeRow.className = 'row gap sketch-controls';
    shapeRow.appendChild(traceBtn);
    shapeRow.appendChild(cornersBtn);
    shapeRow.appendChild(squareBtn);
    wrap.appendChild(shapeRow);

    wrap.appendChild(hint);
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
      ['Was evidence of borers of seasoned timber found?', findings.borersFound, 'findings'],
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
      textContent: 'This summary updates automatically from your answers in What We Found, Access & Restrictions and Conditions Favouring Attack — tap any row to jump there.',
    }));
    sectionFieldsEl.appendChild(wrap);
  }

  function renderPestTreatmentSummary() {
    const s = (id) => currentReport.sections[id] || {};
    const client = s('clientDetails');
    const pest = s('pestIdentification');
    const treatment = s('treatmentDetails');
    const chemicals = s('chemicals');
    const safety = s('safety');
    const recs = s('recommendations');

    const products = chemicals.products || [];
    const productsSummary = products.map((p) => p.productName).filter(Boolean).join(', ');

    const rows = [
      ['Job category', client.jobCategory, 'clientDetails'],
      ['Target pest(s)', (pest.targetPests || []).join(', '), 'pestIdentification'],
      ['Infestation level', pest.infestationLevel, 'pestIdentification'],
      ['Treatment method(s)', (treatment.treatmentMethods || []).join(', '), 'treatmentDetails'],
      ['Products used', productsSummary, 'chemicals'],
      ['Re-entry period', safety.reEntryPeriod, 'safety'],
      ['Follow-up treatment required?', recs.followUpRequired, 'recommendations'],
    ];

    const wrap = document.createElement('div');
    wrap.className = 'summary-list';
    for (const [label, value, srcSection] of rows) {
      const flagged = value === 'Yes' || value === 'High';
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
      textContent: 'This summary updates automatically from your answers in Client & Site, Target Pests & Evidence, Work Carried Out, Products Applied and Advice & Next Steps — tap any row to jump there.',
    }));
    sectionFieldsEl.appendChild(wrap);
  }

  const FIXED_TERMS_HTML = `
    <p><strong>1. Nature of the Inspection.</strong> This Report does not conclusively determine that the Property is free of timber pests or damage caused by timber pests. The Inspection undertaken was a Non-Invasive, visual Inspection of the Property carried out in accordance with AS 4349.3-2010 (Inspection of buildings — Timber pest inspections), using the inspection methodology of AS 3660.2-2017 where it applies to termite management in and around existing buildings. Use of and reliance upon this Report is solely at the reader's own risk, and only the Client (not any third party) may rely on it.</p>
    <p><strong>2. Scope and exclusions.</strong> This Inspection covers the four timber pest categories within the scope of AS 4349.3-2010: subterranean termites, dampwood termites, borers of seasoned timber, and wood decay fungi. Drywood termites and mould are outside the scope of that Standard. Where evidence of drywood termites or any other pest outside scope is observed, it is noted in the Report as a courtesy (duty to warn), and a specific inspection by a suitably qualified provider is recommended.</p>
    <p><strong>2a. Non-invasive limitation.</strong> No part of the Inspection involved cutting into, dismantling, or removing any part of the building, its linings, coverings or insulation, and furniture and stored articles were not moved. Timber pest activity and damage may be concealed behind or within any of these and remain undetectable by a non-invasive inspection.</p>
    <p><strong>3. Records retention.</strong> Records of this Inspection, including photographs and this Report, are retained by the Inspection Provider for a minimum of three (3) years in accordance with AS 3660.2-2017.</p>
    <p><strong>4. Australian Consumer Law.</strong> Nothing in this Report or these Terms excludes, restricts or modifies any guarantee, warranty, term or condition implied or imposed by the Australian Consumer Law (or any other applicable law) that cannot lawfully be excluded. Where permitted, the Inspection Provider's liability is limited, at its option, to resupply of the Inspection or Report, or payment of the cost of resupply.</p>
    <p><strong>5. Limitations.</strong> The Inspection did not include areas that were inaccessible, obstructed, restricted, or deemed unsafe at the time of Inspection (see "Areas We Were Unable to Inspect"). Non-detectable Termite activity and damage may be present at the Property despite this Inspection.</p>
    <p class="empty-hint">This wording reflects common industry practice and the AS 3660.2-2017 records-retention requirement, but it is not legal advice — have a solicitor review the final terms before relying on them commercially.</p>
  `;

  const FIXED_TERMS_HTML_PEST = `
    <p><strong>1. Nature of the treatment.</strong> This treatment was carried out using registered pest control products in accordance with label directions and relevant state/territory pesticide legislation. Pest treatments reduce pest activity but do not guarantee total elimination or prevent future reinfestation — ongoing monitoring and, where recommended, follow-up treatment may be required.</p>
    <p><strong>2. Chemical use records.</strong> Details of the product(s), batch number(s), and application method used are recorded in this report and retained by the Service Provider for a minimum of three (3) years, as required for pesticide use record-keeping.</p>
    <p><strong>3. Re-entry and withholding.</strong> The Client must observe the re-entry period and any withholding period noted in this report before returning to treated areas or allowing pets/children access, and must comply with any safety directions on the product label.</p>
    <p><strong>4. Australian Consumer Law.</strong> Nothing in this report or these Terms excludes, restricts or modifies any guarantee, warranty, term or condition implied or imposed by the Australian Consumer Law (or any other applicable law) that cannot lawfully be excluded. Where permitted, the Service Provider's liability is limited, at its option, to resupply of the service, or payment of the cost of resupply.</p>
    <p><strong>5. Limitations.</strong> Treatment was limited to the areas accessible and treated as noted in this report. Areas that were inaccessible, obstructed, or outside the agreed scope of work were not treated.</p>
    <p class="empty-hint">This wording reflects common industry practice, but it is not legal advice — have a solicitor review the final terms before relying on them commercially.</p>
  `;

  function renderFixedTerms() {
    const wrap = document.createElement('div');
    wrap.className = 'terms-text';
    wrap.innerHTML = (currentJob && currentJob.jobType === 'pest_treatment') ? FIXED_TERMS_HTML_PEST : FIXED_TERMS_HTML;
    sectionFieldsEl.appendChild(wrap);
  }

  sectionSaveBtn.addEventListener('click', async () => {
    const section = findSection(currentSectionId);
    const changes = diffSection(section, currentReport.sections[currentSectionId], pendingSectionValues);

    // Amending a finalized report is allowed — corrections are a normal part
    // of the job — but it must be deliberate and explained. This mirrors ODK's
    // track-changes-reasons=on-form-edit: the document can change, but not
    // quietly. An unexplained amendment to a signed-off compliance report is
    // exactly what an insurer will ask about.
    let reason = '';
    if (currentReport.finalizedAt && changes.length) {
      const summary = changes.slice(0, 3).map((c) => c.label).join(', ');
      reason = (window.prompt(
        `This report was finalized on ${fmtDate(currentReport.finalizedAt)}.\n\n`
        + `You are amending: ${summary}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}.\n\n`
        + 'Give a brief reason for the amendment (recorded in the report\'s audit trail):',
        ''
      ) || '').trim();
      if (!reason) {
        toast('Amendment cancelled — a reason is required to change a finalized report.');
        return;
      }
    }

    for (const change of changes) {
      appendAudit(currentReport, {
        event: 'field-changed',
        sectionId: currentSectionId,
        sectionTitle: section ? section.title : currentSectionId,
        fieldId: change.fieldId,
        label: change.label,
        from: change.from,
        to: change.to,
        reason,
      });
    }

    currentReport.sections[currentSectionId] = pendingSectionValues;
    await DB.saveReport(currentReport);
    hide(viewReportSection);
    renderSectionList();
    show(viewReport);
    if (reason) toast(`Amendment recorded (${changes.length} field${changes.length === 1 ? '' : 's'}).`);
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

  const REPORT_PDF_STYLE = `
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
    .sketch-page{page-break-before:always;}
    .amendments-page{page-break-before:always;}
    .amendments-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;}
    .amendments-table th,.amendments-table td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;}
    .amendments-table th{background:#f2f2f2;}
    .sketch-img{max-width:100%;border:1px solid #ddd;border-radius:4px;}
    .product-pdf-card{border:1px solid #ccc;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:13px;}
    .product-pdf-title{font-weight:bold;font-size:14px;margin-bottom:4px;}
    @media print { .no-print{display:none;} }
  `;

  // Builds the report's HTML body content (no <html>/<head> wrapper) — the
  // single source of truth for both the print-preview export and the
  // PDF-for-email generation below, so they can never drift apart.
  // trackedUrls, if provided, collects any object URLs created for photos so
  // the caller can revoke them once done (the print-window path doesn't
  // bother, since closing that tab/window naturally releases them; the PDF
  // path does, since it runs in the current page's lifetime).
  function buildReportBodyHtml(job, report, trackedUrls) {
    const isPestTreatment = job && job.jobType === 'pest_treatment';
    // AS 3660.2 governs HOW an existing building is inspected; AS 4349.3
    // governs WHAT the resulting timber pest report must contain. They work
    // as a pair, and a pre-purchase report is judged against 4349.3 — citing
    // only 3660.2 left the report silent on the standard it's measured by.
    const standardLine = isPestTreatment
      ? 'Chemical Application Record'
      : 'In Accordance with AS 4349.3-2010 and AS 3660.2-2017';
    let html = `<div class="brand">ARCADIAN PEST SOLUTIONS</div>
      <h1>${escapeHtml(reportTitleFor(job && job.jobType, report))}</h1>
      <p>${standardLine}<br>${escapeHtml(job ? job.address : '')}</p>`;

    for (const section of schemaFor(job && job.jobType, report)) {
      const values = report.sections[section.id] || {};
      html += `<div class="section"><div class="section-head" style="background:${section.color}"><h2>${section.number}. ${escapeHtml(section.title)}</h2></div>`;

      if (section.id === 'summary') {
        html += isPestTreatment
          ? `<p>See Target Pests & Evidence, Work Carried Out, Products Applied and Advice & Next Steps sections for full detail.</p>`
          : `<p>See What We Found, Access & Restrictions and Conditions Favouring Attack sections for full detail.</p>`;
      } else if (section.id === 'terms') {
        html += isPestTreatment ? FIXED_TERMS_HTML_PEST : FIXED_TERMS_HTML;
      } else if (section.fixed) {
        for (const field of section.fields) {
          const val = values[field.id] !== undefined ? values[field.id] : field.default;
          if (!val) continue;
          html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(val)}</div></div>`;
        }
      } else {
        for (const field of section.fields) {
          if (!isFieldVisible(field, values)) continue;
          const val = values[field.id];
          if (field.type === 'photos') {
            const photos = val || [];
            if (!photos.length) continue;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="photos">`;
            for (const p of photos) {
              const url = URL.createObjectURL(p.blob);
              if (trackedUrls) trackedUrls.push(url); else trackUrl(url);
              html += `<img src="${url}">`;
            }
            html += `</div></div>`;
          } else if (field.type === 'signature') {
            if (!val) continue;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><img class="sig" src="${val}"></div>`;
          } else if (field.type === 'sketch') {
            if (!val) continue;
            html += `<div class="field sketch-page"><div class="field-label">${escapeHtml(field.label)}</div><img class="sketch-img" src="${val}"></div>`;
          } else if (field.type === 'productList') {
            const products = val || [];
            if (!products.length) continue;
            // A real pesticide-use table, not a stack of cards: this is the
            // part a regulator or an insurer reads, and it should look like a
            // record rather than a form dump.
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div>`;
            html += `<table class="product-pdf-table"><thead><tr>`
              + `<th>Product</th><th>Active constituent</th><th>Applied to</th>`
              + `<th>Concentrate</th><th>Total applied</th><th>Batch</th>`
              + `</tr></thead><tbody>`;
            for (const p of products) {
              const areas = Array.isArray(p.areaApplied) ? p.areaApplied.join(', ') : (p.areaApplied || '');
              html += `<tr>`
                + `<td>${escapeHtml(p.productName || '')}</td>`
                + `<td>${escapeHtml(p.activeConstituent || '')}</td>`
                + `<td>${escapeHtml(areas)}</td>`
                + `<td>${escapeHtml(p.concentrateUsed || '—')}</td>`
                + `<td>${escapeHtml(p.totalMixApplied || '')}</td>`
                + `<td>${escapeHtml(p.batchNumber || '')}</td>`
                + `</tr>`;
            }
            html += `</tbody></table></div>`;
          } else if (field.type === 'stationList') {
            const stations = val || [];
            if (!stations.length) continue;
            const notable = stations.filter((s) => s.status && s.status !== 'No activity').length;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div>`;
            html += `<div class="field-value">${stations.length} station${stations.length === 1 ? '' : 's'} inspected`
              + (notable ? `, ${notable} requiring attention` : ', all clear') + `.</div>`;
            html += `<table class="product-pdf-table"><thead><tr>`
              + `<th>Station</th><th>Found</th><th>Action taken</th><th>Notes</th>`
              + `</tr></thead><tbody>`;
            for (const s of stations) {
              html += `<tr>`
                + `<td>${escapeHtml(s.stationNumber || '')}</td>`
                + `<td>${escapeHtml(s.status || '')}</td>`
                + `<td>${escapeHtml(s.action || '')}</td>`
                + `<td>${escapeHtml(s.note || '')}</td>`
                + `</tr>`;
            }
            html += `</tbody></table></div>`;
          } else {
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(fmtVal(val))}</div></div>`;
          }
        }
      }
      html += `</div>`;
    }
    html += buildAmendmentsAppendixHtml(report);
    return html;
  }

  // A report that was corrected after sign-off and reissued should say so on
  // its face. If the first copy a client received said one thing and the copy
  // produced later says another, the difference belongs in the document — not
  // only in an audit log the client never sees.
  //
  // Only post-finalization amendments appear. Ordinary edits made while the
  // report was still being written are working notes, not amendments, and
  // printing them would bury the ones that matter.
  function buildAmendmentsAppendixHtml(report) {
    const amendments = ((report && report.auditLog) || []).filter((e) => e.afterFinalize && e.event === 'field-changed');
    if (!amendments.length) return '';

    const rows = amendments
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((e) => `
        <tr>
          <td>${escapeHtml(fmtAuditTime(e.at))}</td>
          <td>${escapeHtml(e.sectionTitle || e.sectionId || '')}<br><strong>${escapeHtml(e.label || e.fieldId || '')}</strong></td>
          <td>${escapeHtml(e.from)} &rarr; ${escapeHtml(e.to)}</td>
          <td>${escapeHtml(e.reason || '')}</td>
          <td>${escapeHtml(e.userEmail || 'unknown')}</td>
        </tr>`)
      .join('');

    return `
      <div class="section amendments-page">
        <h2>Appendix — Amendments After Finalisation</h2>
        <p class="field-value">This report was finalised on ${escapeHtml(fmtAuditTime(report.finalizedAt))} and has been amended ${amendments.length} time${amendments.length === 1 ? '' : 's'} since. Each amendment is listed below with the reason recorded at the time.</p>
        <table class="amendments-table">
          <thead><tr><th>When</th><th>Field</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  async function exportPdf() {
    const job = await DB.getJob(currentJobId);
    const printWin = window.open('', '_blank');
    if (!printWin) { toast('Allow pop-ups to export the PDF'); return; }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(reportTitleFor(job && job.jobType, currentReport))}</title>
      <style>${REPORT_PDF_STYLE}</style></head><body>
      <p><button class="no-print" onclick="window.print()">Print / Save as PDF</button></p>
      ${buildReportBodyHtml(job, currentReport)}
      </body></html>`;

    printWin.document.write(html);
    printWin.document.close();
  }

  // Renders the report and rasterizes it into a real PDF Blob via
  // html2pdf.js (loaded in index.html) — needed for emailing, since a
  // print-preview window requires the user's own "Save as PDF" interaction
  // and produces no Blob we could ever attach to anything programmatically.
  //
  // html2canvas (which html2pdf uses internally) captures based on the
  // element's actual on-screen position — an element parked at a large
  // negative offset to "hide" it isn't in real viewport space and captures
  // blank. So this renders as a genuine full-screen overlay instead (with a
  // "Generating…" backdrop, since it's only up for well under a second) —
  // the reliable pattern for this, not a cosmetic choice.
  async function generateReportPdfBlob(job, report) {
    if (!window.html2pdf) throw new Error('PDF library not loaded');
    const trackedUrls = [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow:auto;';
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.margin = '0 auto';
    const style = document.createElement('style');
    style.textContent = REPORT_PDF_STYLE;
    container.appendChild(style);
    const content = document.createElement('div');
    content.innerHTML = buildReportBodyHtml(job, report, trackedUrls);
    container.appendChild(content);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    try {
      // Let every <img> (photos, signature, sketch) actually finish loading
      // before rasterizing — html2canvas captures whatever's rendered at
      // that instant, so a still-loading image would just come out blank.
      const images = Array.from(container.querySelectorAll('img'));
      await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      })));
      // One extra frame so layout/paint has genuinely settled before capture.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const blob = await window.html2pdf()
        .set({ margin: 10, filename: 'report.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'pt', format: 'a4' } })
        .from(container)
        .outputPdf('blob');
      return blob;
    } finally {
      document.body.removeChild(overlay);
      trackedUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  }
})();
