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
  const inspectionModalTimer = document.getElementById('inspection-modal-timer');
  const inspectionZonePill = document.getElementById('inspection-zone-pill');
  const inspectionZoneInput = document.getElementById('inspection-zone-input');
  const inspectionStillBtn = document.getElementById('inspection-still-btn');
  const inspectionFinishBtn = document.getElementById('inspection-finish-btn');
  const inspectionImportBtn = document.getElementById('inspection-import-btn');

  const cameraModal = document.getElementById('camera-modal');
  const cameraVideo = document.getElementById('camera-video');
  const cameraCanvas = document.getElementById('camera-canvas');
  const cameraZonePill = document.getElementById('camera-zone-pill');
  const cameraCancelBtn = document.getElementById('camera-cancel');
  const cameraShutterBtn = document.getElementById('camera-shutter');
  const cameraSwitchBtn = document.getElementById('camera-switch');
  const cameraErrorEl = document.getElementById('camera-error');
  const cameraFlashEl = document.getElementById('camera-flash');
  const shotCounterEl = document.getElementById('shot-counter');
  const recentShotEl = document.getElementById('recent-shot');
  const recentShotImg = document.getElementById('recent-shot-img');

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

  let cameraStream = null;
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

  let sessionShotCount = 0;

  let inspectionRecorder = null;
  let inspectionStream = null;
  let inspectionChunks = [];
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
    hide(viewJob);
    hide(viewLogin);
    document.getElementById('view-report').classList.add('hidden');
    document.getElementById('view-report-section').classList.add('hidden');
    document.getElementById('view-archive').classList.add('hidden');
    show(viewJobList);
    currentJobId = null;
    stopCameraStream();
    renderJobList();
  }
  window.showJobListView = showJobListView;
  // Used by invoice-ui.js to return to the job it was opened from.
  window.showJobViewById = showJobView;
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

    const isRecording = !!inspectionRecorder && inspectionRecorder.state === 'recording' && currentJobId === job.id;

    if (isRecording) {
      hide(startInspectionBtn);
      show(finishInspectionBtn);
      show(inspectionTimerEl);
      finishInspectionBtn.textContent = '■ Finish Inspection';
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
      finishInspectionBtn.textContent = '⚠ Recover / Finish Inspection';
    } else {
      hide(startInspectionBtn);
      hide(finishInspectionBtn);
      hide(inspectionTimerEl);
    }

    if (job.status === 'review' || job.status === 'completed') {
      show(viewReportBtn);
      viewReportBtn.textContent = job.status === 'completed' ? '✓ View Finalized Report' : '📄 Open Report';
    } else {
      hide(viewReportBtn);
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

      const due = dueInfo(job);
      if (due) {
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

  newJobBtn.addEventListener('click', () => {
    jobNameInput.value = '';
    jobAddressInput.value = '';
    jobPhoneInput.value = '';
    jobEmailInput.value = '';
    jobNotesInput.value = '';
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
    });
    hide(jobForm);
    await renderJobList();
    showJobView(job.id);
  });

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
      const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&countrycodes=au,nz&limit=6&q=' + encodeURIComponent(query);
      const res = await fetch(url, { signal: addressAbortController.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('address lookup failed');
      const results = await res.json();
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

  // ---------- Camera ----------
  let shutterBusy = false;

  async function openCamera() {
    cameraErrorEl.classList.add('hidden');
    cameraZonePill.textContent = 'Untagged'; // zoneInput was removed; this whole modal is currently unreachable anyway
    sessionShotCount = 0;
    hide(shotCounterEl);
    hide(recentShotEl);
    cameraCancelBtn.textContent = '✕';
    cameraCancelBtn.setAttribute('aria-label', 'Cancel');
    show(cameraModal);
    await startCameraStream();
  }

  function triggerFlash() {
    cameraFlashEl.classList.remove('flashing');
    void cameraFlashEl.offsetWidth; // restart the CSS animation
    cameraFlashEl.classList.add('flashing');
  }

  function showRecentShot(blob) {
    const url = URL.createObjectURL(blob);
    if (recentShotImg.dataset.blobUrl) URL.revokeObjectURL(recentShotImg.dataset.blobUrl);
    recentShotImg.src = url;
    recentShotImg.dataset.blobUrl = url;
    recentShotEl.classList.remove('hidden', 'pop');
    void recentShotEl.offsetWidth;
    recentShotEl.classList.add('pop');
  }

  async function startCameraStream() {
    stopCameraStream();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      cameraVideo.srcObject = cameraStream;
    } catch (err) {
      cameraErrorEl.textContent = 'Could not access camera: ' + (err.message || err.name || 'permission denied') +
        '. Check your browser/site camera permissions.';
      cameraErrorEl.classList.remove('hidden');
    }
  }

  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
  }

  async function closeCamera() {
    stopCameraStream();
    hide(cameraModal);
    if (sessionShotCount > 0) await renderGallery();
  }

  cameraCancelBtn.addEventListener('click', closeCamera);

  cameraSwitchBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCameraStream();
  });

  // Camera stays open after each shot (rapid-fire) so a whole zone can be
  // photographed without re-tapping "Photo" between shots — closing is a
  // separate, deliberate action via the ✕/Done button.
  cameraShutterBtn.addEventListener('click', async () => {
    if (!cameraStream || !cameraVideo.videoWidth || shutterBusy) return;
    shutterBusy = true;
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const ctx = cameraCanvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

    triggerFlash();
    shutterFeedback();

    cameraCanvas.toBlob(async (blob) => {
      shutterBusy = false;
      if (!blob) { toast('Capture failed, try again'); return; }
      await DB.addCapture({
        jobId: currentJobId,
        zone: '', // zoneInput was removed; this whole modal is currently unreachable anyway
        type: 'photo',
        photoBlob: blob,
      });
      sessionShotCount += 1;
      shotCounterEl.textContent = `${sessionShotCount} photo${sessionShotCount === 1 ? '' : 's'}`;
      show(shotCounterEl);
      showRecentShot(blob);
      cameraCancelBtn.textContent = '✓';
      cameraCancelBtn.setAttribute('aria-label', 'Done');
    }, 'image/jpeg', 0.88);
  });

  // openCamera() is currently unreachable — its trigger button (Photo, in
  // the old bottom action bar) was removed since capture now happens via
  // Start/Finish Inspection or Import Footage. Left in place rather than
  // purged in case this rapid-fire capture UI gets re-exposed elsewhere.

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

  async function startInspection() {
    if (startInspectionInProgress) return;
    startInspectionInProgress = true;

    const originalLabel = startInspectionBtn.textContent;
    startInspectionBtn.disabled = true;
    startInspectionBtn.textContent = '⏳ Starting camera…';
    const resetButton = () => {
      startInspectionInProgress = false;
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
      // getUserMedia does NOT always settle. If the OS permission sheet is
      // dismissed by a swipe rather than answered — common on iOS, and on
      // Android when the app is backgrounded mid-prompt — the promise hangs
      // forever: no resolve, no reject, no error to catch. Racing it against
      // a timeout is what turns that silent hang into a message.
      inspectionStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('__timeout__')), 15000)),
      ]);
    } catch (err) {
      releaseStream();
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

    // MediaRecorder construction and start() can both throw (NotSupportedError
    // on an unsupported mime type, InvalidStateError on a dead track). These
    // used to sit outside any try/catch, so a failure here left the camera on,
    // the modal open, and no recorder — with nothing said about it.
    try {
      inspectionVideo.srcObject = inspectionStream;
      inspectionZoneInput.value = '';
      inspectionZonePill.textContent = 'Untagged';
      show(inspectionModal);

      inspectionChunks = [];
      const mimeType = pickVideoMimeType();
      inspectionRecorder = mimeType
        ? new MediaRecorder(inspectionStream, { mimeType })
        : new MediaRecorder(inspectionStream);

      inspectionRecorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) inspectionChunks.push(e.data);
      });

      inspectionRecorder.start(1000);
    } catch (err) {
      console.error('[inspection] recorder failed to start:', err);
      inspectionRecorder = null;
      inspectionVideo.srcObject = null;
      hide(inspectionModal);
      releaseStream();
      toast('This device could not start video recording: ' + ((err && err.message) || err));
      resetButton();
      return;
    }

    // Recording is live. renderInspectionControls hides this button below, but
    // the same element is reused for the next job, so its label has to go back.
    resetButton();
    inspectionStartedAt = Date.now();
    inspectionTimerInterval = setInterval(() => {
      const t = fmtTimer(Date.now() - inspectionStartedAt);
      inspectionTimerEl.textContent = t;
      inspectionModalTimer.textContent = t;
    }, 500);

    const jobIdForStart = currentJobId;
    await DB.updateJob(jobIdForStart, { status: 'in_progress', inspectionStartedAt });
    const job = await DB.getJob(jobIdForStart);
    renderInspectionControls(job);
    toast('Inspection started — recording video & audio');

    // Both are best-effort, fire-and-forget: neither should delay the
    // camera preview opening, and both only fill an empty field (never
    // overwrite something the technician already entered).
    if (window.ReportUI) {
      const hhmm = new Date(inspectionStartedAt).toTimeString().slice(0, 5);
      window.ReportUI.prefillFieldValue(jobIdForStart, 'clientDetails', 'inspectionTime', hhmm)
        .catch((err) => console.warn('[inspection] could not prefill inspection time:', err.message || err));
    }
    if (window.AI && typeof job.addressLat === 'number' && typeof job.addressLng === 'number') {
      window.AI.fetchCurrentWeather(job.addressLat, job.addressLng)
        .then((weather) => weather && window.ReportUI && window.ReportUI.prefillFieldValue(jobIdForStart, 'clientDetails', 'weather', weather))
        .catch((err) => console.warn('[inspection] could not prefill weather:', err.message || err));
    }
  }

  inspectionZoneInput.addEventListener('input', () => {
    inspectionZonePill.textContent = inspectionZoneInput.value.trim() || 'Untagged';
  });

  inspectionStillBtn.addEventListener('click', async () => {
    if (!inspectionStream || !inspectionVideo.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = inspectionVideo.videoWidth;
    canvas.height = inspectionVideo.videoHeight;
    canvas.getContext('2d').drawImage(inspectionVideo, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      if (!blob) { toast('Capture failed, try again'); return; }
      await DB.addCapture({
        jobId: currentJobId,
        zone: inspectionZoneInput.value.trim(),
        type: 'photo',
        photoBlob: blob,
      });
      toast('Photo saved');
    }, 'image/jpeg', 0.88);
  });

  inspectionImportBtn.addEventListener('click', () => {
    importOpenedFromInspection = true;
    hide(inspectionModal);
    openImportModal();
  });

  function pickVideoMimeType() {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  let finishInspectionInProgress = false;

  async function finishInspection() {
    // Guard against double-taps and make sure a tap is NEVER silently
    // swallowed — previously, a null inspectionRecorder (session state lost
    // to backgrounding/reload) made this function return with zero
    // feedback, which is exactly what "I tapped Finish and nothing
    // happened" looks like from the outside.
    if (finishInspectionInProgress) return;
    finishInspectionInProgress = true;
    finishInspectionBtn.disabled = true;
    inspectionFinishBtn.disabled = true;
    const jobIdAtStart = currentJobId;

    // Outer safety net covering the WHOLE function: if anything below hangs
    // (a DB call, a UI transition, anything) for longer than this, force
    // the button back to a usable state and say so plainly, rather than
    // leaving it stuck disabled with no way to tell what happened.
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      console.warn('[inspection] finishInspection watchdog fired after 12s — something hung.');
      toast('That took too long and got stuck — try again. If it keeps happening, tell me exactly what you see.');
      finishInspectionInProgress = false;
      finishInspectionBtn.disabled = false;
      inspectionFinishBtn.disabled = false;
    }, 12000);

    try {
      if (!inspectionRecorder) {
        // No live recording in this session — most likely the tab was
        // backgrounded, reloaded, or the recording was started on another
        // device. Recover instead of doing nothing. Each step below has its
        // own try/catch so a failure anywhere still leaves a specific,
        // visible clue about which step broke instead of a blanket failure.
        toast('No active recording found — finishing this inspection.');
        clearInterval(inspectionTimerInterval);
        hide(inspectionModal);

        try {
          await DB.updateJob(jobIdAtStart, { status: 'review', inspectionEndedAt: Date.now() });
        } catch (err) {
          console.error('[inspection] updateJob failed:', err);
          if (!watchdogFired) toast('Could not update the job status: ' + (err.message || err));
          return;
        }

        try {
          await ReportUI.openReview(jobIdAtStart);
        } catch (err) {
          console.error('[inspection] openReview failed:', err);
          if (!watchdogFired) toast('Job marked finished, but the report view failed to open — open it from the job screen instead.');
        }
        return;
      }

      // Never wait forever on the 'stop' event — MediaRecorder implementations
      // (iOS Safari in particular) can fail to fire it reliably in some
      // states. Race against a timeout so Finish always completes with
      // visible feedback instead of hanging silently.
      const stopped = new Promise((resolve) => {
        inspectionRecorder.addEventListener('stop', resolve, { once: true });
      });
      if (inspectionRecorder.state !== 'inactive') inspectionRecorder.stop();
      const stoppedInTime = await Promise.race([
        stopped.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      if (!stoppedInTime) {
        console.warn('[inspection] MediaRecorder did not fire "stop" within 5s — proceeding with whatever was captured.');
      }

      clearInterval(inspectionTimerInterval);
      if (inspectionStream) {
        inspectionStream.getTracks().forEach((t) => t.stop());
        inspectionStream = null;
      }
      inspectionVideo.srcObject = null;
      hide(inspectionModal);

      if (inspectionChunks.length) {
        const blob = new Blob(inspectionChunks, { type: (inspectionRecorder && inspectionRecorder.mimeType) || 'video/webm' });
        await DB.addFootage({
          jobId: jobIdAtStart,
          zone: '',
          source: 'live',
          kind: 'video',
          blob,
          note: 'Live inspection recording',
        });

        // Fire-and-forget: analyze in the background so Finish doesn't block
        // on it. jobIdAtStart is captured since the user may navigate
        // elsewhere before this resolves.
        if (window.AI && window.ReportUI) {
          const jobForAi = await DB.getJob(jobIdAtStart);
          window.AI.analyzeInspection(blob, jobForAi && jobForAi.jobType)
            .then((result) => window.ReportUI.applyAiDraft(jobIdAtStart, result))
            .then(() => toast('AI draft ready — review suggested values in the report'))
            .catch((err) => {
              // Previously this only logged to console — a failure here was
              // indistinguishable from "AI Draft doesn't do anything at all"
              // from the user's side. Always surface it.
              console.warn('[ai draft] background analysis failed:', err.message || err);
              toast('AI draft failed to generate — you can retry from the report’s "Generate AI Draft" button.');
            });
        }
      } else {
        toast('Inspection finished — no video was captured (recording may have been interrupted).');
      }
      inspectionChunks = [];
      inspectionRecorder = null;

      try {
        await DB.updateJob(jobIdAtStart, { status: 'review', inspectionEndedAt: Date.now() });
      } catch (err) {
        console.error('[inspection] updateJob failed:', err);
        if (!watchdogFired) toast('Recording saved, but could not update the job status: ' + (err.message || err));
        return;
      }

      toast('Inspection finished — opening report for review');
      try {
        await ReportUI.openReview(jobIdAtStart);
      } catch (err) {
        console.error('[inspection] openReview failed:', err);
        if (!watchdogFired) toast('Inspection finished, but the report view failed to open — open it from the job screen instead.');
      }
    } finally {
      clearTimeout(watchdog);
      // If the watchdog already fired and reset everything, don't stomp on
      // state a second time (e.g. re-disabling nothing, or resetting a flag
      // a fresh tap may have already set back to true).
      if (!watchdogFired) {
        finishInspectionInProgress = false;
        finishInspectionBtn.disabled = false;
        inspectionFinishBtn.disabled = false;
      }
    }
  }

  // Best-effort safety net: if the tab is about to be backgrounded while
  // actively recording, force-flush whatever MediaRecorder has buffered so
  // far into inspectionChunks. Doesn't protect against the tab being fully
  // killed (no client-side JS can), but covers the far more common
  // "switched apps for a minute and came back" case.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && inspectionRecorder && inspectionRecorder.state === 'recording') {
      try { inspectionRecorder.requestData(); } catch (err) { /* not fatal — best effort only */ }
    }
  });

  startInspectionBtn.addEventListener('click', startInspection);
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
      if (inspectionRecorder && inspectionRecorder.state === 'recording') show(inspectionModal);
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
