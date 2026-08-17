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
  const jobNameInput = document.getElementById('job-name');
  const jobAddressInput = document.getElementById('job-address');
  const jobPhoneInput = document.getElementById('job-phone');
  const jobEmailInput = document.getElementById('job-email');
  const jobNotesInput = document.getElementById('job-notes');
  const newJobBtn = document.getElementById('new-job-btn');
  const openArchiveBtn = document.getElementById('open-archive-btn');
  const jobFormCancel = document.getElementById('job-form-cancel');
  const jobFormSave = document.getElementById('job-form-save');
  const jobListEl = document.getElementById('job-list');
  const jobEmptyEl = document.getElementById('job-empty');

  const backBtn = document.getElementById('back-btn');
  const deleteJobBtn = document.getElementById('delete-job-btn');
  const jobTitleEl = document.getElementById('job-title');
  const jobSubtitleEl = document.getElementById('job-subtitle');
  const zoneInput = document.getElementById('zone-input');
  const zoneSuggestions = document.getElementById('zone-suggestions');
  const galleryEl = document.getElementById('gallery');
  const galleryEmptyEl = document.getElementById('gallery-empty');

  const openCameraBtn = document.getElementById('open-camera-btn');
  const zoneMemoBtn = document.getElementById('zone-memo-btn');

  const jobStatusBadge = document.getElementById('job-status-badge');
  const inspectionTimerEl = document.getElementById('inspection-timer');
  const startInspectionBtn = document.getElementById('start-inspection-btn');
  const finishInspectionBtn = document.getElementById('finish-inspection-btn');
  const importFootageBtn = document.getElementById('import-footage-btn');
  const viewReportBtn = document.getElementById('view-report-btn');

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
  const detailDeleteBtn = document.getElementById('detail-delete');

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
    zoneInput.value = '';
    hide(viewJobList);
    show(viewJob);
    renderInspectionControls(job);
    await renderGallery();
  }

  function renderInspectionControls(job) {
    jobStatusBadge.textContent = DB.JOB_STATUS_LABELS[job.status] || 'New';
    jobStatusBadge.className = 'status-badge status-' + (job.status || 'new');

    const isRecording = !!inspectionRecorder && inspectionRecorder.state === 'recording' && currentJobId === job.id;

    if (isRecording) {
      hide(startInspectionBtn);
      show(finishInspectionBtn);
      show(inspectionTimerEl);
    } else if (job.status === 'new') {
      show(startInspectionBtn);
      hide(finishInspectionBtn);
      hide(inspectionTimerEl);
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
  }

  window.refreshJobViewStatus = async function (jobId) {
    if (jobId !== currentJobId) return;
    const job = await DB.getJob(jobId);
    if (job) renderInspectionControls(job);
  };

  // ---------- Job list ----------
  async function renderJobList() {
    const jobs = await DB.getJobs();
    jobListEl.innerHTML = '';
    if (jobs.length === 0) {
      show(jobEmptyEl);
    } else {
      hide(jobEmptyEl);
    }
    for (const job of jobs) {
      const count = await DB.getCaptureCount(job.id);
      const li = document.createElement('li');
      li.className = 'job-item';
      li.innerHTML = `
        <span class="job-item-top">
          <span class="job-item-name"></span>
          <span class="status-badge status-${job.status || 'new'} small"></span>
        </span>
        <span class="job-item-meta">
          <span class="job-item-date"></span>
          <span>·</span>
          <span>${count} capture${count === 1 ? '' : 's'}</span>
        </span>
      `;
      li.querySelector('.job-item-name').textContent = job.name;
      li.querySelector('.status-badge').textContent = DB.JOB_STATUS_LABELS[job.status] || 'New';
      li.querySelector('.job-item-date').textContent = job.address ? `${job.address} · ${fmtDate(job.createdAt)}` : fmtDate(job.createdAt);
      li.addEventListener('click', () => showJobView(job.id));
      jobListEl.appendChild(li);
    }
  }

  openArchiveBtn.addEventListener('click', () => ReportUI.openArchive());

  newJobBtn.addEventListener('click', () => {
    jobNameInput.value = '';
    jobAddressInput.value = '';
    jobPhoneInput.value = '';
    jobEmailInput.value = '';
    jobNotesInput.value = '';
    show(jobForm);
    jobNameInput.focus();
  });

  jobFormCancel.addEventListener('click', () => hide(jobForm));

  jobFormSave.addEventListener('click', async () => {
    const name = jobNameInput.value.trim();
    if (!name) { toast('Enter a job name'); jobNameInput.focus(); return; }
    const job = await DB.addJob({
      name,
      address: jobAddressInput.value.trim(),
      notes: jobNotesInput.value.trim(),
      clientPhone: jobPhoneInput.value.trim(),
      clientEmail: jobEmailInput.value.trim(),
    });
    hide(jobForm);
    await renderJobList();
    showJobView(job.id);
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
    galleryEl.innerHTML = '';

    if (currentCaptures.length === 0) {
      show(galleryEmptyEl);
    } else {
      hide(galleryEmptyEl);
    }

    for (const capture of currentCaptures) {
      const tile = document.createElement('div');
      tile.className = 'capture-tile' + (capture.type === 'memo' ? ' memo-only' : '');

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

      const zoneLabel = document.createElement('span');
      zoneLabel.className = 'capture-tile-zone';
      zoneLabel.textContent = capture.zone || 'Untagged';
      tile.appendChild(zoneLabel);

      tile.addEventListener('click', () => openDetail(capture.id));
      galleryEl.appendChild(tile);
    }

    populateZoneSuggestions();
  }

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
  async function openCamera() {
    cameraErrorEl.classList.add('hidden');
    cameraZonePill.textContent = zoneInput.value.trim() || 'Untagged';
    show(cameraModal);
    await startCameraStream();
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

  function closeCamera() {
    stopCameraStream();
    hide(cameraModal);
  }

  cameraCancelBtn.addEventListener('click', closeCamera);

  cameraSwitchBtn.addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCameraStream();
  });

  cameraShutterBtn.addEventListener('click', async () => {
    if (!cameraStream || !cameraVideo.videoWidth) return;
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const ctx = cameraCanvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

    cameraCanvas.toBlob(async (blob) => {
      if (!blob) { toast('Capture failed, try again'); return; }
      await DB.addCapture({
        jobId: currentJobId,
        zone: zoneInput.value.trim(),
        type: 'photo',
        photoBlob: blob,
      });
      closeCamera();
      toast('Photo saved');
      await renderGallery();
    }, 'image/jpeg', 0.88);
  });

  openCameraBtn.addEventListener('click', openCamera);

  // ---------- Voice recording ----------
  function pickMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  async function startRecording(target) {
    recordingTarget = target;
    recordTargetLabel.textContent = target.mode === 'attach'
      ? 'Attaching voice note to photo'
      : `Zone note: ${zoneInput.value.trim() || 'Untagged'}`;
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
        zone: zoneInput.value.trim(),
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

  zoneMemoBtn.addEventListener('click', () => startRecording({ mode: 'new' }));

  // ---------- Start / Finish Inspection (continuous video+audio, live preview) ----------
  async function startInspection() {
    try {
      inspectionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
    } catch (err) {
      toast('Could not access camera/microphone for inspection recording');
      return;
    }

    inspectionVideo.srcObject = inspectionStream;
    inspectionZoneInput.value = zoneInput.value.trim();
    inspectionZonePill.textContent = inspectionZoneInput.value || 'Untagged';
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
    inspectionStartedAt = Date.now();
    inspectionTimerInterval = setInterval(() => {
      const t = fmtTimer(Date.now() - inspectionStartedAt);
      inspectionTimerEl.textContent = t;
      inspectionModalTimer.textContent = t;
    }, 500);

    await DB.updateJob(currentJobId, { status: 'in_progress', inspectionStartedAt: Date.now() });
    const job = await DB.getJob(currentJobId);
    renderInspectionControls(job);
    toast('Inspection started — recording video & audio');
  }

  inspectionZoneInput.addEventListener('input', () => {
    zoneInput.value = inspectionZoneInput.value;
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

  async function finishInspection() {
    if (!inspectionRecorder) return;
    const stopped = new Promise((resolve) => {
      inspectionRecorder.addEventListener('stop', resolve, { once: true });
    });
    if (inspectionRecorder.state !== 'inactive') inspectionRecorder.stop();
    await stopped;

    clearInterval(inspectionTimerInterval);
    if (inspectionStream) {
      inspectionStream.getTracks().forEach((t) => t.stop());
      inspectionStream = null;
    }
    inspectionVideo.srcObject = null;
    hide(inspectionModal);

    if (inspectionChunks.length) {
      const blob = new Blob(inspectionChunks, { type: inspectionRecorder.mimeType || 'video/webm' });
      await DB.addFootage({
        jobId: currentJobId,
        zone: '',
        source: 'live',
        kind: 'video',
        blob,
        note: 'Live inspection recording',
      });
    }
    inspectionChunks = [];
    inspectionRecorder = null;

    await DB.updateJob(currentJobId, { status: 'review', inspectionEndedAt: Date.now() });
    toast('Inspection finished — opening report for review');
    await ReportUI.openReview(currentJobId);
  }

  startInspectionBtn.addEventListener('click', startInspection);
  finishInspectionBtn.addEventListener('click', finishInspection);
  inspectionFinishBtn.addEventListener('click', finishInspection);

  // ---------- Import Footage (mid-inspection, drone / other camera) ----------
  function openImportModal() {
    importZoneInput.value = (importOpenedFromInspection ? inspectionZoneInput.value : zoneInput.value).trim();
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

  // ---------- Capture detail ----------
  async function openDetail(captureId) {
    const capture = currentCaptures.find((c) => c.id === captureId) || await findCaptureById(captureId);
    if (!capture) return;
    currentDetailCaptureId = captureId;

    detailZoneEl.textContent = capture.zone || 'Untagged';

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

    show(detailModal);
  }

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
