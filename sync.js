// Cloud sync layer — talks to Supabase so job details and report data are
// available from any signed-in device. Photos and video stay local-only
// (IndexedDB), by design — only job/report fields sync.
//
// Every push is best-effort: if it fails (offline, etc.) it's silently
// skipped and reconciled by the next pullAll(), which does a full two-way
// sync using "most recently updated wins".
(() => {
  'use strict';

  // Test and demo modes never touch the cloud. Syncing from a browser that
  // holds a real session would pull production records into the sandbox and
  // push every fixture back up to the live database.
  if (window.IS_TEST || window.IS_DEMO) {
    console.warn('[sync] test/demo mode — cloud sync disabled.');
    return;
  }
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

  // Synchronous identity accessor, unlike getSession() which awaits a round
  // trip. The report audit log stamps who made a change while it is already
  // mid-write, and cannot await anything without racing the save it belongs to.
  function currentUser() {
    const user = currentSession && currentSession.user;
    return user ? { id: user.id || null, email: user.email || '' } : null;
  }

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
      next_due_at: job.nextDueAt || null,
      scheduled_at: job.scheduledAt || null,
      scheduled_duration_mins: job.scheduledDurationMins || null,
      recurring_from_id: job.recurringFromId || null,
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
      nextDueAt: rj.next_due_at || null,
      scheduledAt: rj.scheduled_at || null,
      scheduledDurationMins: rj.scheduled_duration_mins || 60,
      recurringFromId: rj.recurring_from_id || null,
      createdAt: rj.created_at,
      updatedAt: rj.updated_at,
    };
  }

  // A report "photos" field holds [{id, blob}] locally. Blobs can't go into a
  // JSONB column, so each one is uploaded to storage and the record keeps
  // {id, path} instead. Product-list entries are also arrays of objects, so
  // the test is the presence of a blob/path key rather than "is an array".
  function isMediaArray(val) {
    return Array.isArray(val) && val.length && val[0] && typeof val[0] === 'object'
      && ('blob' in val[0] || 'path' in val[0]);
  }

  // Uploads any not-yet-uploaded photo and returns the sections object with
  // {id, path} in place of {id, blob}. Also reports back which entries gained
  // a path, so the caller can record them locally and skip re-uploading the
  // same bytes on every single save.
  async function sectionsForPush(jobId, sections) {
    const out = {};
    const newPaths = []; // {sectionId, fieldId, photoId, path}
    for (const sectionId of Object.keys(sections || {})) {
      const values = sections[sectionId] || {};
      const cleanVals = {};
      for (const fieldId of Object.keys(values)) {
        const val = values[fieldId];
        if (!isMediaArray(val)) { cleanVals[fieldId] = val; continue; }
        cleanVals[fieldId] = [];
        for (const entry of val) {
          if (entry.path) { cleanVals[fieldId].push({ id: entry.id, path: entry.path }); continue; }
          if (!entry.blob || !window.Media) { cleanVals[fieldId].push({ id: entry.id }); continue; }
          const path = await window.Media.uploadBlob(
            window.Media.pathFor(jobId, 'report', `${sectionId}-${fieldId}-${entry.id}`, entry.blob),
            entry.blob
          );
          if (path) newPaths.push({ sectionId, fieldId, photoId: entry.id, path });
          cleanVals[fieldId].push(path ? { id: entry.id, path } : { id: entry.id });
        }
      }
      out[sectionId] = cleanVals;
    }
    return { sections: out, newPaths };
  }

  // Remote carries {id, path}; this device may or may not hold the bytes.
  // Keep the local blob when we have it (no reason to re-download), and carry
  // the path forward either way so a device without the blob can fetch it.
  function mergeRemoteSections(remoteSections, localSections) {
    const merged = {};
    const ids = new Set([...Object.keys(remoteSections || {}), ...Object.keys(localSections || {})]);
    for (const sectionId of ids) {
      const remoteVals = (remoteSections && remoteSections[sectionId]) || {};
      const localVals = (localSections && localSections[sectionId]) || {};
      const mergedVals = { ...remoteVals };
      for (const fieldId of Object.keys(mergedVals)) {
        const val = mergedVals[fieldId];
        // Legacy placeholder from before media backup existed — the bytes were
        // never uploaded, so this device's copy is the only one there is.
        if (val && typeof val === 'object' && !Array.isArray(val) && '__localPhotoCount' in val) {
          mergedVals[fieldId] = localVals[fieldId] !== undefined ? localVals[fieldId] : [];
          continue;
        }
        if (!isMediaArray(val)) continue;
        const localById = new Map((localVals[fieldId] || []).map((p) => [p.id, p]));
        mergedVals[fieldId] = val.map((remoteEntry) => {
          const local = localById.get(remoteEntry.id);
          return local && local.blob
            ? { ...remoteEntry, blob: local.blob }
            : { ...remoteEntry };
        });
      }
      merged[sectionId] = mergedVals;
    }
    return merged;
  }

  // Flipped the first time the server rejects audit_log/schema_version because
  // migration 008 hasn't been run against this project yet. Without this, every
  // report push would fail from the moment this build ships until someone runs
  // the migration — losing ordinary report sync to protect a new column. The
  // audit trail still exists locally and pushes as soon as the column does.
  let reportAuditColumnsMissing = false;

  function localReportToRemote(report, pushedSections) {
    const row = {
      job_id: report.jobId,
      sections: pushedSections,
      // aiDraft is text-only (transcript + suggested field values) — no
      // blobs involved, so unlike sections it needs no sanitizing before push.
      ai_draft: report.aiDraft || null,
      finalized_at: report.finalizedAt || null,
      updated_by: currentUserId(),
      updated_at: report.updatedAt || Date.now(),
    };
    if (!reportAuditColumnsMissing) {
      row.audit_log = Array.isArray(report.auditLog) ? report.auditLog : [];
      row.schema_version = report.schemaVersion || null;
    }
    return row;
  }

  // PostgREST answers an unknown column with PGRST204 and a message naming it.
  function isMissingColumnError(error) {
    if (!error) return false;
    const code = error.code || '';
    const msg = String(error.message || '');
    return code === 'PGRST204' || /audit_log|schema_version/.test(msg);
  }

  function remoteReportToLocal(rr, existingLocal) {
    return {
      jobId: rr.job_id,
      sections: mergeRemoteSections(rr.sections, existingLocal ? existingLocal.sections : {}),
      aiDraft: rr.ai_draft || (existingLocal ? existingLocal.aiDraft : null),
      finalizedAt: rr.finalized_at || null,
      // The audit log only ever grows, and each device may hold events the
      // other has never seen — a plain last-write-wins overwrite here would
      // erase exactly the history the log exists to preserve. Union by
      // timestamp+event+field instead, so no device can destroy another's
      // record of a change.
      auditLog: mergeAuditLogs(rr.audit_log, existingLocal ? existingLocal.auditLog : null),
      schemaVersion: rr.schema_version || (existingLocal ? existingLocal.schemaVersion : null),
      updatedAt: rr.updated_at,
    };
  }

  function mergeAuditLogs(remote, local) {
    const all = [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])];
    const seen = new Set();
    const merged = [];
    for (const entry of all) {
      if (!entry || typeof entry !== 'object') continue;
      const key = `${entry.at}|${entry.event}|${entry.sectionId || ''}|${entry.fieldId || ''}|${entry.to || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
    return merged.sort((a, b) => (a.at || 0) - (b.at || 0));
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
      const { sections, newPaths } = await sectionsForPush(report.jobId, report.sections);
      let { error } = await supabaseClient.from('reports').upsert(localReportToRemote(report, sections));
      if (error && !reportAuditColumnsMissing && isMissingColumnError(error)) {
        reportAuditColumnsMissing = true;
        console.warn('[sync] reports.audit_log / schema_version not in the database yet — run supabase-migration-008-audit-trail.sql. Report sync continues without them.');
        ({ error } = await supabaseClient.from('reports').upsert(localReportToRemote(report, sections)));
      }
      if (error) throw error;
      // Record the storage paths locally so the next save doesn't re-upload
      // bytes that are already backed up. putReportRaw deliberately does NOT
      // re-trigger a push, which would otherwise loop forever.
      if (newPaths.length) {
        const local = await DB.getReport(report.jobId);
        if (local) {
          for (const { sectionId, fieldId, photoId, path } of newPaths) {
            const arr = local.sections && local.sections[sectionId] && local.sections[sectionId][fieldId];
            if (!Array.isArray(arr)) continue;
            const entry = arr.find((p) => p.id === photoId);
            if (entry) entry.path = path;
          }
          await DB.putReportRaw(local);
        }
      }
    } catch (e) {
      console.warn('[sync] push report failed, will retry on next sync:', e.message || e);
    }
  }

  // ---------- Captures & footage ----------
  // Metadata goes to Postgres, bytes go to storage. The upload happens first
  // so the row is never written claiming a path that doesn't exist yet.
  async function pushCapture(capture) {
    if (!isReady()) return;
    try {
      let photoPath = capture.photoPath || null;
      let audioPath = capture.audioPath || null;
      if (window.Media) {
        if (!photoPath && capture.photoBlob) {
          photoPath = await window.Media.uploadBlob(
            window.Media.pathFor(capture.jobId, 'capture', capture.id, capture.photoBlob), capture.photoBlob);
        }
        if (!audioPath && capture.audioBlob) {
          audioPath = await window.Media.uploadBlob(
            window.Media.pathFor(capture.jobId, 'memo', capture.id, capture.audioBlob), capture.audioBlob);
        }
      }
      const { error } = await supabaseClient.from('captures').upsert({
        id: capture.id,
        job_id: capture.jobId,
        zone: capture.zone || '',
        type: capture.type || 'photo',
        note: capture.note || '',
        suggested_zone: capture.suggestedZone || '',
        photo_path: photoPath,
        audio_path: audioPath,
        created_at: capture.createdAt,
        updated_at: capture.updatedAt || capture.createdAt,
        created_by: currentUserId(),
      });
      if (error) throw error;
      // Remember the paths so the next edit doesn't re-upload the same bytes.
      if (photoPath !== (capture.photoPath || null) || audioPath !== (capture.audioPath || null)) {
        await DB.putCaptureRaw({ ...capture, photoPath, audioPath });
      }
    } catch (e) {
      console.warn('[sync] push capture failed, will retry on next sync:', e.message || e);
    }
  }

  async function pushFootage(item) {
    if (!isReady()) return;
    try {
      let blobPath = item.blobPath || null;
      if (window.Media && !blobPath && item.blob) {
        blobPath = await window.Media.uploadBlob(
          window.Media.pathFor(item.jobId, 'footage', item.id, item.blob), item.blob);
      }
      const { error } = await supabaseClient.from('footage').upsert({
        id: item.id,
        job_id: item.jobId,
        zone: item.zone || '',
        source: item.source || 'live',
        kind: item.kind || 'video',
        file_name: item.fileName || '',
        note: item.note || '',
        blob_path: blobPath,
        created_at: item.createdAt,
        updated_at: item.updatedAt || item.createdAt,
        created_by: currentUserId(),
      });
      if (error) throw error;
      if (blobPath !== (item.blobPath || null)) {
        await DB.putFootageRaw({ ...item, blobPath });
      }
    } catch (e) {
      console.warn('[sync] push footage failed, will retry on next sync:', e.message || e);
    }
  }

  function remoteCaptureToLocal(rc, existingLocal) {
    return {
      id: rc.id,
      jobId: rc.job_id,
      zone: rc.zone || '',
      type: rc.type || 'photo',
      note: rc.note || '',
      suggestedZone: rc.suggested_zone || '',
      photoPath: rc.photo_path || null,
      audioPath: rc.audio_path || null,
      // Bytes are fetched separately by pullMissingMedia — keep whatever this
      // device already holds rather than dropping it or re-downloading.
      photoBlob: existingLocal ? existingLocal.photoBlob || null : null,
      audioBlob: existingLocal ? existingLocal.audioBlob || null : null,
      createdAt: rc.created_at,
      updatedAt: rc.updated_at,
    };
  }

  function remoteFootageToLocal(rf, existingLocal) {
    return {
      id: rf.id,
      jobId: rf.job_id,
      zone: rf.zone || '',
      source: rf.source || 'live',
      kind: rf.kind || 'video',
      fileName: rf.file_name || '',
      note: rf.note || '',
      blobPath: rf.blob_path || null,
      blob: existingLocal ? existingLocal.blob || null : null,
      createdAt: rf.created_at,
      updatedAt: rf.updated_at,
    };
  }

  async function deleteCaptureRemote(id) {
    if (!isReady()) return;
    try { await supabaseClient.from('captures').delete().eq('id', id); }
    catch (e) { console.warn('[sync] delete capture remote failed:', e.message || e); }
  }

  async function deleteFootageRemote(id) {
    if (!isReady()) return;
    try { await supabaseClient.from('footage').delete().eq('id', id); }
    catch (e) { console.warn('[sync] delete footage remote failed:', e.message || e); }
  }

  async function pushInvoice(invoice) {
    if (!isReady()) return;
    try {
      const { error } = await supabaseClient.from('invoices').upsert({
        id: invoice.id,
        job_id: invoice.jobId,
        number: invoice.number,
        issue_date: invoice.issueDate,
        due_date: invoice.dueDate,
        client_name: invoice.clientName || '',
        client_email: invoice.clientEmail || '',
        property_address: invoice.propertyAddress || '',
        reference: invoice.reference || '',
        line_items: invoice.lineItems || [],
        gst_registered: invoice.gstRegistered !== false,
        status: invoice.status || 'draft',
        xero_invoice_id: invoice.xeroInvoiceId || null,
        xero_status: invoice.xeroStatus || null,
        created_at: invoice.createdAt,
        updated_at: invoice.updatedAt || invoice.createdAt,
        created_by: currentUserId(),
      });
      if (error) throw error;
    } catch (e) {
      console.warn('[sync] push invoice failed, will retry on next sync:', e.message || e);
    }
  }

  function remoteInvoiceToLocal(ri) {
    return {
      id: ri.id,
      jobId: ri.job_id,
      number: ri.number,
      issueDate: ri.issue_date,
      dueDate: ri.due_date,
      clientName: ri.client_name || '',
      clientEmail: ri.client_email || '',
      propertyAddress: ri.property_address || '',
      reference: ri.reference || '',
      lineItems: ri.line_items || [],
      gstRegistered: ri.gst_registered !== false,
      status: ri.status || 'draft',
      xeroInvoiceId: ri.xero_invoice_id || null,
      xeroStatus: ri.xero_status || null,
      createdAt: ri.created_at,
      updatedAt: ri.updated_at,
    };
  }

  async function deleteInvoiceRemote(id) {
    if (!isReady()) return;
    try { await supabaseClient.from('invoices').delete().eq('id', id); }
    catch (e) { console.warn('[sync] delete invoice remote failed:', e.message || e); }
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

  // Generic last-write-wins reconcile for the id-keyed collections. Jobs and
  // reports predate this and keep their own bespoke passes; captures and
  // footage share this one so the two can't drift apart.
  async function syncCollection({ table, localAll, toLocal, putRaw, push }) {
    const res = await supabaseClient.from(table).select('*');
    if (res.error) throw res.error;
    const remote = res.data || [];
    const remoteById = new Map(remote.map((r) => [r.id, r]));
    const localById = new Map(localAll.map((l) => [l.id, l]));

    for (const r of remote) {
      const local = localById.get(r.id);
      if (!local || (r.updated_at || 0) > (local.updatedAt || 0)) {
        await putRaw(toLocal(r, local));
      }
    }
    for (const l of localAll) {
      const r = remoteById.get(l.id);
      if (!r || (l.updatedAt || 0) > (r.updated_at || 0)) {
        await push(l);
      }
    }
  }

  // Downloads any bytes this device is missing but the server has. This is
  // what makes a replacement phone — or a second technician's phone — able to
  // actually see the evidence, rather than just a list of records describing
  // photos it doesn't hold.
  async function pullMissingMedia() {
    if (!window.Media) return;
    try {
      for (const capture of await DB.getAllCaptures()) {
        let changed = false;
        const next = { ...capture };
        if (!next.photoBlob && next.photoPath) {
          const blob = await window.Media.downloadBlob(next.photoPath);
          if (blob) { next.photoBlob = blob; changed = true; }
        }
        if (!next.audioBlob && next.audioPath) {
          const blob = await window.Media.downloadBlob(next.audioPath);
          if (blob) { next.audioBlob = blob; changed = true; }
        }
        if (changed) await DB.putCaptureRaw(next);
      }

      for (const item of await DB.getAllFootage()) {
        if (item.blob || !item.blobPath) continue;
        const blob = await window.Media.downloadBlob(item.blobPath);
        if (blob) await DB.putFootageRaw({ ...item, blob });
      }

      for (const report of await DB.getAllReports()) {
        let changed = false;
        for (const sectionId of Object.keys(report.sections || {})) {
          const values = report.sections[sectionId] || {};
          for (const fieldId of Object.keys(values)) {
            const val = values[fieldId];
            if (!isMediaArray(val)) continue;
            for (const entry of val) {
              if (entry.blob || !entry.path) continue;
              const blob = await window.Media.downloadBlob(entry.path);
              if (blob) { entry.blob = blob; changed = true; }
            }
          }
        }
        if (changed) await DB.putReportRaw(report);
      }
    } catch (e) {
      console.warn('[sync] media download pass failed:', e.message || e);
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

      await syncCollection({
        table: 'captures',
        localAll: await DB.getAllCaptures(),
        toLocal: remoteCaptureToLocal,
        putRaw: (rec) => DB.putCaptureRaw(rec),
        push: pushCapture,
      });

      await syncCollection({
        table: 'footage',
        localAll: await DB.getAllFootage(),
        toLocal: remoteFootageToLocal,
        putRaw: (rec) => DB.putFootageRaw(rec),
        push: pushFootage,
      });

      await syncCollection({
        table: 'invoices',
        localAll: await DB.getAllInvoices(),
        toLocal: remoteInvoiceToLocal,
        putRaw: (rec) => DB.putInvoiceRaw(rec),
        push: pushInvoice,
      });

      // Records are cheap and now consistent; bytes are expensive, so they're
      // fetched last and failures here don't fail the sync.
      await pullMissingMedia();

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
    currentUser,
    signIn,
    signOut,
    onAuthChange,
    onStatusChange,
    pullAll,
    pushJob,
    pushReport,
    pushCapture,
    pushFootage,
    pushInvoice,
    deleteJobRemote,
    deleteCaptureRemote,
    deleteFootageRemote,
    deleteInvoiceRemote,
    currentUserId,
    isOnline,
    getStatus: () => syncStatus,
  };
})();
