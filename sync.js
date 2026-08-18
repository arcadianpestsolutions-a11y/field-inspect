// Cloud sync layer — talks to Supabase so job details and report data are
// available from any signed-in device. Photos and video stay local-only
// (IndexedDB), by design — only job/report fields sync.
//
// Every push is best-effort: if it fails (offline, etc.) it's silently
// skipped and reconciled by the next pullAll(), which does a full two-way
// sync using "most recently updated wins".
(() => {
  'use strict';

  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) {
    console.warn('[sync] Supabase not configured — running local-only.');
    return;
  }

  const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
  // Exposed so other modules (ai.js) reuse this same client instead of
  // creating their own — a second client on the same auth storage key
  // triggers Supabase's "multiple GoTrueClient instances" warning and risks
  // undefined behavior on token refresh.
  window.supabaseClient = supabaseClient;

  let currentSession = null;
  let authListeners = [];
  let statusListeners = [];
  let syncStatus = { state: 'idle', lastSyncedAt: null, error: null };

  function onAuthChange(fn) { authListeners.push(fn); }
  function onStatusChange(fn) { statusListeners.push(fn); }

  function setStatus(patch) {
    syncStatus = { ...syncStatus, ...patch };
    statusListeners.forEach((fn) => { try { fn(syncStatus); } catch (e) { /* ignore listener errors */ } });
  }

  function isOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function isReady() { return !!currentSession && isOnline(); }
  function currentUserId() { return currentSession && currentSession.user ? currentSession.user.id : null; }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    authListeners.forEach((fn) => { try { fn(session); } catch (e) { /* ignore listener errors */ } });
  });

  // ---------- Field <-> column mapping ----------
  function localJobToRemote(job) {
    return {
      id: job.id,
      name: job.name,
      job_type: job.jobType || 'termite',
      address: job.address || '',
      address_lat: typeof job.addressLat === 'number' ? job.addressLat : null,
      address_lng: typeof job.addressLng === 'number' ? job.addressLng : null,
      notes: job.notes || '',
      client_phone: job.clientPhone || '',
      client_email: job.clientEmail || '',
      status: job.status || 'new',
      inspection_date: job.inspectionDate || null,
      inspection_time: job.inspectionTime || null,
      weather: job.weather || '',
      inspection_started_at: job.inspectionStartedAt || null,
      inspection_ended_at: job.inspectionEndedAt || null,
      created_by: currentUserId(),
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    };
  }

  function remoteJobToLocal(rj) {
    return {
      id: rj.id,
      name: rj.name,
      jobType: rj.job_type === 'pest_treatment' ? 'pest_treatment' : 'termite',
      address: rj.address || '',
      addressLat: typeof rj.address_lat === 'number' ? rj.address_lat : null,
      addressLng: typeof rj.address_lng === 'number' ? rj.address_lng : null,
      notes: rj.notes || '',
      clientPhone: rj.client_phone || '',
      clientEmail: rj.client_email || '',
      status: rj.status || 'new',
      inspectionDate: rj.inspection_date || null,
      inspectionTime: rj.inspection_time || null,
      weather: rj.weather || '',
      inspectionStartedAt: rj.inspection_started_at || null,
      inspectionEndedAt: rj.inspection_ended_at || null,
      createdAt: rj.created_at,
      updatedAt: rj.updated_at,
    };
  }

  // photos fields hold {id, blob} objects — Blobs can't be sent to Supabase,
  // so we replace them with a small marker and restore local blobs on pull.
  function sanitizeSectionsForPush(sections) {
    const out = {};
    for (const sectionId of Object.keys(sections || {})) {
      const values = sections[sectionId] || {};
      const cleanVals = {};
      for (const fieldId of Object.keys(values)) {
        const val = values[fieldId];
        if (Array.isArray(val) && val.length && val[0] && typeof val[0] === 'object' && 'blob' in val[0]) {
          cleanVals[fieldId] = { __localPhotoCount: val.length };
        } else {
          cleanVals[fieldId] = val;
        }
      }
      out[sectionId] = cleanVals;
    }
    return out;
  }

  function mergeRemoteSections(remoteSections, localSections) {
    const merged = {};
    const ids = new Set([...Object.keys(remoteSections || {}), ...Object.keys(localSections || {})]);
    for (const sectionId of ids) {
      const remoteVals = (remoteSections && remoteSections[sectionId]) || {};
      const localVals = (localSections && localSections[sectionId]) || {};
      const mergedVals = { ...remoteVals };
      for (const fieldId of Object.keys(mergedVals)) {
        const val = mergedVals[fieldId];
        if (val && typeof val === 'object' && !Array.isArray(val) && '__localPhotoCount' in val) {
          // Remote can't carry the actual photo blobs — keep whatever this device has locally.
          mergedVals[fieldId] = localVals[fieldId] !== undefined ? localVals[fieldId] : [];
        }
      }
      merged[sectionId] = mergedVals;
    }
    return merged;
  }

  function localReportToRemote(report) {
    return {
      job_id: report.jobId,
      sections: sanitizeSectionsForPush(report.sections),
      // aiDraft is text-only (transcript + suggested field values) — no
      // blobs involved, so unlike sections it needs no sanitizing before push.
      ai_draft: report.aiDraft || null,
      finalized_at: report.finalizedAt || null,
      updated_by: currentUserId(),
      updated_at: report.updatedAt || Date.now(),
    };
  }

  function remoteReportToLocal(rr, existingLocal) {
    return {
      jobId: rr.job_id,
      sections: mergeRemoteSections(rr.sections, existingLocal ? existingLocal.sections : {}),
      aiDraft: rr.ai_draft || (existingLocal ? existingLocal.aiDraft : null),
      finalizedAt: rr.finalized_at || null,
      updatedAt: rr.updated_at,
    };
  }

  // ---------- Push (best effort, called from db.js after every local write) ----------
  async function pushJob(job) {
    if (!isReady()) return;
    try {
      const { error } = await supabaseClient.from('jobs').upsert(localJobToRemote(job));
      if (error) throw error;
    } catch (e) {
      console.warn('[sync] push job failed, will retry on next sync:', e.message || e);
    }
  }

  async function pushReport(report) {
    if (!isReady()) return;
    try {
      const { error } = await supabaseClient.from('reports').upsert(localReportToRemote(report));
      if (error) throw error;
    } catch (e) {
      console.warn('[sync] push report failed, will retry on next sync:', e.message || e);
    }
  }

  async function deleteJobRemote(id) {
    if (!isReady()) return;
    try {
      const { error } = await supabaseClient.from('jobs').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('[sync] delete job remote failed:', e.message || e);
    }
  }

  // ---------- Full two-way sync ----------
  let pulling = false;
  async function pullAll() {
    if (!isReady() || pulling) return { ok: false, reason: 'not-ready' };
    pulling = true;
    setStatus({ state: 'syncing' });
    try {
      const [jobsRes, localJobs] = await Promise.all([
        supabaseClient.from('jobs').select('*'),
        DB.getJobs(),
      ]);
      if (jobsRes.error) throw jobsRes.error;
      const remoteJobs = jobsRes.data || [];
      const remoteJobsById = new Map(remoteJobs.map((rj) => [rj.id, rj]));
      const localJobsById = new Map(localJobs.map((lj) => [lj.id, lj]));

      for (const rj of remoteJobs) {
        const local = localJobsById.get(rj.id);
        if (!local || (rj.updated_at || 0) > (local.updatedAt || 0)) {
          await DB.putJobRaw(remoteJobToLocal(rj));
        }
      }
      for (const lj of localJobs) {
        const remote = remoteJobsById.get(lj.id);
        if (!remote || (lj.updatedAt || 0) > (remote.updated_at || 0)) {
          await pushJob(lj);
        }
      }

      const [reportsRes, localReports] = await Promise.all([
        supabaseClient.from('reports').select('*'),
        DB.getAllReports(),
      ]);
      if (reportsRes.error) throw reportsRes.error;
      const remoteReports = reportsRes.data || [];
      const remoteReportsByJobId = new Map(remoteReports.map((rr) => [rr.job_id, rr]));
      const localReportsByJobId = new Map(localReports.map((lr) => [lr.jobId, lr]));

      for (const rr of remoteReports) {
        const local = localReportsByJobId.get(rr.job_id);
        if (!local || (rr.updated_at || 0) > (local.updatedAt || 0)) {
          await DB.putReportRaw(remoteReportToLocal(rr, local));
        }
      }
      for (const lr of localReports) {
        const remote = remoteReportsByJobId.get(lr.jobId);
        if (!remote || (lr.updatedAt || 0) > (remote.updated_at || 0)) {
          await pushReport(lr);
        }
      }

      setStatus({ state: 'synced', lastSyncedAt: Date.now(), error: null });
      return { ok: true };
    } catch (e) {
      console.warn('[sync] full sync failed:', e.message || e);
      setStatus({ state: 'error', error: e.message || String(e) });
      return { ok: false, error: e };
    } finally {
      pulling = false;
    }
  }

  // ---------- Auth ----------
  async function getSession() {
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session;
    return currentSession;
  }

  async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentSession = data.session;
    return currentSession;
  }

  async function signOut() {
    await supabaseClient.auth.signOut();
    currentSession = null;
  }

  window.addEventListener('online', () => { pullAll(); });

  window.Sync = {
    getSession,
    signIn,
    signOut,
    onAuthChange,
    onStatusChange,
    pullAll,
    pushJob,
    pushReport,
    deleteJobRemote,
    currentUserId,
    isOnline,
    getStatus: () => syncStatus,
  };
})();
