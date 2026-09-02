(() => {
  'use strict';

  // ---------- Element refs ----------
  const viewLogin = document.getElementById('view-login');
  const viewJobList = document.getElementById('view-joblist');
  const viewJob = document.getElementById('view-job');

  const loginEmailInput = document.getElementById('login-email');
  const loginPasswordInput = document.getElementById('login-password');
  const loginBtn = document.getElementById('login-btn');
  const loginErrorEl = document.getElementById('login-error');

  const syncBar = document.getElementById('sync-bar');
  const syncStatusText = document.getElementById('sync-status-text');
  const syncNowBtn = document.getElementById('sync-now-btn');
  const logoutBtn = document.getElementById('logout-btn');

  const jobForm = document.getElementById('job-form');
  const jobTypePicker = document.getElementById('job-type-picker');
  const jobNameInput = document.getElementById('job-name');
  const jobAddressInput = document.getElementById('job-address');
  const jobAddressSuggestions = document.getElementById('job-address-suggestions');
  const jobPhoneInput = document.getElementById('job-phone');
  const jobEmailInput = document.getElementById('job-email');
  const jobNotesInput = document.getElementById('job-notes');
  const newJobBtn = document.getElementById('new-job-btn');
  const openArchiveBtn = document.getElementById('open-archive-btn');
  const jobFormCancel = document.getElementById('job-form-cancel');
  const jobFormSave = document.getElementById('job-form-save');
  const jobListEl = document.getElementById('job-list');
  const jobEmptyEl = document.getElementById('job-empty');
  const jobSearchInput = document.getElementById('job-search-input');
  const jobStatusFilters = document.getElementById('job-status-filters');

  const backBtn = document.getElementById('back-btn');
  const deleteJobBtn = document.getElementById('delete-job-btn');
  const jobTitleEl = document.getElementById('job-title');
  const jobSubtitleEl = document.getElementById('job-subtitle');
  const zoneSuggestions = document.getElementById('zone-suggestions');
  const zoneChipRow = document.getElementById('zone-chip-row');
  const galleryEl = document.getElementById('gallery');
  const galleryEmptyEl = document.getElementById('gallery-empty');
  const galleryCountEl = document.getElementById('gallery-count');
  const gallerySelectToggle = document.getElementById('gallery-select-toggle');

  const selectionBar = document.getElementById('selection-bar');
  const selectionCancelBtn = document.getElementById('selection-cancel-btn');
  const selectionCountEl = document.getElementById('selection-count');
  const selectionZoneBtn = document.getElementById('selection-zone-btn');
  const selectionDeleteBtn = document.getElementById('selection-delete-btn');

  const bulkZoneModal = document.getElementById('bulk-zone-modal');
  const bulkZoneHint = document.getElementById('bulk-zone-hint');
  const bulkZoneInput = document.getElementById('bulk-zone-input');
  const bulkZoneCancel = document.getElementById('bulk-zone-cancel');
  const bulkZoneSave = document.getElementById('bulk-zone-save');

  const jobStatusBadge = document.getElementById('job-status-badge');
  const inspectionTimerEl = document.getElementById('inspection-timer');
  const startInspectionBtn = document.getElementById('start-inspection-btn');
  const finishInspectionBtn = document.getElementById('finish-inspection-btn');
  const importFootageBtn = document.getElementById('import-footage-btn');
  const viewReportBtn = document.getElementById('view-report-btn');
  // Newer than some deployed index.html files, so guarded at every use — the
  // same CDN-skew hazard the audit refs carry.
  const docTypeRow = document.getElementById('doc-type-row');
  const inspectionPrompt = document.getElementById('inspection-prompt');
  const viewInvoiceBtn = document.getElementById('view-invoice-btn');

  const importModal = document.getElementById('import-modal');
  const importZoneInput = document.getElementById('import-zone-input');
  const importFileInput = document.getElementById('import-file-input');
  const importChooseBtn = document.getElementById('import-choose-btn');
  const importFileList = document.getElementById('import-file-list');
  const importCancelBtn = document.getElementById('import-cancel');
  const importSaveBtn = document.getElementById('import-save');

  const inspectionModal = document.getElementById('inspection-modal');
  const inspectionVideo = document.getElementById('inspection-video');
  const inspectionZonePill = document.getElementById('inspection-zone-pill');
  const inspectionZoneInput = document.getElementById('inspection-zone-input');
  const inspectionChecklistRow = document.getElementById('inspection-checklist-row');
  const inspectionStillBtn = document.getElementById('inspection-still-btn');
  const inspectionFinishBtn = document.getElementById('inspection-finish-btn');
  const inspectionImportBtn = document.getElementById('inspection-import-btn');


  const recordModal = document.getElementById('record-modal');
  const recordTargetLabel = document.getElementById('record-target-label');
  const recordTimerEl = document.getElementById('record-timer');
  const recordCancelBtn = document.getElementById('record-cancel');
  const recordStopBtn = document.getElementById('record-stop');

  const detailModal = document.getElementById('detail-modal');
  const detailClose = document.getElementById('detail-close');
  const detailZoneEl = document.getElementById('detail-zone');
  const detailPhoto = document.getElementById('detail-photo');
  const detailAudioWrap = document.getElementById('detail-audio-wrap');
  const detailAudio = document.getElementById('detail-audio');
  const detailAddMemoBtn = document.getElementById('detail-add-memo');
  const detailApplySuggestedZoneBtn = document.getElementById('detail-apply-suggested-zone');
  const detailDeleteBtn = document.getElementById('detail-delete');
  const detailBody = document.getElementById('detail-body');
  const detailPhotoZoomWrap = document.getElementById('detail-photo-zoom-wrap');
  const detailPrevBtn = document.getElementById('detail-prev');
  const detailNextBtn = document.getElementById('detail-next');

  const toastEl = document.getElementById('toast');

  // ---------- State ----------
  let currentJobId = null;
  let currentCaptures = [];
  const objectUrls = [];

  let facingMode = 'environment';

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStream = null;
  let recordingTimerInterval = null;
  let recordingStartedAt = 0;
  let recordingTarget = null; // { mode: 'new' } | { mode: 'attach', captureId }

  let currentDetailCaptureId = null;
  let currentDetailIndex = -1;

  let jobsCache = [];
  let jobSearchQuery = '';
  let jobStatusFilter = 'all';

  let activeZoneFilter = null;
  let selectMode = false;
  const selectedCaptureIds = new Set();


  // Which job has the camera open right now. With no MediaRecorder to
  // interrogate, this is what tells the UI a photo session is live — it drives
  // whether Finish is shown and whether the camera reopens on return.
  let inspectionActiveJobId = null;
  let inspectionStream = null;
  // The typical-photos checklist for whatever job is currently open in the
  // camera — see photo-checklists.js. inspectionChecklistDone tracks zone
  // labels already covered by a saved capture (not counting Front Elevation,
  // which has its own dedicated prompt), so a re-opened camera picks up
  // where the technician left off instead of forgetting progress.
  let inspectionChecklistItems = [];
  let inspectionChecklistDone = new Set();

  function renderInspectionChecklist() {
    if (!inspectionChecklistItems.length) { hide(inspectionChecklistRow); return; }
    const currentZone = inspectionZoneInput.value.trim();
    inspectionChecklistRow.innerHTML = '';
    for (const item of inspectionChecklistItems) {
      const chip = document.createElement('button');
      chip.type = 'button';
      const done = inspectionChecklistDone.has(item.label);
      chip.className = 'inspection-checklist-chip' + (done ? ' done' : '') + (currentZone === item.label ? ' active' : '');
      chip.textContent = (done ? '✓ ' : '') + item.label;
      chip.addEventListener('click', () => {
        inspectionZoneInput.value = item.label;
        inspectionZoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      inspectionChecklistRow.appendChild(chip);
    }
    show(inspectionChecklistRow);
  }
  let inspectionTimerInterval = null;
  let inspectionStartedAt = 0;
  let pendingImportFiles = [];
  let importOpenedFromInspection = false;
  let loggedInEmail = '';

  // ---------- Utils ----------
  function trackUrl(url) {
    objectUrls.push(url);
    return url;
  }

  function revokeAllUrls() {
    while (objectUrls.length) {
      URL.revokeObjectURL(objectUrls.pop());
    }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }
  window.appToast = toast;

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtTimer(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  // ---------- Haptic + shutter-sound feedback ----------
  function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported, ignore */ }
  }

  let audioCtx = null;
  function playClick(freq, duration) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* Web Audio unsupported, ignore */ }
  }

  function shutterFeedback() {
    haptic(18);
    playClick(1800, 0.05);
  }

  function recordStartFeedback() {
    haptic([12, 40, 12]);
    playClick(880, 0.07);
  }

  function recordStopFeedback() {
    haptic(18);
    playClick(440, 0.09);
  }

  // ---------- View routing ----------
  function showJobListView() {
    // Hides every view rather than a hardcoded list. The list version was the
    // same trap report.js fell into: the scheduler and invoice screens were
    // added later and never appeared here, so returning to the job list from
    // either of them left the old screen showing underneath.
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    show(viewJobList);
    currentJobId = null;
    renderJobList();
  }
  window.showJobListView = showJobListView;
  // Used by invoice-ui.js to return to the job it was opened from.
  window.showJobViewById = showJobView;
  // demo.js seeds jobs after load and needs the list redrawn.
  window.renderJobListPublic = () => renderJobList();
  // Every full-screen view, so a new one can be shown without each module
  // having to know the complete list.
  window.hideAllAppViews = function () {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  };

  // ---------- Auth / sync UI ----------
  function showLoginView() {
    hide(viewJobList);
    hide(viewJob);
    hide(syncBar);
    document.getElementById('view-report').classList.add('hidden');
    document.getElementById('view-report-section').classList.add('hidden');
    document.getElementById('view-archive').classList.add('hidden');
    show(viewLogin);
    loginPasswordInput.value = '';
    hide(loginErrorEl);
  }

  function showLoggedInUI(session) {
    loggedInEmail = session && session.user ? session.user.email : '';
    hide(viewLogin);
    show(syncBar);
    updateSyncBarText();
  }

  function showLoginError(msg) {
    loginErrorEl.textContent = msg;
    show(loginErrorEl);
  }

  function updateSyncBarText() {
    if (!syncBar) return;
    const status = window.Sync ? window.Sync.getStatus() : { state: 'idle' };
    let statusPart;
    if (!navigator.onLine) statusPart = 'Offline — saved locally';
    else if (status.state === 'syncing') statusPart = 'Syncing…';
    else if (status.state === 'synced' && status.lastSyncedAt) {
      statusPart = 'Synced ' + new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (status.state === 'error') statusPart = 'Sync error — will retry';
    else statusPart = 'Not synced yet';
    syncStatusText.textContent = (loggedInEmail ? 'Signed in as ' + loggedInEmail : '') + (statusPart ? ' · ' + statusPart : '');
  }

  loginBtn.addEventListener('click', async () => {
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    if (!email || !password) { showLoginError('Enter your email and password'); return; }
    hide(loginErrorEl);
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    try {
      await Sync.signIn(email, password);
      // Sync.onAuthChange listener (registered in initAuth) handles showing the app.
    } catch (err) {
      showLoginError(err.message || 'Could not sign in — check your email and password.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Log In';
    }
  });

  loginPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  logoutBtn.addEventListener('click', async () => {
    if (window.Sync) await Sync.signOut();
  });

  syncNowBtn.addEventListener('click', async () => {
    if (!window.Sync) return;
    await Sync.pullAll();
    await renderJobList();
    if (currentJobId) await renderGallery();
    toast('Sync complete');
  });

  window.addEventListener('online', updateSyncBarText);
  window.addEventListener('offline', updateSyncBarText);

  async function showJobView(jobId) {
    currentJobId = jobId;
    const job = await DB.getJob(jobId);
    if (!job) { showJobListView(); return; }
    jobTitleEl.textContent = job.name;
    jobSubtitleEl.textContent = job.address ? `${job.address} · ${fmtDate(job.createdAt)}` : fmtDate(job.createdAt);
    activeZoneFilter = null;
    selectMode = false;
    selectedCaptureIds.clear();
    gallerySelectToggle.textContent = 'Select';
    hide(selectionBar);
    hide(viewJobList);
    show(viewJob);
    renderInspectionControls(job);
    await renderGallery();
  }

  // Shows the rebooking prompt on a completed job once its property is due
  // (or nearly due) again — turning "this job is finished" into "this client
  // needs booking", which is the whole point of tracking a due date.
  function renderDueCallout(job) {
    const el = document.getElementById('due-callout');
    if (!el) return;
    const due = dueInfo(job);
    if (!due || due.level === 'later') { el.classList.add('hidden'); return; }
    document.getElementById('due-callout-title').textContent =
      due.level === 'overdue' ? `Re-inspection ${due.label.toLowerCase()}` : `Re-inspection ${due.label.toLowerCase()}`;
    document.getElementById('due-callout-sub').textContent =
      `${job.name}${job.address ? ' · ' + job.address : ''} was last done ${fmtDate(job.createdAt)}.`;
    el.classList.remove('hidden');
  }

  // Raises the follow-up job with the client's details carried across, links
  // it back to the job it came from, and clears the old due date so the same
  // property doesn't keep nagging once it's been booked.
  // Normalises a timestamp to 9am on the same local calendar day.
  function atNineAm(ts) {
    const d = new Date(ts);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }

  async function rebookJob(jobId) {
    const previous = await DB.getJob(jobId);
    if (!previous) return;
    const next = await DB.addJob({
      name: previous.name,
      address: previous.address,
      addressLat: previous.addressLat,
      addressLng: previous.addressLng,
      notes: previous.notes,
      clientPhone: previous.clientPhone,
      clientEmail: previous.clientEmail,
      jobType: previous.jobType,
      recurringFromId: previous.id,
      // Put it straight in the diary on the day it fell due, at 9am. The date
      // is a starting point the technician can drag around in the scheduler —
      // but a re-inspection that lands unscheduled is one that gets forgotten.
      scheduledAt: previous.nextDueAt ? atNineAm(previous.nextDueAt) : null,
    });
    await DB.updateJob(previous.id, { nextDueAt: null });
    toast('Next inspection booked for ' + next.name);
    await renderJobList();
    showJobView(next.id);
  }

  const rebookJobBtn = document.getElementById('rebook-job-btn');
  if (rebookJobBtn) rebookJobBtn.addEventListener('click', () => rebookJob(currentJobId));

  function renderInspectionControls(job) {
    renderDueCallout(job);
    jobStatusBadge.textContent = DB.JOB_STATUS_LABELS[job.status] || 'New';
    jobStatusBadge.className = 'status-badge status-' + (job.status || 'new');

    const isRecording = !!inspectionActiveJobId && inspectionActiveJobId === job.id;

    if (isRecording) {
      hide(startInspectionBtn);
      show(finishInspectionBtn);
      show(inspectionTimerEl);
      finishInspectionBtn.textContent = '✨ Generate Form';
    } else if (job.status === 'new') {
      show(startInspectionBtn);
      hide(finishInspectionBtn);
      hide(inspectionTimerEl);
    } else if (job.status === 'in_progress') {
      // Status says in_progress but this device/session has no live recorder
      // for it — e.g. the tab was backgrounded/reloaded and the in-memory
      // recording state was lost. Without this branch the job was a dead
      // end: no Start button (not "new"), no Finish button (isRecording is
      // false), nothing to tap at all. finishInspection() below handles the
      // no-recorder case by recovering gracefully instead of no-op'ing.
      hide(startInspectionBtn);
      show(finishInspectionBtn);
      hide(inspectionTimerEl);
      finishInspectionBtn.textContent = '⚠ Recover / Generate Form';
    } else {
      hide(startInspectionBtn);
      hide(finishInspectionBtn);
      hide(inspectionTimerEl);
    }

    if (job.status === 'review' || job.status === 'completed') {
      show(viewReportBtn);
      viewReportBtn.textContent = job.status === 'completed' ? '✓ View Finalized Report' : '📄 Open Report';
      renderDocumentTypePicker(job).catch((err) => console.warn('[job] document picker failed:', err.message || err));
    } else {
      hide(viewReportBtn);
      if (docTypeRow) docTypeRow.classList.add('hidden');
    }

    // Invoicing only makes sense once there's work to bill for, so it appears
    // at the same point the report does.
    if (viewInvoiceBtn) {
      const billable = job.status === 'review' || job.status === 'completed';
      viewInvoiceBtn.classList.toggle('hidden', !billable);
      if (billable) {
        DB.getInvoicesForJob(job.id).then((invoices) => {
          const invoice = invoices[0];
          viewInvoiceBtn.textContent = !invoice
            ? '💰 Create Invoice'
            : (invoice.xeroInvoiceId ? '💰 Invoice — in Xero' : '💰 Invoice — draft');
        }).catch(() => { viewInvoiceBtn.textContent = '💰 Invoice'; });
      }
    }
  }

  window.refreshJobViewStatus = async function (jobId) {
    if (jobId !== currentJobId) return;
    const job = await DB.getJob(jobId);
    if (job) renderInspectionControls(job);
  };

  // ---------- Job list ----------
  async function renderJobList() {
    const jobs = await DB.getJobs();
    jobsCache = await Promise.all(jobs.map(async (job) => ({ job, count: await DB.getCaptureCount(job.id) })));
    applyJobListFilters();
  }

  // "Due" isn't a job status — it's a completed job whose property has come
  // back around for its next inspection. Treated as a filter rather than a
  // status so a job's own lifecycle stays new -> in_progress -> review ->
  // completed and doesn't need a fifth state that means something different.
  const DUE_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  function dueInfo(job) {
    if (!job.nextDueAt) return null;
    const days = Math.round((job.nextDueAt - Date.now()) / (24 * 60 * 60 * 1000));
    if (days < 0) return { level: 'overdue', label: `Overdue ${Math.abs(days)}d`, days };
    if (days === 0) return { level: 'overdue', label: 'Due today', days };
    if (job.nextDueAt - Date.now() <= DUE_SOON_WINDOW_MS) return { level: 'soon', label: `Due in ${days}d`, days };
    return { level: 'later', label: `Due ${fmtDate(job.nextDueAt)}`, days };
  }

  function applyJobListFilters() {
    const q = jobSearchQuery.trim().toLowerCase();
    let filtered = jobsCache.filter(({ job }) => {
      if (jobStatusFilter === 'due') {
        const info = dueInfo(job);
        if (!info || info.level === 'later') return false;
      } else if (jobStatusFilter !== 'all' && (job.status || 'new') !== jobStatusFilter) {
        return false;
      }
      if (!q) return true;
      return job.name.toLowerCase().includes(q) || (job.address || '').toLowerCase().includes(q);
    });
    // Most overdue first — the list should answer "what am I behind on?".
    if (jobStatusFilter === 'due') {
      filtered = filtered.slice().sort((a, b) => (a.job.nextDueAt || 0) - (b.job.nextDueAt || 0));
    }

    jobListEl.innerHTML = '';
    if (jobsCache.length === 0) {
      jobEmptyEl.textContent = 'No jobs yet. Tap "+ New Job" to start your first inspection.';
      show(jobEmptyEl);
    } else if (filtered.length === 0) {
      jobEmptyEl.textContent = 'No jobs match your search or filter.';
      show(jobEmptyEl);
    } else {
      hide(jobEmptyEl);
    }

    for (const { job, count } of filtered) {
      const li = document.createElement('li');
      li.className = 'job-item';
      li.innerHTML = `
        <span class="job-item-top">
          <span class="job-item-name"></span>
          <span class="status-badge status-${job.status || 'new'} small"></span>
        </span>
        <span class="job-item-meta">
          <span class="job-item-type"></span>
          <span>·</span>
          <span class="job-item-date"></span>
          <span>·</span>
          <span>${count} capture${count === 1 ? '' : 's'}</span>
        </span>
      `;
      li.querySelector('.job-item-name').textContent = job.name;
      li.querySelector('.status-badge').textContent = DB.JOB_STATUS_LABELS[job.status] || 'New';
      li.querySelector('.job-item-type').textContent = job.jobType === 'pest_treatment' ? '🧪 Pest Treatment' : '🐜 Termite';
      li.querySelector('.job-item-date').textContent = job.address ? `${job.address} · ${fmtDate(job.createdAt)}` : fmtDate(job.createdAt);

      // A booking is more actionable than a due date, so it wins the badge
      // slot while the job is still outstanding. Once the job is finished the
      // booking is just history: the technician turned up and did the work, so
      // a past appointment must never be labelled "Missed", and the useful
      // thing to surface instead is when the property is next due.
      const finished = job.status === 'completed';
      const due = dueInfo(job);

      if (job.scheduledAt && !(finished && due)) {
        const when = new Date(job.scheduledAt);
        const days = Math.round((when - Date.now()) / 86400000);
        const late = days < 0 && !finished;
        const badge = document.createElement('span');
        badge.className = 'due-badge ' + (late ? 'due-overdue' : days < 0 ? 'due-later' : days <= 7 ? 'due-soon' : 'due-later');
        const h = when.getHours();
        const time = `${h % 12 === 0 ? 12 : h % 12}${when.getMinutes() ? ':' + String(when.getMinutes()).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
        badge.textContent = days === 0 ? `Today ${time}`
          : days === 1 ? `Tomorrow ${time}`
          : late ? `Missed ${fmtDate(job.scheduledAt)}`
          : days < 0 ? fmtDate(job.scheduledAt)
          : `${fmtDate(job.scheduledAt)} ${time}`;
        li.querySelector('.job-item-top').appendChild(badge);
      }

      if (due && (finished || !job.scheduledAt)) {
        const badge = document.createElement('span');
        badge.className = `due-badge due-${due.level}`;
        badge.textContent = due.label;
        li.querySelector('.job-item-top').appendChild(badge);
      }
      li.addEventListener('click', () => showJobView(job.id));
      jobListEl.appendChild(li);
    }
  }

  jobSearchInput.addEventListener('input', () => {
    jobSearchQuery = jobSearchInput.value;
    applyJobListFilters();
  });

  jobStatusFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.status-filter-chip');
    if (!btn) return;
    jobStatusFilter = btn.dataset.status;
    jobStatusFilters.querySelectorAll('.status-filter-chip').forEach((el) => el.classList.toggle('active', el === btn));
    applyJobListFilters();
  });

  openArchiveBtn.addEventListener('click', () => ReportUI.openArchive());

  const openSchedulerBtn = document.getElementById('open-scheduler-btn');
  if (openSchedulerBtn) {
    openSchedulerBtn.addEventListener('click', () => {
      if (window.Scheduler) window.Scheduler.open();
      else toast('Scheduler is still loading — try again in a moment.');
    });
  }

  newJobBtn.addEventListener('click', () => {
    jobNameInput.value = '';
    jobAddressInput.value = '';
    jobPhoneInput.value = '';
    jobEmailInput.value = '';
    jobNotesInput.value = '';
    const schedDate = document.getElementById('job-scheduled-date');
    const schedTime = document.getElementById('job-scheduled-time');
    if (schedDate) schedDate.value = '';
    if (schedTime) schedTime.value = '09:00';
    selectedAddressCoords = null;
    selectedJobType = 'termite';
    if (jobTypePicker) {
      jobTypePicker.querySelectorAll('.job-type-chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.jobType === 'termite');
      });
    }
    hideAddressSuggestions();
    show(jobForm);
    jobNameInput.focus();
  });

  jobFormCancel.addEventListener('click', () => { hide(jobForm); hideAddressSuggestions(); });

  jobFormSave.addEventListener('click', async () => {
    const name = jobNameInput.value.trim();
    if (!name) { toast('Enter a job name'); jobNameInput.focus(); return; }
    const job = await DB.addJob({
      name,
      jobType: selectedJobType,
      address: jobAddressInput.value.trim(),
      addressLat: selectedAddressCoords ? selectedAddressCoords.lat : null,
      addressLng: selectedAddressCoords ? selectedAddressCoords.lng : null,
      notes: jobNotesInput.value.trim(),
      clientPhone: jobPhoneInput.value.trim(),
      clientEmail: jobEmailInput.value.trim(),
      scheduledAt: readScheduledAtFromForm(),
    });
    hide(jobForm);
    await renderJobList();
    showJobView(job.id);
  });

  // Combines the two form inputs into an epoch ms. Built from local calendar
  // parts rather than Date.parse on a string, so the booking lands at the
  // time the technician typed regardless of timezone.
  function readScheduledAtFromForm() {
    const dateEl = document.getElementById('job-scheduled-date');
    const timeEl = document.getElementById('job-scheduled-time');
    if (!dateEl || !dateEl.value) return null;
    const [y, m, d] = dateEl.value.split('-').map(Number);
    const [hh, mm] = ((timeEl && timeEl.value) || '09:00').split(':').map(Number);
    const when = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
    return Number.isFinite(when.getTime()) ? when.getTime() : null;
  }

  // ---------- Address autocomplete (AU/NZ, via OpenStreetMap Nominatim) ----------
  // Free, no API key required. Nominatim's usage policy caps public-server
  // traffic at ~1 request/sec, so this debounces keystrokes and aborts any
  // in-flight lookup before firing the next one.
  let addressDebounceTimer = null;
  let addressAbortController = null;
  let addressSuggestionItems = [];
  let addressActiveIndex = -1;
  // Coordinates of the currently-selected suggestion, if any — captured here
  // (rather than re-geocoding later) so the aerial mud-map backdrop doesn't
  // need a second network round-trip. Cleared whenever the address text is
  // edited without picking a fresh suggestion, since it'd no longer be trustworthy.
  let selectedAddressCoords = null;

  // Which job type the New Job form will create — 'termite' (AS 3660.2
  // inspection) or 'pest_treatment' (general pest treatment / chemical
  // application). Defaults to termite (matches the chip marked "active" in
  // the HTML) and resets to that default each time the form is opened.
  let selectedJobType = 'termite';
  if (jobTypePicker) {
    jobTypePicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.job-type-chip');
      if (!btn) return;
      selectedJobType = btn.dataset.jobType;
      jobTypePicker.querySelectorAll('.job-type-chip').forEach((chip) => {
        chip.classList.toggle('active', chip === btn);
      });
    });
  }

  function hideAddressSuggestions() {
    hide(jobAddressSuggestions);
    jobAddressSuggestions.innerHTML = '';
    addressSuggestionItems = [];
    addressActiveIndex = -1;
  }

  function renderAddressSuggestions(items) {
    addressSuggestionItems = items;
    addressActiveIndex = -1;
    jobAddressSuggestions.innerHTML = '';

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'address-suggestion-empty';
      li.textContent = 'No matches found';
      jobAddressSuggestions.appendChild(li);
      show(jobAddressSuggestions);
      return;
    }

    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'address-suggestion-item';
      li.textContent = item.display_name;
      li.addEventListener('mousedown', (e) => {
        // mousedown (not click) so this fires before the input's blur handler
        e.preventDefault();
        jobAddressInput.value = item.display_name;
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        selectedAddressCoords = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
        hideAddressSuggestions();
      });
      jobAddressSuggestions.appendChild(li);
    });
    show(jobAddressSuggestions);
  }

  async function searchAddress(query) {
    if (addressAbortController) addressAbortController.abort();
    addressAbortController = new AbortController();
    try {
      // Nominatim first, with a fallback to NSW's own property register for
      // addresses whose house number OSM doesn't have — see
      // Geo.searchAddressCandidates in geo.js for why.
      const results = window.Geo
        ? await window.Geo.searchAddressCandidates(query, { signal: addressAbortController.signal })
        : await fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&countrycodes=au,nz&limit=6&q=' + encodeURIComponent(query),
            { signal: addressAbortController.signal, headers: { Accept: 'application/json' } }).then((r) => r.json());
      renderAddressSuggestions(results);
    } catch (err) {
      if (err.name !== 'AbortError') hideAddressSuggestions();
    }
  }

  jobAddressInput.addEventListener('input', () => {
    selectedAddressCoords = null;
    const query = jobAddressInput.value.trim();
    clearTimeout(addressDebounceTimer);
    if (query.length < 4) { hideAddressSuggestions(); return; }
    addressDebounceTimer = setTimeout(() => searchAddress(query), 450);
  });

  jobAddressInput.addEventListener('keydown', (e) => {
    if (jobAddressSuggestions.classList.contains('hidden') || !addressSuggestionItems.length) return;
    const items = jobAddressSuggestions.querySelectorAll('.address-suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      addressActiveIndex = Math.min(addressActiveIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      addressActiveIndex = Math.max(addressActiveIndex - 1, 0);
    } else if (e.key === 'Enter' && addressActiveIndex >= 0) {
      e.preventDefault();
      const chosen = addressSuggestionItems[addressActiveIndex];
      jobAddressInput.value = chosen.display_name;
      const lat = parseFloat(chosen.lat);
      const lng = parseFloat(chosen.lon);
      selectedAddressCoords = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
      hideAddressSuggestions();
      return;
    } else if (e.key === 'Escape') {
      hideAddressSuggestions();
      return;
    } else {
      return;
    }
    items.forEach((el, i) => el.classList.toggle('active', i === addressActiveIndex));
  });

  jobAddressInput.addEventListener('blur', () => {
    // slight delay so a suggestion's mousedown can still register first
    setTimeout(hideAddressSuggestions, 150);
  });

  backBtn.addEventListener('click', showJobListView);

  deleteJobBtn.addEventListener('click', async () => {
    if (!currentJobId) return;
    if (!confirm('Delete this job and all its photos and voice memos? This cannot be undone.')) return;
    await DB.deleteJob(currentJobId);
    toast('Job deleted');
    showJobListView();
  });

  // ---------- Gallery / captures ----------
  async function renderGallery() {
    currentCaptures = await DB.getCaptures(currentJobId);
    revokeAllUrls();
    renderZoneChips();
    renderGalleryTiles();
    populateZoneSuggestions();
  }

  function computeZoneCounts() {
    const counts = new Map();
    for (const c of currentCaptures) {
      const z = c.zone || 'Untagged';
      counts.set(z, (counts.get(z) || 0) + 1);
    }
    return counts;
  }

  function renderZoneChips() {
    const counts = computeZoneCounts();
    const zones = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));
    zoneChipRow.innerHTML = '';

    if (zones.length < 2) { hide(zoneChipRow); return; }

    const allChip = document.createElement('button');
    allChip.className = 'zone-chip' + (activeZoneFilter === null ? ' active' : '');
    allChip.innerHTML = `<span>All</span><span class="zone-chip-count">${currentCaptures.length}</span>`;
    allChip.addEventListener('click', () => {
      activeZoneFilter = null;
      renderZoneChips();
      renderGalleryTiles();
    });
    zoneChipRow.appendChild(allChip);

    for (const zone of zones) {
      const chip = document.createElement('button');
      chip.className = 'zone-chip' + (activeZoneFilter === zone ? ' active' : '');
      chip.innerHTML = `<span>${escapeHtml(zone)}</span><span class="zone-chip-count">${counts.get(zone)}</span>`;
      chip.addEventListener('click', () => {
        activeZoneFilter = activeZoneFilter === zone ? null : zone;
        renderZoneChips();
        renderGalleryTiles();
      });
      zoneChipRow.appendChild(chip);
    }
    show(zoneChipRow);
  }

  function getVisibleCaptures() {
    return activeZoneFilter === null
      ? currentCaptures
      : currentCaptures.filter((c) => (c.zone || 'Untagged') === activeZoneFilter);
  }

  function renderGalleryTiles() {
    galleryEl.innerHTML = '';
    const visible = getVisibleCaptures();

    if (currentCaptures.length === 0) {
      galleryEmptyEl.textContent = 'No captures yet for this job. Use the buttons below to take a photo or record a zone note.';
      show(galleryEmptyEl);
    } else if (visible.length === 0) {
      galleryEmptyEl.textContent = 'No captures in this zone yet.';
      show(galleryEmptyEl);
    } else {
      hide(galleryEmptyEl);
    }

    galleryCountEl.textContent = currentCaptures.length
      ? `${visible.length === currentCaptures.length ? currentCaptures.length : visible.length + ' of ' + currentCaptures.length} capture${currentCaptures.length === 1 ? '' : 's'} · saved on this device`
      : '';

    if (currentCaptures.length > 0) show(gallerySelectToggle);
    else { hide(gallerySelectToggle); if (selectMode) exitSelectMode(); }

    for (const capture of visible) {
      const tile = document.createElement('div');
      tile.className = 'capture-tile'
        + (capture.type === 'memo' ? ' memo-only' : '')
        + (selectMode ? ' selectable' : '')
        + (selectedCaptureIds.has(capture.id) ? ' selected' : '');
      tile.dataset.id = capture.id;

      const mark = document.createElement('span');
      mark.className = 'capture-tile-select-mark';
      mark.textContent = '✓';
      tile.appendChild(mark);

      if (capture.photoBlob) {
        const url = trackUrl(URL.createObjectURL(capture.photoBlob));
        const img = document.createElement('img');
        img.src = url;
        img.alt = capture.zone || 'Photo';
        tile.appendChild(img);
        if (capture.audioBlob) {
          const badge = document.createElement('span');
          badge.className = 'capture-tile-audio-badge';
          badge.textContent = '🎙️';
          tile.appendChild(badge);
        }
      } else {
        const icon = document.createElement('span');
        icon.className = 'capture-tile-icon';
        icon.textContent = '🎙️';
        tile.appendChild(icon);
      }

      if (!capture.zone && capture.suggestedZone) {
        const suggestBadge = document.createElement('span');
        suggestBadge.className = 'capture-tile-suggest-badge';
        suggestBadge.textContent = '✨';
        suggestBadge.title = `AI suggests: ${capture.suggestedZone}`;
        tile.appendChild(suggestBadge);
      }

      const zoneLabel = document.createElement('span');
      zoneLabel.className = 'capture-tile-zone';
      zoneLabel.textContent = capture.zone || (capture.suggestedZone ? `Untagged — ✨ ${capture.suggestedZone}?` : 'Untagged');
      tile.appendChild(zoneLabel);

      tile.addEventListener('click', () => {
        if (selectMode) toggleCaptureSelection(capture.id, tile);
        else openDetail(capture.id);
      });

      let pressTimer = null;
      tile.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          enterSelectMode();
          toggleCaptureSelection(capture.id, galleryEl.querySelector(`[data-id="${capture.id}"]`));
          haptic(20);
        }, 500);
      }, { passive: true });
      tile.addEventListener('touchend', () => clearTimeout(pressTimer));
      tile.addEventListener('touchmove', () => clearTimeout(pressTimer));

      galleryEl.appendChild(tile);
    }
  }

  // ---------- Gallery multi-select + bulk actions ----------
  function enterSelectMode() {
    if (selectMode) return;
    selectMode = true;
    gallerySelectToggle.textContent = 'Cancel';
    show(selectionBar);
    renderGalleryTiles();
  }

  function exitSelectMode() {
    selectMode = false;
    selectedCaptureIds.clear();
    gallerySelectToggle.textContent = 'Select';
    hide(selectionBar);
    updateSelectionCount();
    renderGalleryTiles();
  }

  function toggleCaptureSelection(id, tileEl) {
    if (selectedCaptureIds.has(id)) {
      selectedCaptureIds.delete(id);
      if (tileEl) tileEl.classList.remove('selected');
    } else {
      selectedCaptureIds.add(id);
      if (tileEl) tileEl.classList.add('selected');
    }
    updateSelectionCount();
  }

  function updateSelectionCount() {
    selectionCountEl.textContent = `${selectedCaptureIds.size} selected`;
    selectionZoneBtn.disabled = selectedCaptureIds.size === 0;
    selectionDeleteBtn.disabled = selectedCaptureIds.size === 0;
  }

  gallerySelectToggle.addEventListener('click', () => {
    if (selectMode) exitSelectMode(); else enterSelectMode();
  });

  selectionCancelBtn.addEventListener('click', exitSelectMode);

  selectionZoneBtn.addEventListener('click', () => {
    if (!selectedCaptureIds.size) return;
    bulkZoneHint.textContent = `Set the zone for ${selectedCaptureIds.size} selected capture${selectedCaptureIds.size === 1 ? '' : 's'}.`;
    bulkZoneInput.value = '';
    show(bulkZoneModal);
    bulkZoneInput.focus();
  });

  bulkZoneCancel.addEventListener('click', () => hide(bulkZoneModal));

  bulkZoneSave.addEventListener('click', async () => {
    const zone = bulkZoneInput.value.trim();
    const count = selectedCaptureIds.size;
    for (const id of selectedCaptureIds) {
      await DB.updateCapture(id, { zone });
    }
    hide(bulkZoneModal);
    toast(`Zone updated for ${count} capture${count === 1 ? '' : 's'}`);
    exitSelectMode();
    await renderGallery();
  });

  selectionDeleteBtn.addEventListener('click', async () => {
    const n = selectedCaptureIds.size;
    if (!n) return;
    if (!confirm(`Delete ${n} selected capture${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    for (const id of selectedCaptureIds) {
      await DB.deleteCapture(id);
    }
    toast(`${n} capture${n === 1 ? '' : 's'} deleted`);
    exitSelectMode();
    await renderGallery();
  });

  function populateZoneSuggestions() {
    const zones = Array.from(new Set(currentCaptures.map((c) => c.zone).filter(Boolean))).sort();
    zoneSuggestions.innerHTML = zones.map((z) => `<option value="${escapeHtml(z)}"></option>`).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Voice recording ----------
  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }
  window.pickAudioMimeType = pickMimeType; // shared with report.js's voice-guided room subdivision

  async function startRecording(target) {
    recordingTarget = target;
    recordTargetLabel.textContent = target.mode === 'attach'
      ? 'Attaching voice note to photo'
      : 'Zone note: Untagged'; // zoneInput was removed; the standalone zone-memo entry point is currently unreachable anyway
    recordTimerEl.textContent = '0:00';
    show(recordModal);

    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      hide(recordModal);
      toast('Microphone access denied');
      return;
    }

    recordedChunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);

    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', onRecordingStopped);

    mediaRecorder.start();
    recordingStartedAt = Date.now();
    recordStartFeedback();
    recordingTimerInterval = setInterval(() => {
      recordTimerEl.textContent = fmtTimer(Date.now() - recordingStartedAt);
    }, 250);
  }

  function stopRecordingStream() {
    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }
    clearInterval(recordingTimerInterval);
  }

  async function onRecordingStopped() {
    stopRecordingStream();
    recordStopFeedback();
    hide(recordModal);

    if (!recordedChunks.length) {
      toast('No audio recorded');
      recordingTarget = null;
      return;
    }

    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    recordedChunks = [];

    if (recordingTarget && recordingTarget.mode === 'attach') {
      await DB.updateCapture(recordingTarget.captureId, { audioBlob: blob });
      toast('Voice note attached');
      if (!detailModal.classList.contains('hidden') && currentDetailCaptureId === recordingTarget.captureId) {
        await openDetail(recordingTarget.captureId);
      }
    } else {
      await DB.addCapture({
        jobId: currentJobId,
        zone: '', // zoneInput was removed; the standalone zone-memo entry point is currently unreachable anyway
        type: 'memo',
        audioBlob: blob,
      });
      toast('Zone note saved');
    }

    recordingTarget = null;
    await renderGallery();
  }

  function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.removeEventListener('stop', onRecordingStopped);
      mediaRecorder.addEventListener('stop', () => { stopRecordingStream(); });
      mediaRecorder.stop();
    } else {
      stopRecordingStream();
    }
    recordedChunks = [];
    recordingTarget = null;
    hide(recordModal);
  }

  recordStopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  });

  recordCancelBtn.addEventListener('click', cancelRecording);

  // The standalone "Zone Note" button (bottom action bar) was removed;
  // startRecording({mode:'attach'}) below is still used by the capture
  // detail modal's "Attach Voice Note" flow, so that stays intact.

  // ---------- Start / Finish Inspection (continuous video+audio, live preview) ----------
  // Mirrors the defensive treatment finishInspection already has. Every exit
  // path below must either start a recording or say plainly why it couldn't —
  // a tap that produces no recording AND no message is indistinguishable from
  // a dead button, which is exactly how this was reported from the field.
  let startInspectionInProgress = false;
  // Set while a camera request is outstanding so a second tap can abandon it.
  // Waiting on a permission sheet can legitimately take a while, and a button
  // that is merely disabled for that whole time reads as broken — the way out
  // has to stay in the technician's hands.
  let abandonPendingStart = null;

  // ---------- The first shot of the job ----------
  // Starting a job opens straight onto one instruction: photograph the front
  // of the property. Previously it opened a live camera with a timer running,
  // which read as "you are now recording" and left the technician to work out
  // what to do with it.
  //
  // That first photograph earns its place twice over. It is the report cover —
  // the difference between a document that opens on a picture of the client's
  // house and one that opens on an empty band. And it is the best single
  // input the draft gets: a front elevation shows wall construction, roof
  // type, storeys and the general condition of the place, which is most of
  // the property section answered before anyone has walked around the back.
  let frontPhotoPending = false;

  function showFrontPhotoPrompt(on) {
    if (!inspectionPrompt) return;
    frontPhotoPending = on;
    inspectionPrompt.classList.toggle('hidden', !on);
    if (inspectionZoneInput) inspectionZoneInput.classList.toggle('hidden', on);
    if (inspectionStillBtn) {
      inspectionStillBtn.classList.toggle('prompting', on);
      inspectionStillBtn.setAttribute('aria-label', on ? 'Take the front-of-property photo' : 'Take photo');
    }
  }

  // Reads what it can off the front elevation and offers it as a draft. Never
  // written straight into the report — same rule as every other AI suggestion
  // here: it appears when the technician opens the section, marked as a
  // suggestion, and they confirm or change it.
  async function draftPropertyFromFrontPhoto(jobId, blob) {
    if (!(window.AI && window.AI.analyzeSectionPhotos && window.ReportUI)) return;
    try {
      const job = await DB.getJob(jobId);
      const sectionId = (job && job.jobType === 'pest_treatment') ? 'clientDetails' : 'property';
      const result = await window.AI.analyzeSectionPhotos([blob], sectionId, job && job.jobType);
      await window.ReportUI.applyAiDraft(jobId, result);
      toast('Front photo read — suggested property details are waiting in the report.');
    } catch (err) {
      // Worth saying out loud: silently doing nothing here is exactly what
      // made the old AI draft feel like it did nothing at all.
      console.warn('[inspection] could not draft from the front photo:', err.message || err);
      toast('Photo saved, but reading it for property details failed.');
    }
  }

  async function startInspection() {
    if (startInspectionInProgress) return;
    startInspectionInProgress = true;

    const originalLabel = '▶ Start Inspection';
    // Deliberately NOT disabled: the button becomes the cancel.
    startInspectionBtn.textContent = '⏳ Starting camera… (tap to cancel)';
    const resetButton = () => {
      startInspectionInProgress = false;
      abandonPendingStart = null;
      startInspectionBtn.disabled = false;
      startInspectionBtn.textContent = originalLabel;
    };
    // Releases the camera/mic if we acquired them but then bailed — otherwise
    // the indicator light stays on and the device stays locked to this tab.
    const releaseStream = () => {
      if (!inspectionStream) return;
      inspectionStream.getTracks().forEach((t) => t.stop());
      inspectionStream = null;
    };

    try {
      // getUserMedia does NOT always settle: if the OS permission sheet is
      // dismissed by a swipe rather than answered, the promise hangs forever
      // with nothing to catch. So it is raced against a timeout — but the
      // timeout has to know whether a human is being asked something.
      //
      // A fixed 15s here was itself a bug: a first-time user gets a permission
      // sheet, and anyone who reads it before tapping Allow blew through the
      // deadline and was told the camera had failed when it was about to work.
      // So: if permission is already granted the camera should appear quickly
      // and a short deadline is right; if we are still waiting on a person,
      // give them a genuinely human amount of time.
      // Browsers only expose the camera in a secure context: https, or
      // localhost. Served over plain http from a LAN address — which is
      // exactly how someone tests a build on their phone before deploying —
      // navigator.mediaDevices is undefined, and reaching straight for
      // getUserMedia below throws "Cannot read properties of undefined",
      // which tells the technician nothing about the real problem.
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        releaseStream();
        toast(window.isSecureContext
          ? 'This browser does not support camera capture.'
          : 'The camera needs a secure connection (https). Open the app on its https address rather than an IP address.');
        resetButton();
        return;
      }

      let permission = 'unknown';
      try {
        if (navigator.permissions && navigator.permissions.query) {
          permission = (await navigator.permissions.query({ name: 'camera' })).state;
        }
      } catch (e) { /* Safari/Firefox may not expose 'camera' — fall through */ }

      if (permission === 'denied') {
        releaseStream();
        toast('Camera access is blocked for this site. Allow it in your browser settings, then try again.');
        resetButton();
        return;
      }

      const deadlineMs = permission === 'granted' ? 20000 : 120000;
      let gaveUp = false;
      // Lets a second tap on the button abandon the wait immediately.
      abandonPendingStart = () => { gaveUp = true; };
      const request = navigator.mediaDevices.getUserMedia({
        // Photographs are the evidence now, so the preview is requested at the
        // highest sensible resolution rather than the 720p that suited
        // continuous recording — the still button captures whatever the
        // preview is running at. Nothing streams to disk any more, so the old
        // bandwidth and storage argument for capping it no longer applies.
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        // No microphone. Photo capture has no use for it, and not asking is
        // both one less permission prompt and one less thing recorded inside
        // a client's home.
        audio: false,
      });
      // If the camera turns up after we stopped waiting, nobody else holds a
      // reference to it — release it or the indicator light stays on.
      request.then((late) => { if (gaveUp) late.getTracks().forEach((t) => t.stop()); }).catch(() => {});

      inspectionStream = await Promise.race([
        request,
        new Promise((_, reject) => setTimeout(() => {
          gaveUp = true;
          reject(new Error('__timeout__'));
        }, deadlineMs)),
        // Resolves only if the technician taps the button again to back out.
        new Promise((_, reject) => {
          const poll = setInterval(() => {
            if (gaveUp) { clearInterval(poll); reject(new Error('__cancelled__')); }
          }, 150);
          setTimeout(() => clearInterval(poll), deadlineMs + 1000);
        }),
      ]);
    } catch (err) {
      releaseStream();
      if (err && err.message === '__cancelled__') {
        // Their own choice — no error language for it.
        resetButton();
        return;
      }
      if (err && err.message === '__timeout__') {
        toast('The camera never responded. Check this site has camera and microphone permission, then try again.');
      } else if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        toast('Camera/microphone access was blocked. Allow it for this site in your browser settings, then try again.');
      } else if (err && err.name === 'NotFoundError') {
        toast('No camera or microphone was found on this device.');
      } else {
        toast('Could not start the camera: ' + ((err && err.message) || err));
      }
      resetButton();
      return;
    }

    // An inspection is a series of deliberate photographs, not a continuous
    // recording. Video was capturing 20 minutes of mostly floor and ceiling to
    // find the handful of frames that mattered, and the report only ever cited
    // stills anyway. Photographing each subject means every image is one the
    // technician chose, tagged with the zone they were standing in — which is
    // both better evidence and a far better input for the draft, because the
    // model is reading considered photographs instead of motion-blurred frames.
    //
    // No MediaRecorder is created here any more. Import Footage still exists
    // for jobs where video genuinely helps, and older jobs keep playing theirs.
    try {
      inspectionVideo.srcObject = inspectionStream;
      inspectionZoneInput.value = '';
      inspectionZonePill.textContent = 'Untagged';
      show(inspectionModal);
      inspectionActiveJobId = currentJobId;
      // Open on the one instruction that matters, not on an idle camera.
      // Skipped if this job already has its front shot — a second visit
      // should not ask for the cover photo again.
      const already = await DB.getCaptures(currentJobId);
      showFrontPhotoPrompt(!already.some((c) => c.isFrontElevation));

      inspectionChecklistDone = new Set(already.filter((c) => c.zone).map((c) => c.zone));
      const jobForChecklist = await DB.getJob(currentJobId);
      const jobCategoryForChecklist = window.ReportUI && window.ReportUI.getJobCategory
        ? await window.ReportUI.getJobCategory(currentJobId).catch(() => null)
        : null;
      inspectionChecklistItems = (window.PhotoChecklists ? window.PhotoChecklists.forJob(jobForChecklist, jobCategoryForChecklist) : [])
        .filter((item) => item.id !== 'frontElevation');
      renderInspectionChecklist();
    } catch (err) {
      console.error('[inspection] camera preview failed to start:', err);
      inspectionVideo.srcObject = null;
      hide(inspectionModal);
      releaseStream();
      toast('Could not open the camera preview: ' + ((err && err.message) || err));
      resetButton();
      return;
    }

    // The camera is open. renderInspectionControls hides this button below,
    // but the same element is reused for the next job, so its label has to
    // go back.
    resetButton();
    inspectionStartedAt = Date.now();
    inspectionTimerInterval = setInterval(() => {
      inspectionTimerEl.textContent = fmtTimer(Date.now() - inspectionStartedAt);
    }, 500);

    const jobIdForStart = currentJobId;
    await DB.updateJob(jobIdForStart, { status: 'in_progress', inspectionStartedAt });
    const job = await DB.getJob(jobIdForStart);
    renderInspectionControls(job);
    toast('Photograph each area, tagging the zone as you go — tap Generate Form when you\'re done.');

    // Both are best-effort, fire-and-forget: neither should delay the
    // camera preview opening, and both only fill an empty field (never
    // overwrite something the technician already entered).
    if (window.ReportUI) {
      const hhmm = new Date(inspectionStartedAt).toTimeString().slice(0, 5);
      window.ReportUI.prefillFieldValue(jobIdForStart, 'clientDetails', 'inspectionTime', hhmm)
        .catch((err) => console.warn('[inspection] could not prefill inspection time:', err.message || err));
    }
    if (window.Geo && typeof job.addressLat === 'number' && typeof job.addressLng === 'number') {
      window.Geo.fetchCurrentWeather(job.addressLat, job.addressLng)
        .then((weather) => weather && window.ReportUI && window.ReportUI.prefillFieldValue(jobIdForStart, 'clientDetails', 'weather', weather))
        .catch((err) => console.warn('[inspection] could not prefill weather:', err.message || err));
    }
  }

  inspectionZoneInput.addEventListener('input', () => {
    inspectionZonePill.textContent = inspectionZoneInput.value.trim() || 'Untagged';
    renderInspectionChecklist();
  });

  inspectionStillBtn.addEventListener('click', async () => {
    if (!inspectionStream || !inspectionVideo.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = inspectionVideo.videoWidth;
    canvas.height = inspectionVideo.videoHeight;
    canvas.getContext('2d').drawImage(inspectionVideo, 0, 0, canvas.width, canvas.height);
    const jobIdAtCapture = currentJobId;
    // Claim the front-photo slot synchronously. Everything below is async,
    // and a technician who taps twice in quick succession was otherwise
    // filing their second shot as a second 'front elevation' too.
    const isFront = frontPhotoPending;
    if (isFront) showFrontPhotoPrompt(false);
    // Read the zone now too, for the same reason: by the time the encode
    // finishes the technician has often already typed the next room in.
    const zoneAtCapture = isFront ? 'Front Elevation' : inspectionZoneInput.value.trim();
    canvas.toBlob(async (blob) => {
      if (!blob) { toast('Capture failed, try again'); return; }
      const capture = await DB.addCapture({
        jobId: jobIdAtCapture,
        zone: zoneAtCapture,
        type: 'photo',
        photoBlob: blob,
      });

      if (!isFront) {
        if (zoneAtCapture && inspectionChecklistItems.some((item) => item.label === zoneAtCapture)) {
          inspectionChecklistDone.add(zoneAtCapture);
          renderInspectionChecklist();
        }
        toast('Photo saved');
        return;
      }

      // Mark it so a later visit doesn't ask for the cover shot again, and
      // put it straight into the report's cover field rather than making the
      // technician find it in the gallery and attach it by hand.
      await DB.updateCapture(capture.id, { isFrontElevation: true });
      if (window.ReportUI && window.ReportUI.attachCoverPhoto) {
        await window.ReportUI.attachCoverPhoto(jobIdAtCapture, blob)
          .catch((err) => console.warn('[inspection] could not set the cover photo:', err.message || err));
      }
      toast('Front photo saved — now work through the property.');
      // Reading it is best-effort and must not hold up the walkthrough.
      draftPropertyFromFrontPhoto(jobIdAtCapture, blob);
    }, 'image/jpeg', 0.88);
  });

  inspectionImportBtn.addEventListener('click', () => {
    importOpenedFromInspection = true;
    hide(inspectionModal);
    openImportModal();
  });


  let finishInspectionInProgress = false;

  async function finishInspection() {
    // Guard against double-taps and make sure a tap is NEVER silently
    // swallowed — "I tapped Finish and nothing happened" is what this
    // function's whole shape exists to prevent.
    if (finishInspectionInProgress) return;
    finishInspectionInProgress = true;
    finishInspectionBtn.disabled = true;
    inspectionFinishBtn.disabled = true;
    const jobIdAtStart = currentJobId;

    // Outer safety net covering the whole function: if anything below hangs,
    // put the button back into a usable state and say plainly what it was
    // doing, rather than leaving it stuck disabled. Photo sessions finish far
    // faster than the old video ones — there is no multi-hundred-megabyte
    // write any more — but a slow device writing a dozen full-resolution
    // photographs still deserves headroom.
    let watchdogFired = false;
    let finishStage = 'closing the camera';
    const setStage = (s) => { finishStage = s; };

    const progressTimer = setInterval(() => {
      if (!watchdogFired) toast('Generating your form — ' + finishStage + '…');
    }, 4000);

    const watchdog = setTimeout(() => {
      watchdogFired = true;
      console.warn('[inspection] finishInspection watchdog fired after 45s while ' + finishStage);
      toast('Still stuck while ' + finishStage + '. Your photos are saved on this device — reopen the job and try Generate Form again.');
      finishInspectionInProgress = false;
      finishInspectionBtn.disabled = false;
      inspectionFinishBtn.disabled = false;
    }, 45000);

    try {
      clearInterval(inspectionTimerInterval);
      if (inspectionStream) {
        inspectionStream.getTracks().forEach((t) => t.stop());
        inspectionStream = null;
      }
      inspectionVideo.srcObject = null;
      inspectionActiveJobId = null;
      hide(inspectionModal);

      setStage('updating the job');
      try {
        await DB.updateJob(jobIdAtStart, { status: 'review', inspectionEndedAt: Date.now() });
      } catch (err) {
        console.error('[inspection] updateJob failed:', err);
        if (!watchdogFired) toast('Could not update the job status: ' + (err.message || err));
        return;
      }

      // Files each checklist photo into the report field it belongs to
      // (photo-checklists.js's schemaSection/schemaField) — organizing, not
      // AI. The AI pass below reads across every section in one go, so it
      // isn't duplicated here per section.
      setStage('filing checklist photos');
      if (window.ReportUI && window.ReportUI.attachChecklistPhotos) {
        await window.ReportUI.attachChecklistPhotos(jobIdAtStart)
          .catch((err) => console.warn('[inspection] could not file checklist photos:', err.message || err));
      }

      // Anything photographed without a checklist match — an "Other" shot,
      // or something added straight into the report editor — gets sorted
      // into the right field automatically, same as the checklist photos
      // just filed above.
      setStage('sorting general photos');
      if (window.ReportUI && window.ReportUI.sortGeneralPhotos) {
        await window.ReportUI.sortGeneralPhotos(jobIdAtStart)
          .catch((err) => console.warn('[inspection] could not sort general photos:', err.message || err));
      }

      // This is the whole point of "Generate Form": read every photo taken
      // and draft the whole report from what's in them. Fire-and-forget
      // because the technician should reach the report immediately rather
      // than waiting on it — jobIdAtStart is captured since they may
      // navigate away before it resolves.
      setStage('reading the photos');
      let photoCount = 0;
      try {
        const captures = await DB.getCaptures(jobIdAtStart);
        const photos = captures.filter((c) => c.photoBlob);
        photoCount = photos.length;

        if (photos.length && window.AI && window.ReportUI) {
          const jobForAi = await DB.getJob(jobIdAtStart);
          window.AI.analyzeInspectionPhotos(photos, jobForAi && jobForAi.jobType)
            .then((result) => window.ReportUI.applyAiDraft(jobIdAtStart, result))
            .then(() => toast('Form generated — review the AI-suggested answers in the report'))
            .catch((err) => {
              // Only logging this would make a failure indistinguishable from
              // "Generate Form does nothing", which is how it once looked.
              console.warn('[ai draft] photo analysis failed:', err.message || err);
              toast('Could not generate the form from your photos — retry from the report’s "Generate AI Draft" button.');
            });
        }
      } catch (err) {
        console.warn('[inspection] could not start photo analysis:', err.message || err);
      }

      toast(photoCount
        ? `Generating your form from ${photoCount} photo${photoCount === 1 ? '' : 's'} — opening report.`
        : 'No photos were taken, so there is nothing to generate a form from.');

      try {
        await ReportUI.openReview(jobIdAtStart);
      } catch (err) {
        console.error('[inspection] openReview failed:', err);
        if (!watchdogFired) toast('Photos saved, but the report view failed to open — open it from the job screen instead.');
      }
    } finally {
      clearInterval(progressTimer);
      clearTimeout(watchdog);
      // If the watchdog already fired and reset everything, don't stomp on
      // state a second time — a fresh tap may already have set it back.
      if (!watchdogFired) {
        finishInspectionInProgress = false;
        finishInspectionBtn.disabled = false;
        inspectionFinishBtn.disabled = false;
      }
    }
  }

  startInspectionBtn.addEventListener('click', () => {
    // While a camera request is outstanding the same button cancels it.
    if (startInspectionInProgress && abandonPendingStart) { abandonPendingStart(); return; }
    startInspection();
  });
  finishInspectionBtn.addEventListener('click', finishInspection);
  inspectionFinishBtn.addEventListener('click', finishInspection);

  // ---------- Import Footage (mid-inspection, drone / other camera) ----------
  function openImportModal() {
    importZoneInput.value = (importOpenedFromInspection ? inspectionZoneInput.value : '').trim();
    pendingImportFiles = [];
    importFileInput.value = '';
    importFileList.innerHTML = '';
    importSaveBtn.disabled = true;
    show(importModal);
  }

  function closeImportModal() {
    hide(importModal);
    if (importOpenedFromInspection) {
      importOpenedFromInspection = false;
      if (inspectionActiveJobId) show(inspectionModal);
    }
  }

  importFootageBtn.addEventListener('click', openImportModal);

  importChooseBtn.addEventListener('click', () => importFileInput.click());

  importFileInput.addEventListener('change', () => {
    pendingImportFiles = Array.from(importFileInput.files || []);
    importFileList.innerHTML = pendingImportFiles
      .map((f) => `<div class="import-file-row">${escapeHtml(f.name)}</div>`)
      .join('');
    importSaveBtn.disabled = pendingImportFiles.length === 0;
  });

  importCancelBtn.addEventListener('click', () => {
    closeImportModal();
    pendingImportFiles = [];
  });

  importSaveBtn.addEventListener('click', async () => {
    if (!pendingImportFiles.length) return;
    const zone = importZoneInput.value.trim();
    for (const file of pendingImportFiles) {
      const kind = file.type.startsWith('video') ? 'video' : 'photo';
      await DB.addFootage({
        jobId: currentJobId,
        zone,
        source: 'imported',
        kind,
        blob: file,
        fileName: file.name,
      });
    }
    closeImportModal();
    toast(`${pendingImportFiles.length} file${pendingImportFiles.length === 1 ? '' : 's'} imported into this inspection`);
    pendingImportFiles = [];
    await renderGallery();
  });

  // ---------- Which document is this job producing? ----------
  // Termite work is five different documents, not one. The job screen offers
  // whichever apply, with the one already started shown as current — a
  // property can carry an inspection this year and a service record the next,
  // and neither should require making a new job.
  async function renderDocumentTypePicker(job) {
    if (!docTypeRow || !window.ReportUI || !window.ReportUI.documentTypesFor) return;
    const types = window.ReportUI.documentTypesFor(job.jobType);

    // Nothing to choose between on a general pest job — one document, and the
    // Open Report button already covers it.
    if (types.length < 2) { docTypeRow.classList.add('hidden'); return; }

    const existing = await DB.getReport(job.id);
    const currentId = existing && existing.documentType;
    docTypeRow.classList.remove('hidden');
    docTypeRow.innerHTML = '';

    const heading = document.createElement('p');
    heading.className = 'doc-type-heading';
    heading.textContent = existing ? 'This job’s document' : 'What are you producing for this job?';
    docTypeRow.appendChild(heading);

    for (const type of types) {
      const isCurrent = currentId
        ? currentId === type.id
        : type.id === 'timber_pest_inspection';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'doc-type-card' + (isCurrent ? ' active' : '');
      card.innerHTML =
        `<span class="doc-type-title">${escapeHtml(type.title)}</span>`
        + (type.standard ? `<span class="doc-type-standard">${escapeHtml(type.standard)}</span>` : '')
        + `<span class="doc-type-blurb">${escapeHtml(type.blurb)}</span>`;

      card.addEventListener('click', async () => {
        // A report already exists and it is a different document — switching
        // would mean answering a different question set, so it is a decision
        // rather than a toggle.
        if (existing && currentId && currentId !== type.id) {
          toast(`This job already has a ${window.ReportUI.documentTypeOf(existing, job).short}. Create a separate job for the ${type.short}.`);
          return;
        }
        await ReportUI.openReview(job.id, type.id);
      });
      docTypeRow.appendChild(card);
    }
  }

  // ---------- View Report ----------
  viewReportBtn.addEventListener('click', () => ReportUI.openReview(currentJobId));
  if (viewInvoiceBtn) {
    viewInvoiceBtn.addEventListener('click', () => {
      if (window.InvoiceUI) window.InvoiceUI.open(currentJobId);
      else toast('Invoicing is still loading — try again in a moment.');
    });
  }

  // ---------- Capture detail ----------
  async function openDetail(captureId) {
    const capture = currentCaptures.find((c) => c.id === captureId) || await findCaptureById(captureId);
    if (!capture) return;
    currentDetailCaptureId = captureId;

    const list = getVisibleCaptures();
    currentDetailIndex = list.findIndex((c) => c.id === captureId);

    const zoneText = capture.zone || 'Untagged';
    detailZoneEl.textContent = list.length > 1
      ? `${zoneText} · ${currentDetailIndex + 1} of ${list.length}`
      : zoneText;

    detailPrevBtn.disabled = currentDetailIndex <= 0;
    detailNextBtn.disabled = currentDetailIndex < 0 || currentDetailIndex >= list.length - 1;

    resetZoom(false);

    if (capture.photoBlob) {
      const url = trackUrl(URL.createObjectURL(capture.photoBlob));
      detailPhoto.src = url;
      show(detailPhoto);
    } else {
      hide(detailPhoto);
    }

    if (capture.audioBlob) {
      const url = trackUrl(URL.createObjectURL(capture.audioBlob));
      detailAudio.src = url;
      show(detailAudioWrap);
    } else {
      detailAudio.removeAttribute('src');
      hide(detailAudioWrap);
    }

    // Only offer "attach memo" for photo captures without audio yet
    if (capture.photoBlob && !capture.audioBlob) {
      show(detailAddMemoBtn);
    } else {
      hide(detailAddMemoBtn);
    }

    if (!capture.zone && capture.suggestedZone) {
      detailApplySuggestedZoneBtn.textContent = `✨ Apply suggested zone: ${capture.suggestedZone}`;
      show(detailApplySuggestedZoneBtn);
    } else {
      hide(detailApplySuggestedZoneBtn);
    }

    show(detailModal);
  }

  detailApplySuggestedZoneBtn.addEventListener('click', async () => {
    if (!currentDetailCaptureId) return;
    const capture = currentCaptures.find((c) => c.id === currentDetailCaptureId) || await findCaptureById(currentDetailCaptureId);
    if (!capture || !capture.suggestedZone) return;
    await DB.updateCapture(currentDetailCaptureId, { zone: capture.suggestedZone });
    toast(`Zone set to ${capture.suggestedZone}`);
    await renderGallery();
    await openDetail(currentDetailCaptureId);
  });

  function navigateDetail(delta) {
    const list = getVisibleCaptures();
    const newIndex = currentDetailIndex + delta;
    if (newIndex < 0 || newIndex >= list.length) return;
    haptic(10);
    openDetail(list[newIndex].id);
  }

  detailPrevBtn.addEventListener('click', () => navigateDetail(-1));
  detailNextBtn.addEventListener('click', () => navigateDetail(1));

  // ---------- Pinch-zoom / pan / swipe-to-navigate on the detail photo ----------
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  let touchMode = null; // 'pinch' | 'pan' | 'swipe'
  let pinchStartDist = null;
  let pinchStartScale = 1;
  let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
  let swipeStartX = 0, swipeStartY = 0;
  let lastTapTime = 0;

  function distanceBetween(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function applyZoomTransform(animate) {
    detailPhoto.style.transition = animate ? 'transform 0.2s ease' : 'none';
    detailPhoto.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  }

  function resetZoom(animate) {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    applyZoomTransform(animate);
  }

  detailPhotoZoomWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      touchMode = 'pinch';
      pinchStartDist = distanceBetween(e.touches[0], e.touches[1]);
      pinchStartScale = zoomScale;
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const now = Date.now();
    if (now - lastTapTime < 300) {
      lastTapTime = 0;
      if (zoomScale > 1) {
        resetZoom(true);
      } else {
        zoomScale = 2.5;
        panX = 0;
        panY = 0;
        applyZoomTransform(true);
      }
      touchMode = null;
      return;
    }
    lastTapTime = now;
    if (zoomScale > 1.02) {
      touchMode = 'pan';
      panStartX = t.clientX;
      panStartY = t.clientY;
      panOriginX = panX;
      panOriginY = panY;
    } else {
      touchMode = 'swipe';
      swipeStartX = t.clientX;
      swipeStartY = t.clientY;
    }
  }, { passive: true });

  detailPhotoZoomWrap.addEventListener('touchmove', (e) => {
    if (touchMode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const dist = distanceBetween(e.touches[0], e.touches[1]);
      zoomScale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      applyZoomTransform(false);
    } else if (touchMode === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      panX = panOriginX + (t.clientX - panStartX);
      panY = panOriginY + (t.clientY - panStartY);
      applyZoomTransform(false);
    }
  }, { passive: false });

  detailPhotoZoomWrap.addEventListener('touchend', (e) => {
    if (touchMode === 'pinch') {
      if (zoomScale <= 1.02) resetZoom(true);
      pinchStartDist = null;
    } else if (touchMode === 'swipe') {
      const t = e.changedTouches[0];
      const dx = t.clientX - swipeStartX;
      const dy = t.clientY - swipeStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) navigateDetail(-1); else navigateDetail(1);
      }
    }
    touchMode = null;
  });

  async function findCaptureById(id) {
    currentCaptures = await DB.getCaptures(currentJobId);
    return currentCaptures.find((c) => c.id === id);
  }

  detailClose.addEventListener('click', () => {
    hide(detailModal);
    currentDetailCaptureId = null;
  });

  detailAddMemoBtn.addEventListener('click', () => {
    if (!currentDetailCaptureId) return;
    hide(detailModal);
    startRecording({ mode: 'attach', captureId: currentDetailCaptureId });
  });

  detailDeleteBtn.addEventListener('click', async () => {
    if (!currentDetailCaptureId) return;
    if (!confirm('Delete this capture?')) return;
    await DB.deleteCapture(currentDetailCaptureId);
    hide(detailModal);
    currentDetailCaptureId = null;
    toast('Deleted');
    await renderGallery();
  });

  // ---------- Init ----------
  async function initAuth() {
    // Demo mode never authenticates. That is the whole point: every RLS
    // policy here is `using (true)`, so any real login would expose every
    // real client's details to whoever is holding the phone.
    if (window.IS_DEMO) {
      showJobListView();
      return;
    }
    if (!window.Sync) {
      // Supabase not configured — fall back to fully local-only mode.
      showJobListView();
      return;
    }

    Sync.onStatusChange(updateSyncBarText);

    Sync.onAuthChange((session) => {
      if (session) {
        showLoggedInUI(session);
        showJobListView();
        Sync.pullAll().then(() => renderJobList());
        // Xero sends the technician back here with ?code= after they grant
        // access. It can only be redeemed while signed in, since the exchange
        // goes through an auth-gated Edge Function.
        if (window.Xero) {
          window.Xero.captureAuthCodeFromUrl().then((result) => {
            if (!result) return;
            toast(result.ok
              ? `Xero connected — ${result.tenantName || 'organisation'}`
              : 'Could not connect Xero: ' + result.error);
          });
        }
      } else {
        loggedInEmail = '';
        showLoginView();
      }
    });

    const session = await Sync.getSession();
    if (session) {
      showLoggedInUI(session);
      showJobListView();
      Sync.pullAll().then(() => renderJobList());
    } else {
      showLoginView();
    }
  }

  initAuth();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
