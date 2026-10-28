// ===========================================================================
// report.js - the report editor, pre-flight checks and AI draft. (The print
// view is report-print.js.)
//
// The biggest file. It turns a job's photos plus a schema (report-schema.js,
// pest-treatment-schema.js, termite-management-schemas.js) into a finished,
// signed, printable document.
//
// WHERE THINGS ARE (search for the "// ---------- name ----------" banners):
//   Document types ............ which schema each document type uses
//   Element refs / State ...... DOM handles and the report being edited
//   Audit trail ............... who changed what (stored on the report)
//   Is the AI any good? ....... accuracy tally of AI suggestions kept/changed
//   Report load / prefill ..... open or create; fill from job + business
//   Public entry point ........ window.ReportUI.open(...)
//   AI Draft .................. calls ai.js and merges suggestions
//   Saved Reports archive ..... list of finalised reports
//   Audit trail + schema UI ... history sheet; schema-version notice
//   Site fields from address .. suburb/postcode/state derivation
//   Pre-flight check .......... "is this report ready to sign?" gate
//   Section editor / autosave . one section at a time; drafts in IndexedDB
//   the form renderer ......... field types -> controls (largest block); the
//                               site sketch pad is report-sketch.js (v128)
//   PDF export (print view) ... a bridge to report-print.js, which builds the
//                               printed document and the emailed PDF (v127)
//
// EXPOSES (window): ReportUI. DEPENDS ON: DB, HtmlSafe, FormRender, Dialog,
//   Sync, Org, AI, Media, EmailService, Backup, QrScan, schemas (see facts in
//   docs/ARCHITECTURE.md).
// STORAGE: IndexedDB through DB.* (reports, section drafts, captures, jobs).
// SECURITY: all interpolated text goes through HtmlSafe.escape; stored images
//   (signature, sketch) go through HtmlSafe.imageSrc, which only accepts a
//   base64 png/jpeg/webp data URL. The print window uses document.write and an
//   inline onclick="window.print()" - both confined to that window, which
//   contains only markup built here.
// TESTS: tests/run-tests.js (report, gate, schema, print groups).
// KNOWN DEBT: still 3,600 lines in one closure. The print view
//   (report-print.js, v127) and the site sketch pad (report-sketch.js, v128)
//   are out; the rest of the form renderer shares the editor's state and
//   would need it passed in. See docs/AUDIT.md.
// ===========================================================================
(() => {
  'use strict';

  // Every AI failure shown to a technician goes through here. The real
  // translation lives in ai.js (window.AI.humanError) so there is only one
  // copy; this falls back to a plain message when ai.js isn't loaded at all,
  // so a raw server string can't leak through that gap either.
  function aiErrorText(err) {
    if (window.AI && typeof window.AI.humanError === 'function') {
      return window.AI.humanError(err);
    }
    const raw = String((err && err.message) || err || '');
    return /unknown action|draft-report|trace-building/i.test(raw)
      ? 'This AI feature is not switched on yet — the app has it, the server still needs updating.'
      : raw;
  }

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
    termite_monitoring: {
      id: 'termite_monitoring',
      title: 'Termite Monitoring Station Report',
      short: 'Monitoring',
      standard: 'AS 3660.2-2017',
      blurb: 'A periodic visit to the stations — what was in each one, what was replenished, '
        + 'and what keeps the warranty alive.',
      jobTypes: ['termite'],
      schema: () => window.TERMITE_MONITORING_SCHEMA,
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
    // A Safe Work Method Statement is deliberately NOT in here, and the
    // reason is worth writing down so nobody adds it later without meaning
    // to. Everything in this map is an ALTERNATIVE: one visit produces one
    // document, which is why the reports store is keyed by jobId and why a
    // job holds exactly one report. An inspection, an action plan, a
    // certificate and a monitoring visit really are alternatives to each
    // other. A SWMS is not — it accompanies the work rather than recording
    // it, and a builder wants it before anyone turns up, not after.
    //
    // Registering it here would mean switching document type on a job
    // silently replaced a finished inspection report with a safety document.
    // The schema is built and tested (swms-schema.js); what it still needs is
    // a store of its own, which is a separate piece of work.
  };

  // Takes the whole job, not just its type, so the choice made at New Job
  // carries through. A job booked as a monitoring visit should open a
  // monitoring report without anyone having to pick it a second time on the
  // job screen — that picker is for changing your mind, not for stating the
  // obvious twice.
  function defaultDocumentType(job) {
    const jobType = job && typeof job === 'object' ? job.jobType : job;
    const preferred = job && typeof job === 'object' ? job.preferredDocumentType : null;
    if (preferred && DOCUMENT_TYPES[preferred]
      && DOCUMENT_TYPES[preferred].jobTypes.includes(jobType === 'pest_treatment' ? 'pest_treatment' : 'termite')) {
      return preferred;
    }
    return jobType === 'pest_treatment' ? 'general_pest' : 'timber_pest_inspection';
  }

  function documentTypesFor(jobType) {
    const wanted = jobType === 'pest_treatment' ? 'pest_treatment' : 'termite';
    return Object.values(DOCUMENT_TYPES).filter((d) => d.jobTypes.includes(wanted));
  }

  // The document type lives on the report, not the job: one property can need
  // an inspection this year and a service record next, and the job record
  // should not have to be recreated to say so.
  // Document type ids that were renamed. A report stamped with the old id was
  // answered against the same questions and must keep opening — silently
  // falling back to the default would hand somebody a Timber Pest Inspection
  // where they had written a monitoring visit.
  const LEGACY_DOCUMENT_TYPE_IDS = {
    termite_service_record: 'termite_monitoring',
  };

  function documentTypeOf(report, job) {
    const stamped = report && report.documentType;
    const resolved = LEGACY_DOCUMENT_TYPE_IDS[stamped] || stamped;
    if (resolved && DOCUMENT_TYPES[resolved]) return DOCUMENT_TYPES[resolved];
    return DOCUMENT_TYPES[defaultDocumentType(job)];
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

  // Both moved to report-schema.js, where they sit beside isFieldVisible and
  // have no idea what a report is. A Safe Work Method Statement gates its
  // subfloor page on an answer given back in "What This Job Involves" —
  // exactly the same mechanism as an inspection gating its action plan on an
  // answer given back in Findings — and it needs these, not a copy of them.
  const isSectionVisible = window.ReportSchemaUtils.isSectionVisible;
  const visibleSchema = window.ReportSchemaUtils.visibleSchema;

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
  const emailStatusRow = document.getElementById('email-status-row');
  const emailStatusText = document.getElementById('email-status-text');
  const emailStatusCheckBtn = document.getElementById('email-status-check-btn');
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
  const exportDataBtn = document.getElementById('export-data-btn');
  const aiAccuracyEl = document.getElementById('ai-accuracy');

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
  // What the AI actually proposed for each of those fields, kept separately
  // because aiAppliedFieldIds is cleared the moment a field is touched. This
  // survives to save time, which is the only point where it can be known
  // whether a suggestion was kept or corrected — see recordAiReview().
  let aiSuggestedValues = {};
  // Suggestions for confirmBeforeUse fields: offered on screen, deliberately
  // NOT written into pendingSectionValues until the technician accepts one.
  // See applyDraftFieldsToPending for why these fields are treated differently
  // from the rest.
  let aiPendingSuggestions = {};
  // Offers the technician dismissed with "Answer it myself". Kept rather than
  // forgotten so recordAiReview can count them as a rejected suggestion.
  let aiDeclinedFieldIds = new Set();
  let aiDraftInProgress = false;
  let aiDraftProgressText = '';
  const objectUrls = [];

  function trackUrl(url) { objectUrls.push(url); return url; }
  function revokeAllUrls() { while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop()); }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  // Shared helpers (common.js). The in-app confirm and prompt matter most
  // here: native ones never render in an installed iOS home-screen app,
  // which once silently took out Finalize Report, sending a report, and the
  // mandatory reason for amending a finalized one.
  const { toast, askConfirm, askPrompt, escapeHtml } = window.Common;

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

  // ---------- Is the AI any good? ----------
  // Tuning a prompt without measurement is guesswork, and the only honest
  // measure available here is what the technician did with each suggestion:
  // a value kept through to save was right enough to sign their name under,
  // a value corrected was not. That signal costs the technician nothing —
  // no thumbs up, no extra tap, no judgement call while standing in a
  // subfloor. It is recorded per field so a prompt that is reliable about
  // termite species but hopeless about moisture is visible as exactly that,
  // rather than averaging into one meaningless number.
  //
  // Stored on the report rather than in a new store: it needs no schema
  // change, syncs with the report it describes, and travels in the data
  // export for free. It is NOT part of the audit trail — that record is
  // about what the document says and who changed it, and must not be
  // diluted with telemetry about a tool.
  function recordAiReview() {
    // An offer that was shown and NOT taken is the most useful accuracy signal
    // there is — a technician looking at the photograph and declining the
    // model's answer is a human-graded wrong answer, which is exactly what the
    // trial in ai-trial/ could only approximate. Counting accepted suggestions
    // alone would have recorded the confirmBeforeUse fields as silence, so the
    // fields most likely to be wrong would have been the ones contributing no
    // data at all.
    //
    // Anything still sitting in aiPendingSuggestions at save time was offered
    // and ignored; aiDeclinedFieldIds holds the ones dismissed outright. Both
    // count as not kept.
    const suggestedIds = Object.keys(aiSuggestedValues);
    const rejectedIds = Array.from(new Set([
      ...Object.keys(aiPendingSuggestions),
      ...aiDeclinedFieldIds,
    ]));
    if (!suggestedIds.length && !rejectedIds.length) return;

    const review = currentReport.aiReview || { kept: 0, corrected: 0, fields: {} };
    review.fields = review.fields || {};
    // Which model and prompt these suggestions came from: the latest pass that
    // covered this section. Accuracy is about a model and a prompt, so a
    // change to either is counted as a new thing being measured (v123).
    const runs = ((currentReport.aiDraft && currentReport.aiDraft.runs) || [])
      .filter((r) => !r.sections || !r.sections.length || r.sections.includes(currentSectionId));
    const lastRun = runs[runs.length - 1];
    const versionKey = lastRun ? `${lastRun.model} · ${lastRun.promptVersion}` : 'before v123 (not recorded)';
    review.versions = review.versions || {};
    const perVersion = review.versions[versionKey] || { kept: 0, corrected: 0 };
    const countVersion = (kept) => { if (kept) perVersion.kept += 1; else perVersion.corrected += 1; };
    for (const fieldId of suggestedIds) {
      const finalValue = pendingSectionValues[fieldId];
      const wasKept = valuesEqual(finalValue, aiSuggestedValues[fieldId]);
      const key = `${currentSectionId}.${fieldId}`;
      const perField = review.fields[key] || { kept: 0, corrected: 0 };
      if (wasKept) { review.kept += 1; perField.kept += 1; }
      else { review.corrected += 1; perField.corrected += 1; }
      countVersion(wasKept);
      review.fields[key] = perField;
    }
    for (const fieldId of rejectedIds) {
      if (Object.prototype.hasOwnProperty.call(aiSuggestedValues, fieldId)) continue; // already counted
      const key = `${currentSectionId}.${fieldId}`;
      const perField = review.fields[key] || { kept: 0, corrected: 0 };
      review.corrected += 1;
      perField.corrected += 1;
      review.fields[key] = perField;
      countVersion(false);
    }
    review.versions[versionKey] = perVersion;
    review.updatedAt = Date.now();
    currentReport.aiReview = review;
    // Cleared so re-saving the same section cannot count one suggestion
    // twice — a technician who saves, reopens and saves again has still
    // only been offered that suggestion once.
    aiSuggestedValues = {};
    aiPendingSuggestions = {};
    aiDeclinedFieldIds = new Set();
  }

  // Totals across every report on the device, for the readout in Saved
  // Reports. Reports written before this existed simply have no aiReview
  // and contribute nothing, which is correct — they are not evidence of
  // the AI being right or wrong either way.
  function aiAccuracySummary(reports) {
    let kept = 0;
    let corrected = 0;
    let reportsWithAi = 0;
    const fields = {};
    const versions = {};
    for (const report of reports || []) {
      const review = report && report.aiReview;
      if (!review || (!review.kept && !review.corrected)) continue;
      reportsWithAi += 1;
      kept += review.kept || 0;
      corrected += review.corrected || 0;
      for (const [key, counts] of Object.entries(review.fields || {})) {
        const acc = fields[key] || { kept: 0, corrected: 0 };
        acc.kept += counts.kept || 0;
        acc.corrected += counts.corrected || 0;
        fields[key] = acc;
      }
      for (const [key, counts] of Object.entries(review.versions || {})) {
        const acc = versions[key] || { kept: 0, corrected: 0 };
        acc.kept += counts.kept || 0;
        acc.corrected += counts.corrected || 0;
        versions[key] = acc;
      }
    }
    // By section (v123): "the AI is 80% right" hides that it is reliable about
    // the property and unreliable about damage. A section is only judged once
    // there are enough answers to judge it on.
    const bySection = {};
    for (const [key, counts] of Object.entries(fields)) {
      const sectionId = key.split('.')[0];
      const acc = bySection[sectionId] || { kept: 0, corrected: 0 };
      acc.kept += counts.kept;
      acc.corrected += counts.corrected;
      bySection[sectionId] = acc;
    }
    for (const acc of Object.values(bySection)) {
      acc.total = acc.kept + acc.corrected;
      acc.keptPercent = acc.total ? Math.round((acc.kept / acc.total) * 100) : null;
      acc.enough = acc.total >= AI_MIN_ANSWERS;
      acc.weak = acc.enough && acc.keptPercent < AI_WEAK_PERCENT;
    }
    const total = kept + corrected;
    return {
      kept,
      corrected,
      total,
      reportsWithAi,
      keptPercent: total ? Math.round((kept / total) * 100) : null,
      fields,
      bySection,
      versions,
    };
  }

  // Below this many answers a section's figure says "not enough yet" rather
  // than a percentage that one bad photo can swing by 20 points.
  const AI_MIN_ANSWERS = 5;
  // A section where fewer than this share of suggestions survive is flagged:
  // its suggestions should be checked closely, every time.
  const AI_WEAK_PERCENT = 70;

  function sectionTitleFor(sectionId) {
    const schemas = [window.REPORT_SCHEMA, window.PEST_TREATMENT_SCHEMA, window.TERMITE_ACTION_PLAN_SCHEMA,
      window.TERMITE_CERTIFICATE_SCHEMA, window.TERMITE_MONITORING_SCHEMA];
    for (const schema of schemas) {
      const s = (schema || []).find((x) => x.id === sectionId);
      if (s) return s.title;
    }
    return sectionId;
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

  // ---------- Answers given on the camera screen (photo-walk.js) ----------
  // The technician's own answers, not suggestions, so they are written
  // straight into the report and logged like any edit. `to: undefined` takes
  // a field back to its schema default.
  const WALK_RESTRICTED_LINES = {
    subfloor: 'Subfloor: could not be accessed at the time of inspection.',
    roof: 'Roof void: could not be accessed at the time of inspection.',
  };

  function walkFieldDef(sectionId, fieldId) {
    const section = (window.REPORT_SCHEMA || []).find((s) => s.id === sectionId) || { fields: [] };
    const field = (section.fields || []).find((f) => f.id === fieldId);
    return { sectionTitle: section.title || sectionId, label: field ? field.label : fieldId, options: (field && field.options) || [] };
  }

  function applyWalkChanges(report, changes) {
    let changed = false;
    for (const { sectionId, fieldId, to } of changes) {
      const section = { ...(report.sections[sectionId] || {}) };
      const from = section[fieldId];
      if (JSON.stringify(from === undefined ? null : from) === JSON.stringify(to === undefined ? null : to)) continue;
      const def = walkFieldDef(sectionId, fieldId);
      appendAudit(report, {
        event: 'field-changed',
        sectionId,
        sectionTitle: def.sectionTitle,
        fieldId,
        label: def.label,
        from: summariseValue(from),
        to: summariseValue(to),
        via: 'photo walk',
      });
      if (to === undefined) delete section[fieldId]; else section[fieldId] = to;
      report.sections[sectionId] = section;
      changed = true;
    }
    return changed;
  }

  // ---------- Report load / prefill ----------
  async function loadOrCreateReport(jobId, wantedDocumentType) {
    let report = await DB.getReport(jobId);
    if (report) return report;

    const job = await DB.getJob(jobId);
    const documentType = (wantedDocumentType && DOCUMENT_TYPES[wantedDocumentType])
      ? wantedDocumentType
      : defaultDocumentType(job);
    const sections = {};
    for (const section of schemaFor(job && job.jobType, { documentType })) {
      sections[section.id] = defaultValuesForSection(section, window.Org);
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
    await carryForwardStations(job, report);
    appendAudit(report, { event: 'created' });
    return report;
  }

  // Brings the station register forward from the previous visit.
  //
  // A property on a standing programme has the same stations in the same
  // places for years. Re-entering eight to twenty of them every visit is how
  // a station register turns into "all OK" by station six — which is the
  // failure the chip-based renderer was built to avoid in the first place,
  // arriving from a different direction.
  //
  // Only the stations come across: the number and where it is. Findings are
  // deliberately cleared, because carrying last visit's result forward would
  // mean a technician who skipped a station still produces a report saying
  // what was in it.
  async function carryForwardStations(job, report) {
    if (!job || !job.recurringFromId) return;
    try {
      const previous = await DB.getReport(job.recurringFromId);
      if (!previous || !previous.sections) return;
      for (const [sectionId, values] of Object.entries(previous.sections)) {
        const stations = values && values.stationRecords;
        if (!Array.isArray(stations) || !stations.length) continue;
        report.sections[sectionId] = {
          ...(report.sections[sectionId] || {}),
          stationRecords: stations.map((s) => ({
            // `id` identifies this VISIT's row and is new every time.
            id: DB.uid(),
            // `assetId` identifies the STATION — the physical thing in the
            // ground — and is the same every visit for the life of it. Until
            // this existed a station had no identity beyond its printed
            // number, so "what has station 7 done over three years" could
            // only be answered by reading three years of reports and trusting
            // that nobody renumbered anything. It is also what a QR sticker
            // on the station cap encodes.
            //
            // Minted here for stations installed before this existed, so an
            // established property gains a register the first time it is
            // serviced rather than needing anything re-entered.
            assetId: s.assetId || DB.uid(),
            stationNumber: s.stationNumber || '',
            // Where it is only changes when somebody moves it, so unlike a
            // finding it comes forward.
            location: s.location || '',
            status: '',
            action: '',
            note: '',
          })),
        };
        // The register lives behind a gate, and carrying the stations without
        // the gate would file them somewhere nobody can see. A property that
        // had stations last visit has them this visit — that is what a
        // standing programme is — so the answer comes across with them.
        if (sectionId === 'rodentStations') {
          report.sections.pestIdentification = {
            ...(report.sections.pestIdentification || {}),
            rodentStationsInUse: 'Yes — serviced this visit',
          };
        }
      }
    } catch (e) {
      // A register that fails to copy is an inconvenience, not a reason to
      // refuse to open the report — the technician adds the stations by hand.
      console.warn('[report] could not carry stations forward:', e.message || e);
    }
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
      // No job, no report. A report built without an id could be opened and typed
      // into, and then fail at Save with an error about a key path.
      if (!jobId) { toast('That job is no longer here.'); return; }
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
      renderPhotoFilingBanner();
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
    // Puts a signature the client gave through their own link onto the
    // document itself.
    //
    // THIS IS THE ONLY THING THAT WRITES A REMOTE ACCEPTANCE INTO A REPORT,
    // and it runs here — in the app, as a signed-in user, who gets named in
    // the audit trail — rather than in the public endpoint that collected it.
    // Migration 030 explains at length why the endpoint with no login is not
    // allowed to touch a finalised compliance document. The short version: a
    // finalised report says what it said when it was signed, and the weakest
    // credential in the system must not be the thing that can change that.
    //
    // Refuses rather than overwrites. A signature already in the
    // acknowledgement section was taken in person, and the person standing in
    // the room wins over a link.
    async applyClientAcceptance(jobId, acceptance) {
      if (!acceptance || !acceptance.signature) return { ok: false, reason: 'nothing' };
      const report = await DB.getReport(jobId);
      if (!report) return { ok: false, reason: 'no-report' };

      const section = { ...(report.sections.acknowledgement || {}) };
      if (String(section.clientSignature || '').trim()) {
        return { ok: false, reason: 'already-signed' };
      }

      section.clientAckName = acceptance.name || '';
      section.clientSignature = acceptance.signature;
      // The date the CLIENT accepted, not today. The document should say when
      // they agreed, not when somebody got around to filing it.
      //
      // Built from LOCAL date parts, not toISOString(). Sydney runs 10 or 11
      // hours ahead of UTC, so anything accepted before mid-morning converts
      // to the previous day — and this is the one date on the document that
      // somebody might later argue about. The test for this failed on the
      // first run with exactly that one-day slip.
      const at = new Date(acceptance.at || Date.now());
      const { pad2: pad } = window.Common;
      section.clientAckDate = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
      report.sections.acknowledgement = section;

      appendAudit(report, {
        event: 'client-acceptance-applied',
        sectionId: 'acknowledgement',
        fieldId: 'clientSignature',
        from: '(blank)',
        to: `accepted by ${acceptance.name || 'client'}`,
        reason: 'Accepted by the client through their own link, then applied here.',
      });
      await DB.saveReport(report);
      if (currentJobId === jobId) { currentReport = report; renderSectionList(); renderAuditTrail(); }
      return { ok: true };
    },
    // The inspection agreement the client signed through their own link before
    // the visit (client-agreement.js, migration 034), into section 3, About Our
    // Agreement. Usually called by itself after a sync. The report may not
    // exist yet (the visit has not happened), so it is made here.
    //
    // Never over a signature already there: one taken on the day stays, and a
    // second call for the same agreement finds it signed and does nothing. Not
    // on a finalized report either: an agreement made in advance has no
    // business arriving after the report was issued.
    async applyClientAgreement(jobId, agreement) {
      if (!agreement || !agreement.signature) return { ok: false, reason: 'nothing' };
      const job = await DB.getJob(jobId);
      if (!job) return { ok: false, reason: 'no-job' };
      const report = await loadOrCreateReport(jobId);
      if (report.finalizedAt) return { ok: false, reason: 'finalized' };
      const section = { ...(report.sections.agreement || {}) };
      if (String(section.agreementSignature || '').trim()) return { ok: false, reason: 'already-signed' };

      // The client's date, from local parts (see applyClientAcceptance above
      // for the one-day slip toISOString() causes in Sydney).
      const at = new Date(agreement.at || Date.now());
      const { pad2: pad } = window.Common;
      const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
      const name = String(agreement.name || '').trim();
      section.agreementAcceptedBy = name;
      section.agreementAcceptedAt = date;
      section.agreementSignature = agreement.signature;
      report.sections.agreement = section;

      appendAudit(report, {
        event: 'client-agreement-applied',
        sectionId: 'agreement',
        fieldId: 'agreementSignature',
        from: '(blank)',
        to: `signed by ${name || 'client'} on ${date}`,
        reason: 'Signed by the client through their own link before the visit, then filed here.',
      });
      await DB.saveReport(report);
      if (currentJobId === jobId) { currentReport = report; renderSectionList(); renderAuditTrail(); }
      return { ok: true };
    },
    // The jobCategory picked on Client Details (pest treatment jobs only) —
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
      // Loaded once, ahead of the checklist lookup, since which of a
      // termite job's four possible documents is active decides which
      // checklist applies (see photo-checklists.js) — reused below rather
      // than loading it a second time.
      const report = await loadOrCreateReport(jobId);
      const items = window.PhotoChecklists.forJob(job, jobCategory, report.documentType).filter((item) => item.schemaField);
      if (!items.length) return;

      const captures = await DB.getCaptures(jobId);
      if (!captures.length) return;

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
      // AI drafting is a single whole-report pass ("Generate Form" — see
      // finishInspection in app.js), not one call per section here. This
      // only organizes photos into the report fields the checklist names.
    },
    // Sorts every "general" photo into whichever specific field it's
    // actually evidence for — obstructions, findings, conducive conditions,
    // whatever fits. "General" means two things, both fed in together:
    // (1) report-schema.js's generalPhotos catch-all field, for anything
    // added straight into the report editor, and (2) captures taken live
    // during Start Inspection whose zone didn't match a checklist item —
    // the "Other" shots a technician takes of whatever's in front of them
    // without knowing which field it belongs in. Called from Generate Form
    // (finishInspection in app.js) alongside attachChecklistPhotos, so
    // sorting is automatic either way. A photo AI can't confidently place
    // stays exactly where it was — that's a normal outcome, not a failure.
    async sortGeneralPhotos(jobId) {
      if (!window.AI || !window.AI.sortGeneralPhotos) return;
      const job = await DB.getJob(jobId);
      const report = await loadOrCreateReport(jobId);

      const generalPhotos = ((report.sections.clientDetails || {}).generalPhotos || [])
        .map((p) => ({ sourceId: p.id, blob: p.blob }));

      const jobCategory = job && job.jobType === 'pest_treatment' ? await this.getJobCategory(jobId) : null;
      const checklistLabels = new Set(
        (window.PhotoChecklists ? window.PhotoChecklists.forJob(job, jobCategory, report.documentType) : []).map((item) => item.label)
      );
      const captures = await DB.getCaptures(jobId);
      const unmatchedCaptures = captures
        .filter((c) => c.photoBlob && c.zone && !c.isFrontElevation && !checklistLabels.has(c.zone))
        .map((c) => ({ sourceId: c.id, blob: c.photoBlob }));

      const pool = [...generalPhotos, ...unmatchedCaptures];
      if (!pool.length) return;

      const schema = schemaFor(job && job.jobType, report);
      const EXCLUDED_FIELD_IDS = new Set(['coverPhoto', 'propertyPhotos', 'generalPhotos', 'treePhotos']);
      const targets = [];
      for (const section of schema) {
        for (const field of section.fields || []) {
          if (field.type !== 'photos' || EXCLUDED_FIELD_IDS.has(field.id)) continue;
          targets.push({ sectionId: section.id, fieldId: field.id, label: field.label });
        }
      }
      if (!targets.length) return;

      let result;
      try {
        result = await window.AI.sortGeneralPhotos(pool.map((p) => p.blob), targets);
      } catch (err) {
        console.warn('[report] could not sort general photos:', err.message || err);
        return;
      }
      const assignments = (result && result.assignments) || [];
      if (!assignments.length) return;

      // Proposed, not filed.
      //
      // The blind trial (ai-trial/FINDINGS.md) put a mixed batch through this
      // exact path. It behaved well on the whole — every ant photograph and
      // ten of twelve rot photographs were correctly left alone rather than
      // forced into the nearest-sounding field — but it filed two photographs
      // of rotted timber into termite fields, and one of those into NEST
      // PHOTOS, reasoned as "a visible honeycomb-like nest structure". There
      // is no nest. It is a rotted deck beam.
      //
      // v71 stopped the model asserting findings in the text fields for the
      // same reason. Filing was left applying straight through, which meant
      // the identical misreading still reached a client report through a
      // different door: a photograph of rot sitting under "Nest Photos", with
      // nobody having been asked.
      const proposals = [];
      for (const a of assignments) {
        const photo = pool[a.photoIndex - 1];
        if (!photo) continue;
        const target = targets.find((t) => t.sectionId === a.sectionId && t.fieldId === a.fieldId);
        if (!target) continue;
        const existing = Array.isArray((report.sections[a.sectionId] || {})[a.fieldId])
          ? report.sections[a.sectionId][a.fieldId] : [];
        if (existing.some((p) => p.sourceId === photo.sourceId)) continue;
        proposals.push({
          sourceId: photo.sourceId,
          sectionId: a.sectionId,
          fieldId: a.fieldId,
          label: target.label,
          reason: a.reasoning || a.reason || '',
        });
      }
      if (!proposals.length) return;

      report.pendingPhotoFiling = proposals;
      await DB.saveReport(report);
      if (currentJobId === jobId) { currentReport = report; renderSectionList(); renderPhotoFilingBanner(); }
      const n = proposals.length;
      toast(`AI has suggested where ${n} photo${n === 1 ? '' : 's'} belong${n === 1 ? 's' : ''} — review before ${n === 1 ? 'it goes' : 'they go'} in.`);
    },
    documentTypesFor,
    documentTypeOf,
    defaultDocumentType,
    // Exposed so the accuracy figure can be tested, and so it could be read
    // from anywhere else that ever wants it, without re-deriving the rules
    // for what counts as a kept suggestion.
    aiAccuracySummary,
    aiCostSummary,
    async openArchive() {
      await renderArchiveList();
      hideAllAppViews();
      show(viewArchive);
    },
    // Called by app.js once photo analysis comes back — either the
    // background run right after "Finish Inspection", or a manual re-run
    // from the AI Draft button. Never writes into report.sections directly;
    // suggestions only apply when a section is opened (see openSectionEditor).
    async applyAiDraft(jobId, result) {
      const report = await loadOrCreateReport(jobId);
      // Merged by section, not replaced wholesale: attachChecklistPhotos
      // calls this once per section (each analyzed against only its own
      // photos), and the whole-report pass from Finish Inspection or the
      // "Generate AI Draft" button calls it once across every section. Either
      // one running after the other must add to what's there, not erase it.
      const prev = report.aiDraft || { draftFields: {}, fieldReasons: {}, frameNotes: [] };
      const draftFields = { ...prev.draftFields };
      for (const [sectionId, fields] of Object.entries(result.draftFields || {})) {
        draftFields[sectionId] = { ...(draftFields[sectionId] || {}), ...fields };
      }
      const fieldReasons = { ...prev.fieldReasons };
      for (const [sectionId, reasons] of Object.entries(result.fieldReasons || {})) {
        fieldReasons[sectionId] = { ...(fieldReasons[sectionId] || {}), ...reasons };
      }
      report.aiDraft = {
        generatedAt: Date.now(),
        transcript: result.transcript || prev.transcript || '',
        draftFields,
        // Which photograph each suggestion came from. A suggested answer the
        // technician cannot trace back to an image is one they have to
        // re-derive from scratch, which costs more time than a blank field.
        fieldReasons,
        frameNotes: (result.frameNotes && result.frameNotes.length) ? result.frameNotes : prev.frameNotes,
        // Every pass that contributed, with the model and prompt that made it
        // (v123, the `ai` stamp from analyze-inspection). Id'd entries, so two
        // phones' passes merge rather than one replacing the other.
        runs: [...(prev.runs || []), {
          id: DB.uid(),
          at: Date.now(),
          action: (result.ai && result.ai.action) || 'draft-report',
          model: (result.ai && result.ai.model) || 'unknown',
          promptVersion: (result.ai && result.ai.promptVersion) || 'unknown',
          sections: Object.keys(result.draftFields || {}),
          suggestions: Object.values(result.draftFields || {}).reduce((n, f) => n + Object.keys(f || {}).length, 0),
          // What this pass cost (v142): tokens, and hundredths of a US cent.
          inputTokens: (result.ai && result.ai.inputTokens) || 0,
          outputTokens: (result.ai && result.ai.outputTokens) || 0,
          costUsdCentsX100: result.ai && typeof result.ai.costUsdCentsX100 === 'number' ? result.ai.costUsdCentsX100 : null,
        }],
      };
      // On the record of the document too: which AI offered suggestions for it,
      // and when. The suggestions themselves still change nothing until a
      // person accepts them, and each acceptance is its own audit entry.
      const run = report.aiDraft.runs[report.aiDraft.runs.length - 1];
      appendAudit(report, {
        event: 'ai-draft-prepared',
        to: `${run.suggestions} suggestion${run.suggestions === 1 ? '' : 's'} from ${run.model} (${run.promptVersion})`,
      });
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
    // The inside step of the photo walk (photo-walk.js): what blocked the view
    // indoors, ticked by the technician, written into Areas We Were Unable to
    // Inspect. Their own answer, not a suggestion, so it is set directly and
    // logged like any edit. An empty list means nothing blocked the view
    // inside, which takes "The Interior" back out of the hindered areas.
    // Refuses (false) on a finalized report rather than amend it from the
    // camera screen.
    async recordInteriorObstructions(jobId, list) {
      const report = await loadOrCreateReport(jobId);
      if (report.finalizedAt) return false;
      const access = report.sections.access || {};
      const items = Array.from(new Set((list || []).map((s) => String(s).trim()).filter(Boolean)));
      const areas = new Set(Array.isArray(access.hinderedAreas) ? access.hinderedAreas : []);
      if (items.length) areas.add('The Interior'); else areas.delete('The Interior');
      const order = walkFieldDef('access', 'hinderedAreas').options || [];
      const rank = (v) => (order.indexOf(v) === -1 ? order.length : order.indexOf(v));
      const changes = [
        { sectionId: 'access', fieldId: 'hinderedAreas', to: Array.from(areas).sort((a, b) => rank(a) - rank(b)) },
        { sectionId: 'access', fieldId: 'interiorObstructions', to: items },
      ];
      if (items.length) changes.push({ sectionId: 'access', fieldId: 'hinderedObstructions', to: 'Yes' });
      if (applyWalkChanges(report, changes)) {
        await DB.saveReport(report);
        if (currentJobId === jobId) currentReport = report;
      }
      return true;
    },
    // The subfloor and roof void questions of the photo walk. Each has three
    // answers, because "no" meant two different things a report must keep
    // apart: there is none (a slab, a flat roof), or there is one and it could
    // not be entered, which is a limitation the client has to be told about.
    //
    //   subfloor yes      floor type Timber Floor (if it was blank or slab)
    //   subfloor blocked  the same, plus a restricted-access line
    //   subfloor no       floor type Concrete Slab, subfloor drainage N/A
    //   roof blocked      a restricted-access line
    //   roof yes / no     no restricted-access line
    //
    // The restricted-access lines are fixed sentences, so changing the answer
    // takes back exactly the line this wrote and nothing a technician typed.
    // Same rules as the inside notes: logged, refused on a finalized report.
    async recordAccessAnswer(jobId, area, answer) {
      if (!['subfloor', 'roof'].includes(area) || !['yes', 'blocked', 'no'].includes(answer)) return false;
      const report = await loadOrCreateReport(jobId);
      if (report.finalizedAt) return false;
      const property = report.sections.property || {};
      const conducive = report.sections.conducive || {};
      const access = report.sections.access || {};
      const changes = [];
      if (area === 'subfloor') {
        if (answer === 'no') {
          changes.push({ sectionId: 'property', fieldId: 'floorType', to: 'Concrete Slab' });
          changes.push({ sectionId: 'conducive', fieldId: 'subfloorDrainage', to: 'Not applicable' });
        } else {
          if (!property.floorType || property.floorType === 'Concrete Slab') {
            changes.push({ sectionId: 'property', fieldId: 'floorType', to: 'Timber Floor' });
          }
          // Back to the schema default rather than a guess.
          if (conducive.subfloorDrainage === 'Not applicable') {
            changes.push({ sectionId: 'conducive', fieldId: 'subfloorDrainage', to: undefined });
          }
        }
      }
      const line = WALK_RESTRICTED_LINES[area];
      const lines = String(access.restrictedAccessDetails || '').split('\n').filter((l) => l.trim() && l.trim() !== line);
      if (answer === 'blocked') lines.push(line);
      const details = lines.join('\n');
      if (details !== String(access.restrictedAccessDetails || '')) {
        changes.push({ sectionId: 'access', fieldId: 'restrictedAccessDetails', to: details || undefined });
      }
      if (answer === 'blocked') {
        changes.push({ sectionId: 'access', fieldId: 'restrictedAccess', to: 'Yes' });
      } else if (!details && access.restrictedAccess === 'Yes'
        && String(access.restrictedAccessDetails || '').split('\n').some((l) => l.trim() === line)) {
        // The only restriction recorded was the one this walk wrote.
        changes.push({ sectionId: 'access', fieldId: 'restrictedAccess', to: undefined });
      }
      if (applyWalkChanges(report, changes)) {
        await DB.saveReport(report);
        if (currentJobId === jobId) currentReport = report;
      }
      return true;
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

  // Puts the finalised report PDF in the same private bucket the photographs
  // go to, at a path the client-portal function knows how to sign.
  //
  // One file per job, overwritten. An amended report replaces the copy the
  // portal serves, which is the right answer: a client following their link
  // should see the document as it stands, not the version that happened to
  // be current the day the link was made.
  async function uploadReportPdf(jobId) {
    if (!jobId || !window.Media || !window.supabaseClient) return null;
    const job = await DB.getJob(jobId);
    const report = await DB.getReport(jobId);
    if (!job || !report || !report.finalizedAt) return null;
    const blob = await generateReportPdfBlob(job, report);
    if (!blob) return null;
    return window.Media.uploadBlob(`${jobId}/report/report.pdf`, blob);
  }

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
    if (aiDraftInProgress) { aiDraftBtn.textContent = aiDraftProgressText || '🤖 Reading your photos…'; return; }
    aiDraftBtn.textContent = currentReport && currentReport.aiDraft
      ? '🤖 Read my photos again'
      : '🤖 Read my photos and fill the report';
  }

  // Every photograph attached to a section, gathered for the one analysis
  // run the technician asks for.
  //
  // This used to happen on its own: adding a photo to a Findings or
  // Conducive Conditions field fired an AI call immediately. That was wrong
  // on a real job. It spends data on a phone with one bar, it analyses a
  // section that is half photographed and draws conclusions from an
  // incomplete picture, and it does all of it while somebody is still
  // kneeling in a subfloor taking the next shot. Photographs are now taken
  // first and read once, when the button is pressed.
  function sectionPhotoFieldsWithPhotos() {
    const out = [];
    if (!currentReport || !currentReport.sections) return out;
    for (const section of currentSchema()) {
      const values = currentReport.sections[section.id];
      if (!values) continue;
      for (const field of section.fields) {
        if (field.type !== 'photos' || !field.triggersAiFill) continue;
        const photos = values[field.id];
        if (Array.isArray(photos) && photos.some((p) => p && p.blob)) {
          out.push({ sectionId: section.id, fieldId: field.id, photos: photos.filter((p) => p && p.blob) });
        }
      }
    }
    return out;
  }

  aiDraftBtn.addEventListener('click', async () => {
    if (!window.AI || aiDraftInProgress) return;
    // Reads the job's photographs. It used to look for a recorded video and
    // refuse if there wasn't one, which stopped making sense the moment the
    // app became camera-and-photos only — and photographs were always the
    // better input anyway: considered, framed shots with a zone attached,
    // rather than motion-blurred stills pulled out of a walkthrough.
    const captures = (await DB.getCaptures(currentJobId)).filter((c) => c.photoBlob);
    const sectionPhotos = sectionPhotoFieldsWithPhotos();

    if (!captures.length && !sectionPhotos.length) {
      toast('No photos on this job yet — take some first, then press this.');
      return;
    }

    // Said plainly before anything is sent, because this is the moment
    // photographs of the inside of somebody's house leave the phone, and it
    // should be a decision rather than a side effect of taking them.
    const total = captures.length + sectionPhotos.reduce((n, f) => n + f.photos.length, 0);
    const ok = await askConfirm(
      `${total} photo${total === 1 ? '' : 's'} will be sent to the AI to draft this report. `
      + 'It suggests answers for you to accept or reject — it never fills the report on its own.',
      { title: 'Read these photos?', okLabel: 'Go ahead' }
    );
    if (!ok) return;

    aiDraftInProgress = true;
    let done = 0;
    const steps = (captures.length ? 1 : 0) + sectionPhotos.length;
    const step = (what) => {
      done++;
      aiDraftProgressText = `🤖 ${what} (${done} of ${steps})…`;
      updateAiDraftButton();
    };

    aiDraftProgressText = '🤖 Reading your photos…';
    updateAiDraftButton();
    let failures = 0;
    try {
      if (captures.length) {
        step('Reading the inspection photos');
        const result = await window.AI.analyzeInspectionPhotos(captures, currentJob && currentJob.jobType);
        await ReportUI.applyAiDraft(currentJobId, result);
      }

      // Each section's own photographs, one call per section. One failing
      // must not lose the ones that worked — a technician who waited for
      // this should not be told to start again because one section timed out.
      for (const fieldPhotos of sectionPhotos) {
        step('Reading section photos');
        try {
          const result = await window.AI.analyzeSectionPhotos(
            fieldPhotos.photos.map((p) => p.blob),
            fieldPhotos.sectionId,
            currentJob && currentJob.jobType
          );
          await applySectionPhotoAiResults(
            fieldPhotos.sectionId,
            (result.draftFields && result.draftFields[fieldPhotos.sectionId]) || {}
          );
        } catch (err) {
          failures++;
          console.warn('[ai draft] section photos failed:', fieldPhotos.sectionId, err.message || err);
        }
      }

      toast(failures
        ? `Draft ready, but ${failures} section${failures === 1 ? '' : 's'} could not be read — press again to retry those.`
        : 'Draft ready — suggested answers appear when you open each section, for you to accept or reject.');
    } catch (err) {
      console.error('[ai draft]', err);
      toast('Could not read the photos: ' + aiErrorText(err));
    } finally {
      aiDraftInProgress = false;
      aiDraftProgressText = '';
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

  // What the AI has cost (v142), from the stamp on each drafting pass. Passes
  // from before v142 carry no cost and are left out rather than guessed at.
  function aiCostSummary(reports) {
    let cents100 = 0;
    let passes = 0;
    let reportsCosted = 0;
    for (const report of reports || []) {
      const runs = ((report && report.aiDraft && report.aiDraft.runs) || []).filter((r) => typeof r.costUsdCentsX100 === 'number');
      if (!runs.length) continue;
      reportsCosted += 1;
      passes += runs.length;
      for (const r of runs) cents100 += r.costUsdCentsX100;
    }
    const usd = (c100) => `US$${(c100 / 10000).toFixed(2)}`;
    return {
      passes,
      reports: reportsCosted,
      totalUsd: usd(cents100),
      perReportUsd: reportsCosted ? usd(cents100 / reportsCosted) : null,
      totalCentsX100: cents100,
    };
  }

  // Stays hidden until the AI has actually been used, so a business that
  // never turns it on is not shown an empty statistic about it — and so the
  // number, when it appears, is always about real work.
  function renderAiAccuracy(reports) {
    if (!aiAccuracyEl) return;
    const summary = aiAccuracySummary(reports);
    const cost = aiCostSummary(reports);
    const costLine = cost.reports
      ? `<span class="ai-cost">AI cost: about ${escapeHtml(cost.perReportUsd)} a report (${escapeHtml(cost.totalUsd)} over ${cost.reports} report${cost.reports === 1 ? '' : 's'}), report drafting only.</span>`
      : '';
    if (!summary.total) {
      if (costLine) { aiAccuracyEl.innerHTML = costLine; aiAccuracyEl.classList.remove('hidden'); } else aiAccuracyEl.classList.add('hidden');
      return;
    }
    const reportWord = summary.reportsWithAi === 1 ? 'report' : 'reports';
    const head = `AI suggestions: ${summary.kept} of ${summary.total} kept as written (${summary.keptPercent}%) `
      + `across ${summary.reportsWithAi} ${reportWord}. `
      + `${summary.corrected} needed correcting.`;
    // Worst first, so the section to be careful with is the one read first.
    const sections = Object.entries(summary.bySection).filter(([, s]) => s.total > 0)
      .sort(([, a], [, b]) => (a.enough === b.enough ? (a.keptPercent - b.keptPercent) : (a.enough ? -1 : 1)));
    const rows = sections.map(([id, s]) => {
      const figure = s.enough
        ? `${s.kept} of ${s.total} kept (${s.keptPercent}%)`
        : `${s.total} so far, not enough to judge yet`;
      return `<li class="${s.weak ? 'ai-weak' : ''}"><span class="ai-sec">${escapeHtml(sectionTitleFor(id))}</span>`
        + `<span class="ai-fig">${escapeHtml(figure)}${s.weak ? ' · check these closely' : ''}</span></li>`;
    }).join('');
    const versions = Object.keys(summary.versions || {}).filter((v) => !/before v123/.test(v));
    aiAccuracyEl.innerHTML = `<span class="ai-head">${escapeHtml(head)}</span>`
      + (rows ? `<ul class="ai-sections">${rows}</ul>` : '')
      + (versions.length ? `<span class="ai-versions">Measured on: ${escapeHtml(versions.join('; '))}</span>` : '')
      + costLine;
    aiAccuracyEl.classList.remove('hidden');
  }

  // ---------- Saved Reports archive ----------
  async function renderArchiveList() {
    const reports = await DB.getAllReports();
    archiveList.innerHTML = '';
    archiveEmpty.classList.toggle('hidden', reports.length > 0);
    renderAiAccuracy(reports);
    // One tap hands over every job, report and invoice in the business, so
    // it is admin-only (migration 016). Demo and test mode have no session
    // and nothing real to hand over, so they keep it.
    if (exportDataBtn) {
      const isAdmin = window.IS_DEMO
        || !window.Sync || typeof window.Sync.isAdmin !== 'function'
        || window.Sync.isAdmin();
      exportDataBtn.classList.toggle('hidden', !isAdmin);
      const blurb = exportDataBtn.nextElementSibling;
      if (blurb) blurb.classList.toggle('hidden', !isAdmin);
    }

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

  // A file the business holds itself, so a Supabase-side incident is not the
  // only copy of a client's jobs, reports and invoices. Browser download
  // rather than anything server-side — this has to work even if the cloud
  // that would otherwise host a backup is exactly what's unavailable.
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', async () => {
      const originalLabel = exportDataBtn.textContent;
      exportDataBtn.disabled = true;
      exportDataBtn.textContent = 'Preparing export…';
      try {
        // The export, its delivery (the share sheet on an iPhone, a download
        // elsewhere) and the "last backup" record all live in backup.js.
        const result = await window.Backup.exportNow();
        if (result.cancelled) {
          // Said plainly: closing the share sheet without choosing anywhere is
          // not a backup, and a toast saying "Exported" here would be a lie.
          toast('Not saved: the share sheet was closed, so no backup was made.');
        } else {
          const c = result.data.counts;
          toast(`Backed up ${c.jobs} jobs, ${c.reports} reports, ${c.invoices} invoices, ${c.clients} clients.`);
        }
      } catch (err) {
        if (window.ErrorLog) window.ErrorLog.note(err, 'backup export');
        toast('Could not prepare the export — try again. ' + (err && err.message ? err.message : ''));
      } finally {
        exportDataBtn.disabled = false;
        exportDataBtn.textContent = originalLabel;
      }
    });
  }

  // ---------- Audit trail + schema version UI ----------
  // Every element used here can be absent on a device pairing this script with
  // a stale cached index.html, so each function bails rather than throwing.

  function fmtAuditTime(ts) {
    const d = new Date(ts);
    const { pad2: pad } = window.Common;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function auditEntryLine(entry) {
    const who = entry.userEmail ? escapeHtml(entry.userEmail) : 'unknown user';
    const when = fmtAuditTime(entry.at);
    if (entry.event === 'created') return `<strong>Report created</strong> — ${when} by ${who}`;
    if (entry.event === 'finalized') return `<strong>Report finalized</strong> — ${when} by ${who}`;
    if (entry.event === 'ai-draft-prepared') {
      return `<strong>AI suggestions prepared</strong><br>`
        + `<span class="audit-change">${escapeHtml(entry.to || '')}</span><br>`
        + `<span class="audit-meta">${when} by ${who}. Nothing changes until a person accepts it.</span>`;
    }
    if (entry.event === 'client-agreement-applied' || entry.event === 'client-acceptance-applied') {
      const what = entry.event === 'client-agreement-applied' ? 'Inspection agreement signed by the client' : 'Quote accepted by the client';
      return `<strong>${what}</strong><br>`
        + `<span class="audit-change">${escapeHtml(entry.to || '')}</span><br>`
        + `<span class="audit-meta">filed ${when} by ${who}</span>`;
    }
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

  // "Did they actually receive it?" — the row stays hidden until the report
  // has actually been emailed once (emailProviderId set in emailReport
  // above); status is only ever refreshed when the technician taps Check
  // status, not automatically, matching check-email-status's pull-not-push
  // design (see that function's own header for why).
  const EMAIL_STATUS_LABELS = {
    sent: 'Sent',
    delivered: 'Delivered ✓',
    opened: 'Opened by client',
    clicked: 'Opened by client',
    bounced: '⚠ Bounced — check the address',
    complained: '⚠ Marked as spam',
    delivery_delayed: 'Delayed — retrying',
    unknown: 'Status unavailable',
  };

  function renderEmailStatus() {
    if (!emailStatusRow || !currentReport) return;
    if (!currentReport.emailProviderId) { emailStatusRow.classList.add('hidden'); return; }
    emailStatusRow.classList.remove('hidden');
    const when = currentReport.emailedAt ? fmtAuditTime(currentReport.emailedAt) : '';
    const label = EMAIL_STATUS_LABELS[currentReport.emailStatus] || (currentReport.emailStatus || 'Sent');
    emailStatusText.textContent = `📧 ${label}${when ? ' · ' + when : ''}`;
  }

  if (emailStatusCheckBtn) {
    emailStatusCheckBtn.addEventListener('click', async () => {
      if (!currentReport || !currentReport.emailProviderId) return;
      if (!window.EmailService || !window.EmailService.checkEmailStatus) {
        toast('Sign in and go online to check delivery status.');
        return;
      }
      emailStatusCheckBtn.disabled = true;
      emailStatusCheckBtn.textContent = 'Checking…';
      try {
        const result = await window.EmailService.checkEmailStatus(currentReport.emailProviderId);
        currentReport.emailStatus = result.status || currentReport.emailStatus;
        await DB.saveReport(currentReport);
        renderEmailStatus();
      } catch (err) {
        if (window.ErrorLog) window.ErrorLog.note(err, 'report: email status check');
        toast('Could not check status: ' + aiErrorText(err));
      } finally {
        emailStatusCheckBtn.disabled = false;
        emailStatusCheckBtn.textContent = 'Check status';
      }
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

  // Picking a Job Category on Client Details prefills PPE (safety section)
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

  // Business details that print on this document but are not filled in.
  //
  // These are `static` fields fed from the business record, so they are never
  // "required" in the schema sense and no validation error fires — the field
  // simply renders empty and the report goes out with a blank where the ABN
  // should be. The only person who notices is whoever receives it.
  //
  // Read off the document's OWN schema rather than a fixed list, so it flags
  // what actually appears on the thing being sent: the SWMS carries an ABN,
  // the inspection report carries an address, and neither should be warned
  // about a field it does not print.
  function missingBusinessDetails() {
    if (!window.Org || typeof window.Org.provider !== 'function') return [];
    const provider = window.Org.provider();
    const seen = new Set();
    const out = [];
    for (const section of visibleSchema(currentSchema(), currentReport)) {
      for (const field of section.fields) {
        if (!field.orgField || seen.has(field.orgField)) continue;
        seen.add(field.orgField);
        const value = String(provider[field.orgField] || '').trim();
        if (value) continue;
        out.push({
          sectionId: section.id,
          sectionTitle: 'Business details',
          fieldId: field.orgField,
          message: `${field.label} is blank, and it prints on this report`,
          why: 'Filled in once under Business, then it appears on every document.',
          // Sending somebody to the Findings section to fix their own ABN
          // would be useless — this one opens the business record instead.
          opensBusinessDetails: true,
          compliance: true,
        });
      }
    }
    return out;
  }

  function preflightItems() {
    const schema = currentSchema();
    const utils = window.ReportSchemaUtils;
    if (!utils || !utils.reportValidationErrors) return [];
    const errors = utils.reportValidationErrors(visibleSchema(schema, currentReport), currentReport.sections || {});
    return errors
      .map((error) => ({
        ...error,
        compliance: COMPLIANCE_FIELDS.has(error.fieldId),
        why: WHY_IT_MATTERS[error.fieldId] || '',
      }))
      .concat(missingBusinessDetails())
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
      <li class="preflight-item${item.compliance ? ' preflight-compliance' : ''}" data-section="${escapeHtml(item.sectionId)}" data-index="${i}"${item.opensBusinessDetails ? ' data-opens-business="1"' : ''}>
        <span class="preflight-where">${escapeHtml(item.sectionTitle)}</span>
        <span class="preflight-what">${escapeHtml(item.message)}</span>
        ${item.why ? `<span class="preflight-why">${escapeHtml(item.why)}</span>` : ''}
      </li>`).join('');

    preflightBody.innerHTML = `<p class="preflight-heading">${escapeHtml(heading)}</p><ul class="preflight-list">${rows}</ul>`;

    // Tap an item to land in the section that owns it, rather than making the
    // technician find it again.
    preflightBody.querySelectorAll('.preflight-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.getAttribute('data-opens-business') && window.openBusinessDetails) {
          window.openBusinessDetails();
          return;
        }
        const sectionId = el.getAttribute('data-section');
        if (sectionId) openSectionEditor(sectionId);
      });
    });
    return items;
  }

  // Resolves a proposal's sourceId back to its actual image. The proposal
  // stores only the id, never the blob — duplicating photo bytes into the
  // report for something that may well be declined is exactly the kind of
  // waste that fills a phone up on a long day.
  async function photoFilingPool(jobId, report) {
    const pool = new Map();
    for (const p of ((report.sections.clientDetails || {}).generalPhotos || [])) {
      if (p.id && p.blob) pool.set(p.id, p.blob);
    }
    const captures = await DB.getCaptures(jobId).catch(() => []);
    for (const c of captures) if (c.photoBlob) pool.set(c.id, c.photoBlob);
    return pool;
  }

  // A banner on the report view when the AI has proposed filings nobody has
  // looked at. Built here rather than in index.html for the reason
  // renderJobPermissions gives: a stale cached shell must not be able to hide
  // the one control that stops a wrong photograph reaching a client.
  function renderPhotoFilingBanner() {
    const existing = document.getElementById('photo-filing-banner');
    if (existing) existing.remove();
    const pending = (currentReport && currentReport.pendingPhotoFiling) || [];
    if (!pending.length) return;

    const bar = document.createElement('div');
    bar.id = 'photo-filing-banner';
    bar.className = 'photo-filing-banner';

    const text = document.createElement('span');
    const n = pending.length;
    text.className = 'photo-filing-text';
    text.textContent = `${n} photo${n === 1 ? '' : 's'} waiting to be filed — the AI has suggested where `
      + `${n === 1 ? 'it belongs' : 'they belong'}.`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Review';
    btn.addEventListener('click', () => openPhotoFilingReview());

    bar.append(text, btn);
    reportSectionList.parentNode.insertBefore(bar, reportSectionList);
  }

  // One row per proposal: the photograph, where it would go, and why. Nothing
  // is filed until somebody says so, and declining leaves the photo exactly
  // where it already is rather than moving it somewhere else.
  async function openPhotoFilingReview() {
    const pending = (currentReport && currentReport.pendingPhotoFiling) || [];
    if (!pending.length) return;
    const pool = await photoFilingPool(currentReport.jobId, currentReport);

    const rows = pending.map((p) => {
      const blob = pool.get(p.sourceId);
      return {
        proposal: p,
        thumb: blob ? trackUrl(URL.createObjectURL(blob)) : null,
      };
    });

    const accepted = await window.Dialog.photoFiling(rows);
    if (!accepted) return;   // dismissed entirely — proposals stay for next time

    const keep = new Set(accepted);
    let filed = 0;
    for (const p of pending) {
      if (!keep.has(p.sourceId)) continue;
      const blob = pool.get(p.sourceId);
      if (!blob) continue;
      const section = { ...(currentReport.sections[p.sectionId] || {}) };
      const existing = Array.isArray(section[p.fieldId]) ? section[p.fieldId] : [];
      if (existing.some((x) => x.sourceId === p.sourceId)) continue;
      section[p.fieldId] = [...existing, { id: DB.uid(), sourceId: p.sourceId, blob }];
      currentReport.sections[p.sectionId] = section;
      filed++;
    }
    // Every proposal has now been decided one way or the other, so none of
    // them should come back and ask again.
    delete currentReport.pendingPhotoFiling;
    await DB.saveReport(currentReport);
    renderSectionList();
    renderPhotoFilingBanner();
    const skipped = pending.length - filed;
    toast(filed
      ? `Filed ${filed} photo${filed === 1 ? '' : 's'}${skipped ? `, left ${skipped} where ${skipped === 1 ? 'it was' : 'they were'}` : ''}.`
      : 'Nothing filed — the photos are still where they were.');
  }

  // "5 of 11 done", a bar, and one button that goes to the next section still
  // needing attention. The list alone made a technician scan every row to find
  // where they were. Built here rather than in index.html so a stale cached page
  // paired with this script cannot leave it missing.
  function renderReportProgress(done, total, firstOpen) {
    let card = document.getElementById('report-progress');
    if (!card) {
      card = document.createElement('div');
      card.id = 'report-progress';
      card.className = 'card report-progress';
      card.innerHTML = '<div class="report-progress-top"><strong id="report-progress-text"></strong><span id="report-progress-pct"></span></div>'
        + '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span id="report-progress-fill"></span></div>'
        + '<button type="button" id="report-next-btn" class="btn btn-primary full"></button>';
      reportSectionList.parentNode.insertBefore(card, reportSectionList);
      card.querySelector('#report-next-btn').addEventListener('click', () => {
        const target = card.dataset.nextSection;
        if (target) openSectionEditor(target);
      });
    }
    const pct = total ? Math.round((done / total) * 100) : 0;
    const finalized = !!(currentReport && currentReport.finalizedAt);
    card.querySelector('#report-progress-text').textContent = finalized
      ? 'Report finalized'
      : `${done} of ${total} section${total === 1 ? '' : 's'} done`;
    card.querySelector('#report-progress-pct').textContent = `${pct}%`;
    card.querySelector('#report-progress-fill').style.width = `${pct}%`;
    card.querySelector('.progress-bar').setAttribute('aria-valuenow', String(pct));
    const next = card.querySelector('#report-next-btn');
    if (firstOpen && !finalized) {
      card.dataset.nextSection = firstOpen.section.id;
      next.textContent = `Continue: ${firstOpen.number}. ${firstOpen.section.title}`;
      next.classList.remove('hidden');
    } else {
      delete card.dataset.nextSection;
      next.classList.add('hidden');
    }
  }

  function renderSectionList() {
    renderPreflight();
    renderAuditTrail();
    renderSchemaNotice();
    renderEmailStatus();
    reportSectionList.innerHTML = '';
    let allRequiredGreen = true;

    // Numbered by position among the sections actually on screen, not by the
    // static number in the schema. With the action-plan sections hidden those
    // numbers skip, and a list reading 1-8 then 11 looks like three sections
    // went missing rather than three that were never needed.
    let doneCount = 0;
    let firstOpen = null;
    let displayNumber = 0;
    for (const section of visibleSchema(currentSchema(), currentReport)) {
      displayNumber++;
      const values = currentReport.sections[section.id] || {};
      const status = computeSectionStatus(section, values);
      if (status === 'green') doneCount++;
      else if (!section.softRequired && (!firstOpen || firstOpen.soft)) firstOpen = { section, number: displayNumber, soft: false };
      else if (!firstOpen) firstOpen = { section, number: displayNumber, soft: true }; // only if nothing required is left
      if (status !== 'green' && !section.softRequired) allRequiredGreen = false;

      const li = document.createElement('li');
      li.className = 'report-section-item';
      // A section that is only here because of an answer says so, permanently.
      // The toast at the moment it appeared explains it once; this answers the
      // same question an hour later, which is when it actually gets asked.
      const why = reasonSectionIsShown(section);
      li.innerHTML = `
        <span class="section-icon" style="background:${section.color}">${section.icon}</span>
        <span class="section-info">
          <span class="section-name">${displayNumber}. ${escapeHtml(section.title)}</span>
          ${why ? `<span class="section-why">${escapeHtml(why)}</span>` : ''}
        </span>
        <span class="section-status ${status === 'green' ? 'status-dot-green' : 'status-dot-yellow'}">
          ${status === 'green' ? '✓' : '✎'}
        </span>
      `;
      li.addEventListener('click', () => openSectionEditor(section.id));
      reportSectionList.appendChild(li);
    }

    renderReportProgress(doneCount, displayNumber, firstOpen);
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
    if (!await askConfirm(
      'You can still reopen sections to make corrections afterwards — each correction is recorded in the audit trail with a reason.',
      { title: 'Finalize this report?', okLabel: 'Finalize' })) return;
    // Recorded before finalizedAt is set, so the event itself is correctly
    // stamped afterFinalize: false — this is the moment of sign-off, not an
    // amendment to an already-signed document.
    appendAudit(currentReport, { event: 'finalized' });
    currentReport.finalizedAt = Date.now();
    await DB.saveReport(currentReport);
    const { dueAt, intervalMonths } = computeNextDueAt(currentJob, currentReport);
    // A recommended re-inspection interval IS a standing plan — the property
    // needs seeing again every N months whether or not anyone remembers to
    // rebook it. Adopting it here means the series continues by itself from
    // now on, without changing anything for a job that already has a plan.
    const planUpdate = (!currentJob.recurrenceMonths && intervalMonths)
      ? { recurrenceMonths: intervalMonths }
      : {};
    await DB.updateJob(currentJobId, {
      status: 'completed',
      nextDueAt: dueAt,
      reinspectionIntervalMonths: intervalMonths,
      ...planUpdate,
    });
    // Nothing else happens here on purpose. A finalized report already sets
    // the due date and the existing backlog and rebook flow take it from
    // there — that works, and raising a second job now would show the same
    // property twice. The plan recorded above only matters for the case that
    // flow cannot cover: a visit that completes with no report at all.
    toast('Report finalized');
    // The PDF goes to storage so the client portal has something to serve.
    // The server has never held one: it is rendered here in the browser and
    // posted to send-report-email as base64, so without this upload a portal
    // link would open on a report that exists nowhere but this phone.
    //
    // Deliberately not awaited and deliberately unable to fail loudly. A
    // technician standing in a driveway with one bar has finalized their
    // report; whether a copy reached a bucket is not their problem, and the
    // next finalize or amendment will try again.
    const finalisedJobId = currentJobId;
    uploadReportPdf(finalisedJobId)
      // Then the copy into the client's SharePoint folder, which reads that
      // PDF from storage (sharepoint.js; silent until SharePoint is set up).
      .then((path) => { if (path && window.SharePoint) window.SharePoint.copyJobQuietly(finalisedJobId); })
      .catch((err) => console.warn('[report] could not back up the report PDF:', err.message || err));
    renderSectionList();
    if (window.refreshJobViewStatus) await window.refreshJobViewStatus(currentJobId);
    offerForemanFollowUpTask(currentJobId);
  });

  // When is this property next due? Termite reports carry a recommended
  // re-inspection interval (AS 3660.2 recommends no more than 12 months, and
  // shorter on high-risk sites); pest treatments carry an explicit follow-up
  // date. Returns { dueAt, intervalMonths }, both null when the report gives
  // us nothing to go on — better to show no due date than to invent one.
  //
  // intervalMonths is kept alongside the date, not just derived from it,
  // because the re-inspection reminder needs to know WHICH cycle produced this
  // date — the 9-month email / 12-month phone-call escalation only applies
  // to a standard 12-month termite cycle, not a 3- or 6-month one flagged
  // for a higher-risk property, and not a pest-treatment follow-up at all.
  function computeNextDueAt(job, report) {
    const sections = (report && report.sections) || {};
    if (job && job.jobType === 'pest_treatment') {
      const recs = sections.recommendations || {};
      if (recs.followUpRequired !== 'Yes' || !recs.followUpDate) return { dueAt: null, intervalMonths: null };
      const due = Date.parse(recs.followUpDate + 'T09:00:00');
      return { dueAt: Number.isFinite(due) ? due : null, intervalMonths: null };
    }

    const months = { '3 months': 3, '6 months': 6, '12 months': 12 }[(sections.findings || {}).reinspectionInterval];
    if (!months) return { dueAt: null, intervalMonths: null };
    // Count forward from the inspection date rather than today, so finalizing
    // a report late doesn't quietly push the whole schedule out.
    const client = sections.clientDetails || {};
    const base = client.inspectionDate ? new Date(client.inspectionDate + 'T09:00:00') : new Date();
    if (!Number.isFinite(base.getTime())) return { dueAt: null, intervalMonths: null };
    const due = new Date(base);
    due.setMonth(due.getMonth() + months);
    return { dueAt: due.getTime(), intervalMonths: months };
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
      const recipientEmail = await askPrompt(
        'Enter their email address, or Cancel to skip.',
        defaultEmail,
        { title: 'Send the report to the client', okLabel: 'Send', inputType: 'email', placeholder: 'client@example.com' }
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
      let sendResult;
      try {
        const pdfBlob = await generateReportPdfBlob(job, currentReport);
        const clientDetails = currentReport.sections.clientDetails || {};
        sendResult = await window.EmailService.sendReportEmail({
          recipientEmail: recipientEmail.trim(),
          recipientName: clientDetails.clientName || job.name,
          jobName: job.name,
          jobType: job.jobType,
          pdfBlob,
        });
      } finally {
        clearInterval(keepAlive);
      }
      // The id Resend hands back is the only way to ever ask "did this
      // arrive" later — see check-email-status. Saved on the report itself
      // (not the job) since a job can be re-emailed as its report changes,
      // and each send should overwrite the last id, not accumulate a list
      // nothing reads yet.
      if (sendResult && sendResult.id) {
        currentReport.emailProviderId = sendResult.id;
        currentReport.emailedAt = Date.now();
        currentReport.emailStatus = 'sent';
        await DB.saveReport(currentReport);
        renderSectionList();
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
  // Cross-app hook (optional, non-blocking): Foreman and Scope now
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
      if (!await askConfirm(`Also add a Foreman task to send this report to ${who}?`,
        { title: 'Add a Foreman task?', okLabel: 'Add task' })) return;

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
  // Inspector Details defaults used to be a table in this file, keyed by
  // email address, with one technician in it. Adding a second meant editing
  // source and deploying. They live on the person's own record now — see
  // org.js and migration 022.

  // Turns a job's assignedTo email into a name worth showing on a job list or
  // a scheduler slot. Never blank: an unrecognised login shows as its email,
  // because "someone" is always more use than nothing on a shared list.
  window.technicianDisplayName = function technicianDisplayName(email) {
    if (!email) return '';
    return window.Org ? window.Org.nameFor(email) : email;
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
        // confirmBeforeUse fields are OFFERED, never filled in.
        //
        // A blind trial of 110 reference photographs (see ai-trial/FINDINGS.md)
        // found the model excellent at naming an insect — 29 of 29, and it
        // never once wrongly said live termites were found — and unreliable at
        // reading damage: on photographs of fungal and brown rot it answered
        // "yes" to evidence of termite workings roughly a quarter of the time,
        // then went on to assign a damage severity, a HIGH susceptibility and
        // a recommendation to treat, with fluent and entirely wrong reasoning
        // attached.
        //
        // A pre-filled answer that nobody touches is indistinguishable, in the
        // finished report, from one the technician decided. So for the fields
        // that assert something about the property, the suggestion is shown
        // and the value is left unset. Two things then follow for free: every
        // dependent field stays hidden behind its showIf until the question is
        // actually answered, and because these fields are all required,
        // finalizing is already blocked until a human answers them.
        if (fieldDef && fieldDef.confirmBeforeUse) {
          aiPendingSuggestions[fieldId] = suggestedValue;
          continue;
        }
        pendingSectionValues[fieldId] = suggestedValue;
        aiAppliedFieldIds.add(fieldId);
        aiSuggestedValues[fieldId] = suggestedValue;
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

  // ---------- Section autosave ----------
  // Save/discard is a deliberate model — pendingSectionValues is a scratch
  // copy, and nothing touches the report until the technician chooses to
  // commit it. That is the right model for "did I mean to change this
  // answer", but it did nothing for the much more common way work actually
  // gets lost in the field: the phone locks, a call comes in and the OS
  // reclaims a backgrounded tab, the battery dies — none of which go through
  // the back arrow at all, so the discard-confirm never gets a chance to
  // fire. This autosaves the scratch copy to its own local-only store, and
  // offers it back the next time the section is opened.
  //
  // Photo/image values are deliberately excluded. They're either already
  // durable elsewhere (a capture is written to IndexedDB the instant the
  // shutter fires, independent of this section entirely) or captured in one
  // fast, atomic gesture (a signature, a flattened sketch) with nowhere near
  // the multi-minute exposure a typed paragraph has — so re-writing a
  // multi-megabyte blob or data URL into a draft every few seconds would be
  // pure cost for a risk that barely exists.
  function draftableValues(values) {
    const out = {};
    for (const [fieldId, value] of Object.entries(values || {})) {
      if (Array.isArray(value) && value.some((v) => v && typeof v === 'object' && 'blob' in v)) continue;
      if (typeof value === 'string' && value.startsWith('data:image/')) continue;
      out[fieldId] = value;
    }
    return out;
  }

  let autosaveTimer = null;
  const AUTOSAVE_INTERVAL_MS = 20000;

  async function autosaveDraftNow() {
    if (!currentReport || !currentSectionId) return;
    const draft = draftableValues(pendingSectionValues);
    if (!Object.keys(draft).length) return;
    // Nothing unsaved means nothing to preserve. Writing a draft identical to
    // what is already committed is not just wasted work: it is how a draft the
    // technician explicitly declined to restore comes back, because declining
    // deletes the draft and then this timer writes the same values straight
    // back under the same key. "Discarded for good" has to survive the next
    // tick of the clock to mean anything.
    const section = findSection(currentSectionId);
    if (section && !draftDiffersFromCommitted(section, currentReport.sections[currentSectionId], draft)) return;
    try {
      await DB.saveSectionDraft(currentReport.jobId, currentSectionId, draft);
    } catch (e) {
      // A failed autosave must never surface as an error interrupting an
      // inspection — it's a safety net under the real save flow, not a
      // replacement for it. Silently trying again on the next tick is the
      // right failure mode.
      console.warn('[report] section autosave failed:', e.message || e);
    }
  }

  function startAutosave() {
    stopAutosave();
    autosaveTimer = setInterval(autosaveDraftNow, AUTOSAVE_INTERVAL_MS);
  }

  function stopAutosave() {
    if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  }

  // Covers the case a timer never gets a chance to: the tab is backgrounded
  // (app switched away from, phone locked) a few seconds after a technician
  // finishes typing but before the next tick — exactly the moment a mobile
  // OS is most likely to decide to reclaim the page.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !viewReportSection.classList.contains('hidden')) autosaveDraftNow();
  });

  // A draft that merely repeats what's already committed isn't work to
  // recover — it's noise from a section that was opened, looked at, and
  // left alone. Only a real difference is worth interrupting for.
  function draftDiffersFromCommitted(section, committed, draftValues) {
    return diffSection(section, committed, { ...committed, ...draftValues }).length > 0;
  }

  async function openSectionEditor(sectionId) {
    currentSectionId = sectionId;
    const section = findSection(sectionId);
    pendingSectionValues = cloneSectionValues(currentReport.sections[sectionId]);
    bindSectionValues();

    const draft = await DB.getSectionDraft(currentReport.jobId, sectionId).catch(() => null);
    if (draft && draft.values && draftDiffersFromCommitted(section, currentReport.sections[sectionId], draft.values)) {
      const when = new Date(draft.savedAt).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
      if (await askConfirm(
        `This section has unsaved work from ${when} that was never saved — the app closed or was interrupted before you finished. `
        + 'Restore it and pick up where you left off?',
        { title: 'Unsaved work found', okLabel: 'Restore it' }
      )) {
        pendingSectionValues = { ...pendingSectionValues, ...draft.values };
        bindSectionValues();
      } else {
        await DB.deleteSectionDraft(currentReport.jobId, sectionId).catch(() => {});
      }
    }
    startAutosave();

    if (sectionId === 'inspector') {
      // From the signed-in technician's own profile, not a lookup table in
      // this file. Adding a second technician used to mean a deploy.
      const defaults = window.Org ? window.Org.inspector() : null;
      if (defaults) {
        for (const [fieldId, value] of Object.entries(defaults)) {
          if (!value) continue;
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
    aiSuggestedValues = {};
    aiPendingSuggestions = {};
    aiDeclinedFieldIds = new Set();
    const aiFieldsForSection = (currentReport.aiDraft && currentReport.aiDraft.draftFields && currentReport.aiDraft.draftFields[sectionId]) || {};
    applyDraftFieldsToPending(section, aiFieldsForSection);

    sectionTitleEl.textContent = `${section.number}. ${section.title}`;
    sectionSubtitleEl.textContent = section.subtitle || '';

    renderCurrentSectionFields();

    hide(viewReport);
    show(viewReportSection);
  }

  // ---------- the form renderer ----------
  // The controls themselves live in form-render.js now. What stays here is
  // everything that is about inspections rather than about forms: the field
  // types only a report has, and the AI offer UI that hangs off a row.
  //
  // The split exists because a Safe Work Method Statement needs exactly these
  // text boxes, date pickers, yes/no toggles and signature pads, and while
  // they were defined inside this file the only way to get them was to be a
  // report — which a safety statement is not.
  const formRenderer = window.FormRender.create({
    values: pendingSectionValues,
    container: sectionFieldsEl,

    // The field types that are about pest control rather than about forms.
    // The shared renderer has no idea what a bait station or a mud map is,
    // and should not.
    customFields: {
      photos: (field) => renderPhotosField(field),
      sketch: (field) => renderSketchField(field),
      productList: (field) => renderProductListField(field),
      stationList: (field) => renderStationListField(field),
    },

    // Everything the AI draft puts on a row. A report gets this; a safety
    // statement passes no decorator and gets a plain row.
    decorateRow: (row, field) => decorateRowWithAi(row, field),

    // Ready-made wording from Tal's own past reports (comment-templates.js).
    // v142: the business can also add its own, and hide built-ins it never uses.
    commentTemplates: window.CommentTemplates ? {
      list: (field) => window.CommentTemplates.forField(field.id),
      add: (field, label, text) => window.CommentTemplates.add(field.id, label, text),
      remove: (field, item) => window.CommentTemplates.remove(field.id, item),
      restoreHidden: (field) => window.CommentTemplates.restoreHidden(field.id),
      hiddenCount: (field) => window.CommentTemplates.hiddenCount(field.id),
    } : null,

    onFieldChange: (field, value) => {
      if (field.id === 'jobCategory') applyJobCategoryPrefill(value);
    },
  });

  function renderField(field) {
    formRenderer.setSection(findSection(currentSectionId));
    return formRenderer.renderField(field);
  }

  function refreshVisibility() {
    formRenderer.setSection(findSection(currentSectionId));
    formRenderer.refreshVisibility();
  }

  // pendingSectionValues is REPLACED rather than mutated when a section
  // opens, so the renderer has to be re-pointed at the new object or it goes
  // on writing into the previous section's values — which would look like
  // edits vanishing on save.
  function bindSectionValues() {
    formRenderer.setValues(pendingSectionValues);
  }

  // The AI offer UI, lifted out of the old fieldRowWrapper unchanged. It is
  // report-specific in every line: it reads currentReport.aiDraft, it scores
  // declines for the accuracy summary, and it re-renders the section. None of
  // that belongs in a generic form renderer, so it arrives through the
  // decorateRow hook instead.
  function decorateRowWithAi(row, field) {
    // What this answer can add to the report, said where the choice is made.
    // See describeGate in report-schema.js for why it has to be here and not
    // only afterwards.
    const utils = window.ReportSchemaUtils;
    if (utils && utils.sectionsGatedBy) {
      const gateText = utils.describeGate(field, utils.sectionsGatedBy(currentSchema(), currentSectionId, field.id));
      if (gateText) {
        const gate = document.createElement('span');
        gate.className = 'field-gate-note';
        gate.textContent = gateText;
        row.appendChild(gate);
      }
    }

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

    // An offered-but-unapplied suggestion, for the fields that assert
    // something about the property. Shown as what the AI would answer and why,
    // with the answer still blank until somebody agrees with it. Declining
    // leaves the field empty rather than filling in the opposite — the AI
    // being wrong about "yes" is not evidence for "no".
    if (Object.prototype.hasOwnProperty.call(aiPendingSuggestions, field.id)) {
      const suggested = aiPendingSuggestions[field.id];
      const offer = document.createElement('div');
      offer.className = 'ai-offer';
      offer.setAttribute('data-field', field.id);

      const reasons = (currentReport.aiDraft && currentReport.aiDraft.fieldReasons
        && currentReport.aiDraft.fieldReasons[currentSectionId]) || {};
      const why = reasons[field.id];

      // Multiselects (Target Pests) arrive as an array. String() on one gives
      // "Ants,Spiders" with no space, which reads like a typo on the screen
      // and, worse, on the button the technician is being asked to press.
      const shown = Array.isArray(suggested) ? suggested.join(', ') : String(suggested);

      const text = document.createElement('p');
      text.className = 'ai-offer-text';
      text.innerHTML = `✨ AI would answer <strong>${escapeHtml(shown)}</strong>`
        + (why ? ` — ${escapeHtml(why)}` : '');
      offer.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'ai-offer-actions';

      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'btn btn-secondary ai-offer-accept';
      // Long multiselect answers would make a button wider than a phone, so
      // the label falls back to a plain "Use this" once it stops being a
      // short, readable answer a technician can agree with at a glance.
      accept.textContent = shown.length <= 32 ? `Use "${shown}"` : 'Use this answer';
      accept.addEventListener('click', () => {
        pendingSectionValues[field.id] = suggested;
        aiSuggestedValues[field.id] = suggested;   // so recordAiReview still scores it
        delete aiPendingSuggestions[field.id];
        renderCurrentSectionFields();
      });

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'link-btn';
      dismiss.textContent = 'Answer it myself';
      dismiss.addEventListener('click', () => {
        delete aiPendingSuggestions[field.id];
        // Remembered, not just dropped. Somebody looked at the photograph and
        // at the model's answer and chose their own — that is a graded wrong
        // answer and the most informative thing this app can collect about
        // whether the AI is any good on real work.
        aiDeclinedFieldIds.add(field.id);
        renderCurrentSectionFields();
      });

      actions.append(accept, dismiss);
      offer.appendChild(actions);
      row.appendChild(offer);
    }
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
  // Default wording is termite baiting. A field can override both lists —
  // rodent stations are the same shape of record but a different vocabulary,
  // and asking a technician whether a rodent station shows 'Termite activity'
  // is how a chip row stops being read and starts being tapped through.
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

        card.appendChild(chipRow('Found', field.statusOptions || STATION_STATUS, station.status, (v) => {
          station.status = v;
          redraw();
        }));
        card.appendChild(chipRow('Did', field.actionOptions || STATION_ACTION, station.action, (v) => {
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
      stations.push({ id: DB.uid(), assetId: DB.uid(), stationNumber: String(stations.length + 1) });
      redraw();
    });

    // Scanning the sticker inside the cap, rather than finding the row by
    // eye. A monitoring system is eight to thirty stations around one house,
    // and hunting for station 17 in a list while kneeling in a garden bed is
    // how a finding ends up recorded against station 19 — which on the
    // document the warranty rests on is not a typo, it is a false record.
    //
    // A code that belongs to a station not on this register is not an error:
    // it is a station that was installed before the register was, so it is
    // added rather than refused.
    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'btn btn-secondary flex1';
    scanBtn.textContent = '📷 Scan station';
    scanBtn.addEventListener('click', async () => {
      if (!window.QrScan) { toast('The scanner is not available on this device.'); return; }
      const assetId = await window.QrScan.scanStation();
      if (!assetId) return;

      let index = stations.findIndex((s) => s.assetId === assetId);
      if (index === -1) {
        stations.push({ id: DB.uid(), assetId, stationNumber: String(stations.length + 1) });
        index = stations.length - 1;
        redraw();
        toast(`New station added as ${stations[index].stationNumber}`);
      } else {
        toast(`Station ${stations[index].stationNumber || index + 1}`);
      }
      // Bring it to where the technician is looking, and mark it, because a
      // scan that silently scrolls a list is a scan nobody trusts.
      const card = cardsWrap.children[index];
      if (card) {
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.classList.add('station-scanned');
        setTimeout(() => card.classList.remove('station-scanned'), 2200);
      }
    });

    // Most visits are "all of them, all clear". Doing that in one tap and then
    // correcting the two that weren't is far faster than twenty additions, and
    // it produces a complete record rather than a partial one.
    const allClearBtn = document.createElement('button');
    allClearBtn.type = 'button';
    allClearBtn.className = 'btn btn-secondary flex1';
    allClearBtn.textContent = 'All checked, no activity';
    allClearBtn.addEventListener('click', async () => {
      const count = Number(await askPrompt('How many stations are on this property?', String(stations.length || 8),
        { title: 'All checked, no activity', okLabel: 'Add stations', inputType: 'number' }));
      if (!Number.isFinite(count) || count < 1 || count > 100) return;
      stations.length = 0;
      for (let i = 1; i <= count; i++) {
        stations.push({ id: DB.uid(), assetId: DB.uid(), stationNumber: String(i), status: 'No activity', action: 'Nothing required' });
      }
      redraw();
    });

    controls.appendChild(addBtn);
    controls.appendChild(allClearBtn);
    controls.appendChild(scanBtn);
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
    // The AI status used to live here, because analysis started the moment a
    // photo was added. It is on the report screen's own button now — one
    // place, pressed once, when the technician has finished photographing.


    // Two inputs, because one cannot do both jobs. `capture` tells a phone to
    // open the camera and skip the gallery entirely — which is right when you
    // are standing in front of the thing, and wrong when the photograph is
    // already on the phone, taken earlier or sent by the client. Without a
    // second input there was no way to attach one.
    // Each photo is made a sensible size first (photo-prep.js): a phone camera
    // photo straight from the camera app is several megabytes, too big to
    // store, sync and have the AI read. That takes a moment, so the section
    // these are for is noted first and they are only added if it is still
    // the one open.
    async function addFiles(list) {
      const files = Array.from(list || []).filter(Boolean);
      if (!files.length) return;
      const sectionValues = pendingSectionValues;
      const prepared = [];
      for (const file of files) {
        prepared.push(window.PhotoPrep ? await window.PhotoPrep.prepare(file) : file);
      }
      if (sectionValues !== pendingSectionValues) {
        toast('Those photos were not added: the section was closed while they were being prepared. Add them again.');
        return;
      }
      for (const blob of prepared) photos.push({ id: DB.uid(), blob });
      pendingSectionValues[field.id] = photos;
      redrawGrid();
      // Nothing is sent anywhere here, deliberately. See the note on the
      // AI button below: analysis happens once, when the technician says so.
    }

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    // setAttribute, not the property. `capture` is what tells a phone to open
    // the camera rather than the gallery, and assigning the property does not
    // reliably reflect to the attribute — which is how this ends up opening
    // the photo library on the one device nobody tested.
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.className = 'hidden';
    cameraInput.addEventListener('change', () => { addFiles(cameraInput.files); cameraInput.value = ''; });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'image/*';
    // No `capture`, so this opens the gallery or the file picker. Multiple,
    // because importing is usually a batch — a set of shots taken before the
    // report was started, or a handful the client emailed through.
    importInput.multiple = true;
    importInput.className = 'hidden';
    importInput.addEventListener('change', () => { addFiles(importInput.files); importInput.value = ''; });

    const buttonRow = document.createElement('div');
    buttonRow.className = 'row gap photo-field-buttons';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline flex1';
    addBtn.textContent = '📷 Take Photo';
    addBtn.addEventListener('click', () => cameraInput.click());

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'btn btn-secondary flex1';
    importBtn.textContent = '🖼 Import';
    importBtn.addEventListener('click', () => importInput.click());

    buttonRow.append(addBtn, importBtn);

    wrap.appendChild(grid);
    wrap.appendChild(buttonRow);
    wrap.appendChild(cameraInput);
    wrap.appendChild(importInput);

    // A focused species-level read of one field's photos, separate from
    // triggersAiFill's whole-section drafting above — see identifiesInsects
    // in pest-treatment-schema.js and handleIdentifyPest in the Edge
    // Function. Suggestion only: applying a match is a deliberate tap, never
    // automatic.
    if (field.identifiesInsects) {
      const identifyBtn = document.createElement('button');
      identifyBtn.type = 'button';
      identifyBtn.className = 'btn btn-outline';
      identifyBtn.textContent = '🔍 Identify Pest';

      const resultsEl = document.createElement('div');
      resultsEl.className = 'identify-pest-results hidden';

      function renderResults(identifications, options) {
        resultsEl.innerHTML = '';
        if (!identifications.length) {
          const empty = document.createElement('p');
          empty.className = 'identify-pest-empty';
          // Two different things produce an empty answer and they need
          // different responses from the technician. A poor photo should be
          // retaken. A good photo of damage, workings or a mud tube should
          // NOT be — this tool identifies insects, and since the prompt was
          // tightened it deliberately declines to read a cause from damage
          // alone, because mud tubes are built by ants too and rotted timber
          // looks like eaten timber. Telling someone to retake a sharp,
          // correct photograph sends them back to a wall for nothing.
          empty.textContent = 'No insect identified. If this photo shows damage, '
            + 'workings or a mud tube rather than the insect itself, that is expected — '
            + 'finish the inspection and those are read into the report instead. '
            + 'If you did photograph an insect, try a closer or sharper shot.';
          resultsEl.appendChild(empty);
          resultsEl.classList.remove('hidden');
          return;
        }
        for (const id of identifications) {
          const card = document.createElement('div');
          card.className = 'identify-pest-card';
          card.innerHTML = `
            <div class="identify-pest-name">${escapeHtml(id.commonName)}${id.scientificName ? ` <span class="identify-pest-sci">(${escapeHtml(id.scientificName)})</span>` : ''}</div>
            <div class="identify-pest-confidence identify-pest-confidence-${escapeHtml(id.confidence)}">${escapeHtml(id.confidence)} confidence</div>
            <div class="identify-pest-reasoning">${escapeHtml(id.reasoning)}</div>
          `;
          if (id.matchedCategory && options.includes(id.matchedCategory)) {
            const applyBtn = document.createElement('button');
            applyBtn.type = 'button';
            applyBtn.className = 'btn btn-secondary identify-pest-apply';
            applyBtn.textContent = `+ Apply "${id.matchedCategory}" to Target Pest(s)`;
            applyBtn.addEventListener('click', () => {
              const current = new Set(pendingSectionValues.targetPests || []);
              current.add(id.matchedCategory);
              pendingSectionValues.targetPests = Array.from(current);
              renderCurrentSectionFields();
              toast(`Added "${id.matchedCategory}" to Target Pest(s)`);
            });
            card.appendChild(applyBtn);
          }
          resultsEl.appendChild(card);
        }
        resultsEl.classList.remove('hidden');
      }

      identifyBtn.addEventListener('click', async () => {
        if (!photos.length) { toast('Add a photo first.'); return; }
        if (!window.AI || !window.AI.identifyPest) { toast('AI features need you signed in and online — they are off in demo mode. Your photos are still saved.'); return; }
        identifyBtn.disabled = true;
        identifyBtn.textContent = '🔍 Identifying…';
        try {
          const section = findSection(currentSectionId);
          const targetField = section && (section.fields || []).find((f) => f.id === 'targetPests');
          const options = (targetField && targetField.options) || [];
          const result = await window.AI.identifyPest(photos.map((p) => p.blob), options);
          renderResults(result.identifications || [], options);
        } catch (err) {
          console.warn('[report] pest identification failed:', err.message || err);
          toast('Could not identify the pest: ' + aiErrorText(err));
        } finally {
          identifyBtn.disabled = false;
          identifyBtn.textContent = '🔍 Identify Pest';
        }
      });

      wrap.appendChild(identifyBtn);
      wrap.appendChild(resultsEl);
    }

    // Species + termite susceptibility per tree photographed — feeds
    // treeAssessmentNotes in the same section (Conducive Conditions), one
    // tap at a time. See identifiesTrees in report-schema.js and
    // handleIdentifyTree in the Edge Function.
    if (field.identifiesTrees) {
      const identifyTreeBtn = document.createElement('button');
      identifyTreeBtn.type = 'button';
      identifyTreeBtn.className = 'btn btn-outline';
      identifyTreeBtn.textContent = '🌳 Identify Tree';

      const treeResultsEl = document.createElement('div');
      treeResultsEl.className = 'identify-pest-results hidden';

      function renderTreeResults(trees) {
        treeResultsEl.innerHTML = '';
        if (!trees.length) {
          const empty = document.createElement('p');
          empty.className = 'identify-pest-empty';
          empty.textContent = 'No tree clearly identifiable in these photos — try a closer, clearer shot.';
          treeResultsEl.appendChild(empty);
          treeResultsEl.classList.remove('hidden');
          return;
        }
        for (const tree of trees) {
          const card = document.createElement('div');
          card.className = 'identify-pest-card';
          // Proximity is often the whole decision — a susceptible tree ten
          // metres away matters far less than a moderate one against the
          // slab — so it goes on the card, not buried in the reasoning.
          const prox = tree.proximityToStructure && tree.proximityToStructure !== 'not visible in frame'
            ? `<div class="identify-pest-meta">${escapeHtml(tree.proximityToStructure)} the structure${tree.rootRisk ? ' · roots may lift paving or slab edges' : ''}</div>`
            : '';
          card.innerHTML = `
            <div class="identify-pest-name">${escapeHtml(tree.species)}</div>
            <div class="identify-pest-confidence identify-pest-confidence-${escapeHtml(tree.susceptibility)}">${escapeHtml(tree.susceptibility)} termite susceptibility</div>
            ${prox}
            <div class="identify-pest-reasoning">${escapeHtml(tree.reasoning)}</div>
            ${tree.recommendDrilling ? '<div class="identify-pest-flag">⚠ Worth drilling / further inspection</div>' : ''}
          `;
          const applyBtn = document.createElement('button');
          applyBtn.type = 'button';
          applyBtn.className = 'btn btn-secondary identify-pest-apply';
          applyBtn.textContent = '+ Add to Tree Notes';
          applyBtn.addEventListener('click', () => {
            // reportNote is written for the client to read. reasoning is the
            // AI explaining itself to the technician — bark texture, why it
            // called the species — which has no business in a client's
            // report. Older responses have no reportNote, so fall back.
            const line = tree.reportNote
              || `${tree.species} — ${tree.susceptibility} termite susceptibility. ${tree.reasoning}`
                 + (tree.recommendDrilling ? ' Recommend drilling/further inspection.' : '');
            const existing = pendingSectionValues.treeAssessmentNotes || '';
            pendingSectionValues.treeAssessmentNotes = existing ? `${existing}\n${line}` : line;
            renderCurrentSectionFields();
            toast('Added to Tree Species & Termite Susceptibility notes');
          });
          card.appendChild(applyBtn);
          treeResultsEl.appendChild(card);
        }
        treeResultsEl.classList.remove('hidden');
      }

      identifyTreeBtn.addEventListener('click', async () => {
        if (!photos.length) { toast('Add a photo first.'); return; }
        if (!window.AI || !window.AI.identifyTree) { toast('AI features need you signed in and online — they are off in demo mode. Your photos are still saved.'); return; }
        identifyTreeBtn.disabled = true;
        identifyTreeBtn.textContent = '🌳 Identifying…';
        try {
          const result = await window.AI.identifyTree(photos.map((p) => p.blob));
          renderTreeResults(result.trees || []);
        } catch (err) {
          console.warn('[report] tree identification failed:', err.message || err);
          toast('Could not identify the tree: ' + aiErrorText(err));
        } finally {
          identifyTreeBtn.disabled = false;
          identifyTreeBtn.textContent = '🌳 Identify Tree';
        }
      });

      wrap.appendChild(identifyTreeBtn);
      wrap.appendChild(treeResultsEl);
    }

    // General Site Photos sorts itself automatically on Generate Form (see
    // sortGeneralPhotos in report.js), but a technician working the report
    // straight from the editor — no live inspection involved — needs a way
    // to trigger it without leaving the section. Saves the section first, so
    // a photo just added here is actually there to sort.
    if (field.autoSorts) {
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'btn btn-outline';
      sortBtn.textContent = '🤖 Sort These Photos Now';
      sortBtn.addEventListener('click', async () => {
        if (!photos.length) { toast('Add a photo first.'); return; }
        if (!window.ReportUI || !window.ReportUI.sortGeneralPhotos) { toast('AI features need you signed in and online — they are off in demo mode. Your photos are still saved.'); return; }
        sortBtn.disabled = true;
        sortBtn.textContent = '🤖 Sorting…';
        try {
          currentReport.sections[currentSectionId] = pendingSectionValues;
          await DB.saveReport(currentReport);
          await window.ReportUI.sortGeneralPhotos(currentJobId);
          renderCurrentSectionFields();
        } catch (err) {
          console.warn('[report] could not sort general photos:', err.message || err);
          toast('Could not sort those photos: ' + aiErrorText(err));
        } finally {
          sortBtn.disabled = false;
          sortBtn.textContent = '🤖 Sort These Photos Now';
        }
      });
      wrap.appendChild(sortBtn);
    }

    return wrap;
  }


  // The site sketch (mud map) pad lives in report-sketch.js since v128. It
  // asks for the job and the section's answers through these two, so it
  // always reads the current ones.
  function renderSketchField(field) {
    return window.ReportSketch.render(field, { job: () => currentJob, values: () => pendingSectionValues });
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
      textContent: 'This summary updates automatically from your answers in Findings & Observations, Areas We Were Unable to Inspect and Conducive Conditions — tap any row to jump there.',
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
      textContent: 'This summary updates automatically from your answers in Client Details, Pest Identification, Treatment Details, Chemicals / Products Used and Recommendations & Follow-Up — tap any row to jump there.',
    }));
    sectionFieldsEl.appendChild(wrap);
  }

  function renderFixedTerms() {
    const wrap = document.createElement('div');
    wrap.className = 'terms-text';
    wrap.innerHTML = (currentJob && currentJob.jobType === 'pest_treatment') ? window.ReportPrint.FIXED_TERMS_HTML_PEST : window.ReportPrint.FIXED_TERMS_HTML;
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
      reason = (await askPrompt(
        `This report was finalized on ${fmtDate(currentReport.finalizedAt)}.\n\n`
        + `You are amending: ${summary}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}.\n\n`
        + 'Give a brief reason for the amendment (recorded in the report\'s audit trail):',
        '',
        { title: 'Reason for amendment', okLabel: 'Record amendment', multiline: true,
          placeholder: 'e.g. Corrected unit number after the client called' }
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

    recordAiReview();

    // Which sections are on screen BEFORE this save, so a change in that list
    // can be explained rather than just happening.
    //
    // Answering "Is the existing termite management system adequate?" with
    // anything other than "Adequate" adds two whole sections — a proposed
    // works page and a warranty page. That is correct behaviour and it is
    // also how a technician ends up back at the report asking what triggered
    // the action plan, because the answer that caused it was three fields up
    // in a different section and may well have been an AI suggestion they
    // tapped. The cause and the effect were never shown together.
    const sectionsBefore = new Set(visibleSchema(currentSchema(), currentReport).map((s) => s.id));

    currentReport.sections[currentSectionId] = pendingSectionValues;
    await DB.saveReport(currentReport);
    stopAutosave();
    DB.deleteSectionDraft(currentReport.jobId, currentSectionId).catch(() => {});
    hide(viewReportSection);
    renderSectionList();
    show(viewReport);
    if (reason) toast(`Amendment recorded (${changes.length} field${changes.length === 1 ? '' : 's'}).`);

    announceSectionChanges(sectionsBefore, section);
  });

  // Why a gated section is on screen, in the words of the answer that put it
  // there. Returns '' for a section that is always shown, which is most of
  // them — a note against every row would just be noise.
  function reasonSectionIsShown(section) {
    const cond = section && section.showIf;
    if (!cond || !currentReport || !currentReport.sections) return '';
    const sourceSection = currentSchema().find((s) => s.id === cond.section);
    const field = sourceSection && sourceSection.fields.find((f) => f.id === cond.field);
    const answer = (currentReport.sections[cond.section] || {})[cond.field];
    if (!field || !answer) return '';
    // Names the QUESTION as well as the answer. "Because you answered 'Present
    // but inadequate'" is a mystery to somebody who does not remember which of
    // forty questions that was the answer to.
    return `Because you answered “${answer}” to “${field.label}”`;
  }

  // Says which sections just appeared or disappeared, and because of what.
  //
  // Named at the moment it happens, while the answer that caused it is still
  // the last thing the technician did. A section quietly appearing in a list
  // of eleven is not noticed until later, and then it is a mystery.
  function announceSectionChanges(beforeIds, savedSection) {
    const after = visibleSchema(currentSchema(), currentReport);
    const afterIds = new Set(after.map((s) => s.id));

    const added = after.filter((s) => !beforeIds.has(s.id));
    const removed = Array.from(beforeIds).filter((id) => !afterIds.has(id));
    if (!added.length && !removed.length) return;

    // The field in the section just saved whose answer did it. There is only
    // ever one gate per section in this schema, so naming the first is
    // naming the cause.
    const trigger = added.concat(
      // A removed section's own showIf still tells us what controlled it.
      removed.map((id) => (currentSchema().find((s) => s.id === id))).filter(Boolean)
    ).map((s) => s.showIf).find((c) => c && c.section === (savedSection && savedSection.id));

    let because = '';
    if (trigger && savedSection) {
      const field = savedSection.fields.find((f) => f.id === trigger.field);
      const answer = pendingSectionValues[trigger.field];
      if (field && answer) {
        because = ` — you answered “${String(answer)}” to “${field.label}”`;
      }
    }

    if (added.length) {
      const names = added.map((s) => s.title).join(' and ');
      toast(`${names} ${added.length === 1 ? 'has' : 'have'} been added to this report${because}.`);
    } else {
      const names = removed
        .map((id) => (currentSchema().find((s) => s.id === id) || {}).title || id)
        .join(' and ');
      toast(`${names} ${removed.length === 1 ? 'is' : 'are'} no longer needed${because}.`);
    }
  }

  // The header arrow is the most instinctive "go back" affordance there is —
  // and until this, tapping it silently threw away anything typed or
  // photographed in the section, with no warning at all. A technician who
  // just took photos and tapped ← (a completely natural thing to do) lost
  // them with no sign anything had gone wrong. Now it only discards after
  // confirming there's actually something to lose, and lets them cancel
  // back into the editor rather than lose work to a habitual tap.
  sectionBackBtn.addEventListener('click', async () => {
    const section = findSection(currentSectionId);
    const changes = diffSection(section, currentReport.sections[currentSectionId], pendingSectionValues);
    if (changes.length && !await askConfirm(
      `Discard ${changes.length} unsaved change${changes.length === 1 ? '' : 's'} to this section? `
      + 'Tap Cancel to go back and use "Save & Back to Report" instead.',
      { title: 'Discard unsaved work?', okLabel: 'Discard', danger: true }
    )) {
      return;
    }
    // A confirmed discard means the technician chose to throw this away —
    // the autosafety-net draft should go with it, not reappear as a
    // "restore your unsaved work?" prompt the next time this section opens.
    stopAutosave();
    DB.deleteSectionDraft(currentReport.jobId, currentSectionId).catch(() => {});
    hide(viewReportSection);
    show(viewReport);
  });

  // ---------- PDF export (print view) ----------
  // Lives in report-print.js since v127: it builds the printed document and
  // the emailed PDF from a job and its report, and needs only these few
  // things from here. The fixed terms text moved with it (the section editor
  // shows the same words; see renderFixedTerms).
  window.ReportPrint.init({ reportTitleFor, schemaFor, visibleSchema, isFieldVisible, trackUrl, fmtAuditTime });
  const generateReportPdfBlob = (job, report) => window.ReportPrint.generatePdfBlob(job, report);
  async function exportPdf() {
    const job = await DB.getJob(currentJobId);
    window.ReportPrint.openPrintWindow(job, currentReport);
  }
})();
