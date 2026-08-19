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
  function schemaFor(jobType) {
    return jobType === 'pest_treatment' ? (window.PEST_TREATMENT_SCHEMA || []) : window.REPORT_SCHEMA;
  }
  // Convenience for the many call sites that only run once a report is open
  // (currentJob is set in openReview before any of them can be reached).
  function currentSchema() {
    return schemaFor(currentJob && currentJob.jobType);
  }

  // Single source of truth for the report's display name — used by the
  // on-screen header, the print window's <title>, and the PDF cover line,
  // so those three can never drift out of sync.
  function reportTitleFor(jobType) {
    return jobType === 'pest_treatment' ? 'General Pest Treatment Report' : 'Termite Inspection Report';
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

  // ---------- Report load / prefill ----------
  async function loadOrCreateReport(jobId) {
    let report = await DB.getReport(jobId);
    if (report) return report;

    const job = await DB.getJob(jobId);
    const sections = {};
    for (const section of schemaFor(job && job.jobType)) {
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

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------- Public entry point ----------
  window.ReportUI = {
    async openReview(jobId) {
      currentJobId = jobId;
      currentReport = await loadOrCreateReport(jobId);
      const job = await DB.getJob(jobId);
      currentJob = job || null;
      // The header is the technician's main cue for which report they're in —
      // it must follow the job type, not stay hardcoded to the termite wording.
      if (reportTitle) reportTitle.textContent = reportTitleFor(job && job.jobType);
      reportSubtitle.textContent = job ? job.name : '';
      renderSectionList();
      updateAiDraftButton();
      hideAllAppViews();
      show(viewReport);
    },
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

  function hideAllAppViews() {
    document.getElementById('view-joblist').classList.add('hidden');
    document.getElementById('view-job').classList.add('hidden');
    hide(viewReport);
    hide(viewReportSection);
    hide(viewArchive);
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

  function renderSectionList() {
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
    if (!confirm('Finalize this report? You can still reopen sections to make corrections afterwards.')) return;
    currentReport.finalizedAt = Date.now();
    await DB.saveReport(currentReport);
    await DB.updateJob(currentJobId, { status: 'completed' });
    toast('Report finalized');
    renderSectionList();
    if (window.refreshJobViewStatus) await window.refreshJobViewStatus(currentJobId);
    offerForemanFollowUpTask(currentJobId);
  });

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
      note.textContent = '✨ AI suggested — review and edit if needed';
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
    }

    sectionFieldsEl.appendChild(row);
  }

  // Sub-fields shown per entry in a productList field (e.g. the Chemicals /
  // Products Used section) — same 6 fields for every product, matching a
  // typical pesticide-use record. Only productName is required per entry;
  // the rest are commonly on the product label but not always all captured.
  const PRODUCT_LIST_SUBFIELDS = [
    { id: 'productName', label: 'Product / Trade Name', required: true },
    { id: 'apvmaNumber', label: 'APVMA Registration Number' },
    { id: 'activeConstituent', label: 'Active Constituent(s)' },
    { id: 'batchNumber', label: 'Batch / Lot Number' },
    { id: 'quantityApplied', label: 'Quantity Applied (e.g. 2.5 L, 500 g)' },
    { id: 'dilutionRate', label: 'Dilution / Application Rate' },
  ];

  // Renders a repeatable list of structured chemical-product records — used
  // for jobs where more than one product is applied (typical for a general
  // pest treatment). Each entry is its own small card with all 6 sub-fields
  // plus a remove button; "+ Add Product" appends a new blank one. Stored as
  // an array of plain objects on pendingSectionValues[field.id], same
  // mutate-in-place + redraw pattern as renderPhotosField.
  function renderProductListField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'product-list-field';
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'product-list-cards';

    const products = pendingSectionValues[field.id] || [];
    pendingSectionValues[field.id] = products;

    function redraw() {
      cardsWrap.innerHTML = '';
      if (!products.length) {
        cardsWrap.appendChild(Object.assign(document.createElement('p'), {
          className: 'empty-hint',
          textContent: 'No products added yet — tap "+ Add Product" to record one.',
        }));
      }
      products.forEach((product, idx) => {
        const card = document.createElement('div');
        card.className = 'product-card';

        const header = document.createElement('div');
        header.className = 'product-card-header';
        const title = document.createElement('span');
        title.textContent = 'Product ' + (idx + 1);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'product-card-remove';
        removeBtn.textContent = '✕ Remove';
        removeBtn.addEventListener('click', () => {
          products.splice(idx, 1);
          redraw();
        });
        header.appendChild(title);
        header.appendChild(removeBtn);
        card.appendChild(header);

        for (const sub of PRODUCT_LIST_SUBFIELDS) {
          const subRow = document.createElement('div');
          subRow.className = 'product-card-field';
          const label = document.createElement('label');
          label.textContent = sub.label + (sub.required ? ' *' : '');
          const input = document.createElement('input');
          input.type = 'text';
          input.value = product[sub.id] || '';
          input.addEventListener('input', () => { product[sub.id] = input.value; });
          subRow.appendChild(label);
          subRow.appendChild(input);
          card.appendChild(subRow);
        }
        cardsWrap.appendChild(card);
      });
    }
    redraw();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline';
    addBtn.textContent = '+ Add Product';
    addBtn.addEventListener('click', () => {
      products.push({ id: DB.uid() });
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

    function drawGrid() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#eef1f6';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= canvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }
    drawGrid();

    function saveSnapshot() { pendingSectionValues[field.id] = canvas.toDataURL('image/png'); }

    // ---------- Aerial backdrop (Phase 3) ----------
    // Default footprint: a generous centered rectangle, used for voice-guided
    // room subdivision when only a satellite image loaded (no real vector
    // outline) — better than nothing, just less precise than an OSM footprint.
    let footprintPolygon = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
    let backdropKind = null; // null | 'osm' | 'satellite'
    let backdropImage = null;
    let backdropReady = false;

    function drawFootprintPolygon(polygon) {
      ctx.save();
      ctx.strokeStyle = '#2c7a4b';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(44,122,75,0.06)';
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

    function redrawBase() {
      drawGrid();
      if (backdropKind === 'osm') drawFootprintPolygon(footprintPolygon);
      else if (backdropKind === 'satellite' && backdropImage) ctx.drawImage(backdropImage, 0, 0, canvas.width, canvas.height);
    }

    // shouldDraw=false is used when restoring an already-saved sketch: we
    // still want fresh footprint data available for "Describe Rooms", but
    // must not touch the canvas (it already shows the technician's saved work).
    async function loadFootprintData(shouldDraw) {
      if (!(window.AI && currentJob && typeof currentJob.addressLat === 'number' && typeof currentJob.addressLng === 'number')) return;
      try {
        const footprint = await window.AI.fetchFootprint(currentJob.addressLat, currentJob.addressLng);
        if (footprint.source === 'osm' && footprint.polygon && footprint.polygon.length >= 3) {
          footprintPolygon = footprint.polygon;
          backdropKind = 'osm';
          if (shouldDraw) { redrawBase(); saveSnapshot(); }
          backdropReady = true;
          updateDescribeRoomsBtn();
        } else if (footprint.source === 'satellite' && footprint.imageUrl) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            backdropImage = img;
            backdropKind = 'satellite';
            if (shouldDraw) { redrawBase(); saveSnapshot(); }
            backdropReady = true;
            updateDescribeRoomsBtn();
          };
          img.onerror = () => console.warn('[report] aerial backdrop image failed to load');
          img.src = footprint.imageUrl;
        }
      } catch (err) {
        console.warn('[report] aerial backdrop fetch failed:', err.message || err);
      }
    }

    const existing = pendingSectionValues[field.id];
    if (existing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = existing;
      backdropReady = true; // an already-flattened sketch counts as "has content" for the Describe Rooms gate
      loadFootprintData(false);
    } else {
      loadFootprintData(true);
    }

    let mode = 'draw'; // 'draw' | 'label'
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) };
    }

    let drawing = false;
    function start(e) {
      if (mode === 'label') {
        const p = pos(e);
        const text = window.prompt('Label for this spot (e.g. Kitchen, High moisture, Damage):', '');
        if (text) {
          ctx.fillStyle = '#c0552a';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '13px sans-serif';
          ctx.fillText(text, p.x + 8, p.y + 4);
          saveSnapshot();
        }
        e.preventDefault();
        return;
      }
      drawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      e.preventDefault();
    }
    function move(e) { if (!drawing || mode !== 'draw') return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
    function end() { if (!drawing) return; drawing = false; saveSnapshot(); }

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

    function setMode(next) {
      mode = next;
      drawBtn.classList.toggle('active', mode === 'draw');
      labelBtn.classList.toggle('active', mode === 'label');
    }
    drawBtn.addEventListener('click', () => setMode('draw'));
    labelBtn.addEventListener('click', () => setMode('label'));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-secondary';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      // Clear wipes the technician's own drawing/labels/room polygons back
      // to the base layer — it does not lose an already-loaded backdrop.
      redrawBase();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5;
      saveSnapshot();
    });

    controls.appendChild(drawBtn);
    controls.appendChild(labelBtn);
    controls.appendChild(clearBtn);
    wrap.appendChild(controls);

    // ---------- Voice-guided room subdivision (Phase 4) ----------
    const aiControls = document.createElement('div');
    aiControls.className = 'row gap sketch-controls';

    const describeRoomsBtn = document.createElement('button');
    describeRoomsBtn.type = 'button';
    describeRoomsBtn.className = 'btn btn-outline full';
    describeRoomsBtn.textContent = '🎙️ Describe Rooms';
    describeRoomsBtn.disabled = !(window.AI && backdropReady);
    aiControls.appendChild(describeRoomsBtn);
    wrap.appendChild(aiControls);

    let roomRecordingState = 'idle'; // 'idle' | 'recording' | 'processing'
    let roomRecorder = null;
    let roomRecordedChunks = [];
    let roomRecordingStream = null;

    function updateDescribeRoomsBtn() {
      if (roomRecordingState !== 'idle') return; // label already set by the recording flow itself
      describeRoomsBtn.disabled = !(window.AI && backdropReady);
    }

    function drawRoomPolygon(room) {
      if (!room.polygon || room.polygon.length < 3) return;
      ctx.save();
      ctx.strokeStyle = '#154a8a';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(21,74,138,0.08)';
      ctx.beginPath();
      room.polygon.forEach(([x, y], i) => {
        const px = x * canvas.width, py = y * canvas.height;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (room.label) {
        const cx = (room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length) * canvas.width;
        const cy = (room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length) * canvas.height;
        ctx.fillStyle = '#0d2a4d';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(room.label, cx, cy);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }

    async function startRoomRecording() {
      try {
        roomRecordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        toast('Microphone access denied');
        return;
      }
      roomRecordedChunks = [];
      const mimeType = window.pickAudioMimeType ? window.pickAudioMimeType() : '';
      roomRecorder = mimeType ? new MediaRecorder(roomRecordingStream, { mimeType }) : new MediaRecorder(roomRecordingStream);
      roomRecorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size > 0) roomRecordedChunks.push(e.data); });
      roomRecorder.addEventListener('stop', onRoomRecordingStopped);
      roomRecorder.start();
      roomRecordingState = 'recording';
      describeRoomsBtn.disabled = false;
      describeRoomsBtn.textContent = '⏹ Stop & Generate';
      describeRoomsBtn.classList.add('active');
    }

    async function onRoomRecordingStopped() {
      if (roomRecordingStream) { roomRecordingStream.getTracks().forEach((t) => t.stop()); roomRecordingStream = null; }
      if (!roomRecordedChunks.length) {
        roomRecordingState = 'idle';
        describeRoomsBtn.textContent = '🎙️ Describe Rooms';
        describeRoomsBtn.classList.remove('active');
        updateDescribeRoomsBtn();
        toast('No audio recorded');
        return;
      }
      const blob = new Blob(roomRecordedChunks, { type: roomRecorder.mimeType || 'audio/webm' });
      roomRecordedChunks = [];
      roomRecordingState = 'processing';
      describeRoomsBtn.disabled = true;
      describeRoomsBtn.textContent = '🤖 Generating rooms…';

      try {
        const result = await window.AI.subdivideRooms(blob, footprintPolygon);
        const rooms = result.rooms || [];
        for (const room of rooms) drawRoomPolygon(room);
        saveSnapshot();
        toast(`Added ${rooms.length} room${rooms.length === 1 ? '' : 's'} — adjust with Draw/Label as needed`);
      } catch (err) {
        console.error('[room subdivision]', err);
        toast('Room subdivision failed: ' + (err.message || err));
      } finally {
        roomRecordingState = 'idle';
        describeRoomsBtn.textContent = '🎙️ Describe Rooms';
        describeRoomsBtn.classList.remove('active');
        updateDescribeRoomsBtn();
      }
    }

    describeRoomsBtn.addEventListener('click', () => {
      if (roomRecordingState === 'idle') startRoomRecording();
      else if (roomRecordingState === 'recording' && roomRecorder && roomRecorder.state !== 'inactive') roomRecorder.stop();
    });

    wrap.appendChild(Object.assign(document.createElement('p'), {
      className: 'empty-hint',
      textContent: 'Draw the outline with your finger, then switch to Add Label and tap anywhere to name a room or flag something. If a real property outline loaded above, try 🎙️ Describe Rooms and talk through the room layout for a first-pass sketch — it\'s a draft, single-shot per recording, so touch it up with Draw/Label afterward (re-recording clears and starts over).',
    }));
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
      textContent: 'This summary updates automatically from your answers in Findings, Access and Conducive Conditions — tap any row to jump there.',
    }));
    sectionFieldsEl.appendChild(wrap);
  }

  function renderPestTreatmentSummary() {
    const s = (id) => currentReport.sections[id] || {};
    const pest = s('pestIdentification');
    const treatment = s('treatmentDetails');
    const chemicals = s('chemicals');
    const safety = s('safety');
    const recs = s('recommendations');

    const products = chemicals.products || [];
    const productsSummary = products.map((p) => p.productName).filter(Boolean).join(', ');

    const rows = [
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
      textContent: 'This summary updates automatically from your answers in Pest Identification, Treatment Details, Chemicals and Recommendations — tap any row to jump there.',
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
      <h1>${escapeHtml(reportTitleFor(job && job.jobType))}</h1>
      <p>${standardLine}<br>${escapeHtml(job ? job.address : '')}</p>`;

    for (const section of schemaFor(job && job.jobType)) {
      const values = report.sections[section.id] || {};
      html += `<div class="section"><div class="section-head" style="background:${section.color}"><h2>${section.number}. ${escapeHtml(section.title)}</h2></div>`;

      if (section.id === 'summary') {
        html += isPestTreatment
          ? `<p>See Pest Identification, Treatment Details, Chemicals and Recommendations sections for full detail.</p>`
          : `<p>See Findings, Access and Conducive Conditions sections for full detail.</p>`;
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
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div>`;
            products.forEach((p, idx) => {
              html += `<div class="product-pdf-card"><div class="product-pdf-title">Product ${idx + 1}${p.productName ? ': ' + escapeHtml(p.productName) : ''}</div>`;
              if (p.apvmaNumber) html += `<div>APVMA Reg. No: ${escapeHtml(p.apvmaNumber)}</div>`;
              if (p.activeConstituent) html += `<div>Active Constituent: ${escapeHtml(p.activeConstituent)}</div>`;
              if (p.batchNumber) html += `<div>Batch/Lot No: ${escapeHtml(p.batchNumber)}</div>`;
              if (p.quantityApplied) html += `<div>Quantity Applied: ${escapeHtml(p.quantityApplied)}</div>`;
              if (p.dilutionRate) html += `<div>Dilution/Application Rate: ${escapeHtml(p.dilutionRate)}</div>`;
              html += `</div>`;
            });
            html += `</div>`;
          } else {
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(fmtVal(val))}</div></div>`;
          }
        }
      }
      html += `</div>`;
    }
    return html;
  }

  async function exportPdf() {
    const job = await DB.getJob(currentJobId);
    const printWin = window.open('', '_blank');
    if (!printWin) { toast('Allow pop-ups to export the PDF'); return; }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(reportTitleFor(job && job.jobType))}</title>
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
