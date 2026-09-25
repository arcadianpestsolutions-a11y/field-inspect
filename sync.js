// Cloud sync layer — talks to Supabase so job details, report data, photos
// and invoices are available from any signed-in device.
//
// The header used to say "photos and video stay local-only, by design". That
// stopped being true at migration 004, which added the captures and footage
// tables and the inspection-media storage bucket: metadata rows go to
// Postgres and the bytes go to storage. Left uncorrected, that one stale
// sentence is the difference between believing your photos are backed up and
// knowing they are.
//
// Every push is best-effort: if it fails (offline, etc.) it's silently
// skipped and reconciled by the next pullAll(), which does a full two-way
// sync using "most recently updated wins". A collection that cannot sync at
// all no longer aborts the ones after it — see fullSync.
(() => {
  'use strict';

  // ---------- What the technician reads when sync goes wrong ----------
  // Deliberately above the test/demo and configuration guards below:
  // these are pure text, they depend on nothing, and the suite has to be
  // able to assert on the exact wording without a live Supabase session.
  // The whole-sync failure case: jobs or reports themselves would not load.
  // Those two are the spine — a capture references a job, a report belongs to
  // one — so unlike the collections below, there is no sensible way to carry
  // on without them.
  function fatalSyncText(err) {
    const msg = (err && (err.message || err.details)) || String(err || '');
    if (err && err.code === '42501') {
      return 'Signed in, but this account cannot reach the cloud records yet. '
        + 'Everything you do is saved on this device in the meantime. '
        + `This needs fixing on the server (${msg}).`;
    }
    if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) {
      return 'Could not reach the server. Your work is saved on this device '
        + 'and will back up on its own once you have signal.';
    }
    if (/JWT|token|session|expired/i.test(msg)) {
      return 'Your login has expired. Log out and back in to start backing up '
        + 'again — nothing on this device is lost in the meantime.';
    }
    return 'Backup did not run this time. Your work is saved on this device '
      + 'and the app will try again shortly.';
  }

  // What a technician sees when a table refuses to sync. The raw Postgres
  // string ("permission denied for table captures") tells them nothing they
  // can act on, and worse, it reads like the photos are gone — the one thing
  // that is never true here, because every capture is already written to
  // IndexedDB on the device before sync is even attempted.
  // Plural throughout: the sentence is always "Your X are saved on this
  // device", and "your video are saved" is the kind of thing a client would
  // notice if it ever made it onto a report.
  const TABLE_NAMES = { captures: 'photos', footage: 'videos', invoices: 'invoices' };

  function syncFailureText(failed) {
    const names = failed.map((f) => TABLE_NAMES[f.table] || f.table);
    const what = names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    // 42501 is Postgres for "no privilege on this table". It is a setup
    // problem on the server, not something a retry or a reinstall fixes, so
    // say so plainly and name the tables for whoever has to fix it.
    const denied = failed.filter((f) => f.error && f.error.code === '42501');
    if (denied.length === failed.length) {
      return `Your ${what} are saved on this device but aren't backing up yet — `
        + `the cloud account doesn't have permission to store them. Nothing is lost. `
        + `This needs fixing on the server (${denied.map((f) => f.table).join(', ')}: 42501).`;
    }
    const offline = failed.some((f) => /fetch|network|Failed to fetch/i.test(
      (f.error && (f.error.message || f.error.details)) || ''));
    if (offline) {
      return `Your ${what} are saved on this device. The server couldn't be reached, `
        + `so they'll upload next time you have signal.`;
    }
    return `Your ${what} are saved on this device but didn't back up this time. `
      + `The app will try again automatically.`;
  }

  window.SyncMessages = { syncFailureText, fatalSyncText };

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

  // ---------- Role ----------
  // Mirrors public.user_roles (migration 016). The server is what actually
  // enforces this — every policy checks is_admin() in Postgres, and nothing
  // here can grant a permission the database will not honour. This copy
  // exists only so the app can avoid offering a technician buttons that
  // would fail: a greyed-out Invoice button is a courtesy, not a lock.
  //
  // Defaults to 'technician', the restricted role, so a failed lookup or a
  // missing row never hands out admin rights by accident.
  let currentRole = 'technician';

  async function refreshRole() {
    const uid = currentUserId();
    if (!uid) { currentRole = 'technician'; return currentRole; }
    try {
      const { data, error } = await supabaseClient
        .from('user_roles').select('role').eq('user_id', uid).maybeSingle();
      // A project that has not run migration 016 yet has no user_roles table
      // at all. Everyone there is still effectively an admin, and treating
      // them as a technician would hide invoicing from a solo operator who
      // has done nothing wrong — so an absent table means admin.
      if (error) {
        currentRole = /relation .* does not exist|could not find the table|schema cache/i.test(error.message || '')
          ? 'admin'
          : 'technician';
        return currentRole;
      }
      currentRole = (data && data.role === 'admin') ? 'admin' : 'technician';
    } catch (e) {
      currentRole = 'technician';
    }
    return currentRole;
  }

  function role() { return currentRole; }
  function isAdmin() { return currentRole === 'admin'; }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    // Role first, then listeners: app.js rebuilds its UI from these, and
    // doing it the other way round renders the wrong buttons for a moment.
    refreshRole().finally(() => {
      authListeners.forEach((fn) => { try { fn(session); } catch (e) { /* ignore listener errors */ } });
    });
  });

  // ---------- Field <-> column mapping ----------
  function localJobToRemote(job) {
    const row = {
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
    if (!jobExtraColumnsMissing) {
      // Newer columns (migrations 011-013) a project may not have run yet —
      // see pushJob's retry-without-these fallback, same pattern pushReport
      // already uses for audit_log/schema_version/document_type.
      row.reinspection_interval_months = job.reinspectionIntervalMonths || null;
      row.reminder_sent_for_due_at = job.reminderSentForDueAt || null;
      row.assigned_to = job.assignedTo || '';
      row.recurrence_months = job.recurrenceMonths || null;
    }
    return row;
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
      reinspectionIntervalMonths: rj.reinspection_interval_months || null,
      recurrenceMonths: rj.recurrence_months || null,
      // Only ever written server-side, by send-due-reminders — the app
      // itself never sets this locally, it only reads it back to decide
      // whether an overdue job in the backlog has already had its email
      // and should now read as "needs a call" rather than plain overdue.
      reminderSentForDueAt: rj.reminder_sent_for_due_at || null,
      scheduledAt: rj.scheduled_at || null,
      scheduledDurationMins: rj.scheduled_duration_mins || 60,
      recurringFromId: rj.recurring_from_id || null,
      assignedTo: rj.assigned_to || '',
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

  // Flipped the first time the server rejects one of these newer report
  // columns because its migration hasn't been run against this project
  // yet: audit_log/schema_version (008), document_type (015). Without this,
  // every report push would fail outright the moment this build ships,
  // until someone runs the migration — losing ordinary report sync to
  // protect a column nobody's asked for yet. Everything still exists
  // locally and pushes as soon as the column does.
  let reportAuditColumnsMissing = false;
  // Same idea, for jobs' own newer columns: assigned_to (013),
  // reinspection_interval_months (012), reminder_sent_for_due_at (011).
  let jobExtraColumnsMissing = false;

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
      // Which of a termite job's four possible documents this report
      // actually is (see DOCUMENT_TYPES in report.js). Never synced before
      // migration 015 — a report pulled down on a second device, or after
      // this device's own local DB was rebuilt, silently reverted to
      // undefined, which is exactly the kind of thing that makes a
      // certificate quietly start rendering as a standard inspection. Kept
      // behind the same flag as the other two: if this migration hasn't
      // run either, it needs to drop out of the retry the same way.
      row.document_type = report.documentType || null;
      // Set once EmailService.sendReportEmail succeeds (see report.js's
      // emailReport) — check-email-status reads emailProviderId back from
      // Resend on demand. Migration 014.
      row.email_provider_id = report.emailProviderId || null;
      row.emailed_at = report.emailedAt || null;
      row.email_status = report.emailStatus || null;
    }
    return row;
  }

  // PostgREST answers an unknown column with PGRST204 — the generic code
  // covers any column name, which is why nothing here needs to list them.
  function isMissingColumnError(error) {
    if (!error) return false;
    const code = error.code || '';
    const msg = String(error.message || '');
    return code === 'PGRST204' || /audit_log|schema_version|document_type/.test(msg);
  }

  function remoteReportToLocal(rr, existingLocal) {
    return {
      jobId: rr.job_id,
      sections: mergeRemoteSections(rr.sections, existingLocal ? existingLocal.sections : {}),
      aiDraft: rr.ai_draft || (existingLocal ? existingLocal.aiDraft : null),
      finalizedAt: rr.finalized_at || null,
      // Falls back to whatever this device already had if an older row
      // (synced before migration 014, or a remote still missing the
      // column) doesn't carry it — never to undefined, which is the
      // silent-revert-to-inspection bug this column exists to close.
      documentType: rr.document_type || (existingLocal ? existingLocal.documentType : null),
      emailProviderId: rr.email_provider_id || (existingLocal ? existingLocal.emailProviderId : null),
      emailedAt: rr.emailed_at || (existingLocal ? existingLocal.emailedAt : null),
      emailStatus: rr.email_status || (existingLocal ? existingLocal.emailStatus : null),
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

  // ---------- Tombstones ----------
  // The other half of a delete. Without one, pullAll's push-back branch sees
  // a local record the cloud lacks and helpfully re-uploads it, so deleting
  // anything only lasts until the next device syncs. See migration 018.
  let deletionsTableMissing = false;

  async function pushTombstone(table, recordId) {
    if (!isReady() || deletionsTableMissing) return false;
    try {
      const { error } = await supabaseClient.from('deletions').upsert({
        table_name: table,
        record_id: recordId,
        deleted_at: Date.now(),
        deleted_by: currentUserId(),
      });
      if (error) {
        if (/relation .* does not exist|could not find the table|schema cache/i.test(error.message || '')) {
          deletionsTableMissing = true;
          console.warn('[sync] deletions table not in the database yet — run supabase-migration-018-deletions.sql. '
            + 'Until then a delete will not stick across devices.');
          return false;
        }
        throw error;
      }
      await DB.markDeletionSynced(`${table}:${recordId}`);
      return true;
    } catch (e) {
      // Left unsynced on purpose — flushPendingTombstones retries it.
      console.warn('[sync] could not record deletion, will retry:', e.message || e);
      return false;
    }
  }

  // Deletes made while offline never reached the server. Without this they
  // stay local-only, and the next pull cheerfully downloads the record again
  // — a delete that undoes itself as soon as you have signal.
  async function flushPendingTombstones() {
    if (!isReady() || deletionsTableMissing) return;
    const pending = await DB.getUnsyncedDeletions().catch(() => []);
    for (const t of pending) {
      await pushTombstone(t.table, t.recordId);
    }
  }

  // Applies tombstones from other devices: anything deleted elsewhere is
  // removed here too, and recorded locally so the push-back branch below
  // knows not to re-upload it.
  const LOCAL_DELETERS = {
    jobs: (id) => DB.deleteJobLocalOnly(id),
    reports: (id) => DB.deleteReportLocalOnly(id),
    captures: (id) => DB.deleteCaptureLocalOnly(id),
    footage: (id) => DB.deleteFootageLocalOnly(id),
    invoices: (id) => DB.deleteInvoiceLocalOnly(id),
  };

  async function applyRemoteTombstones() {
    if (!isReady() || deletionsTableMissing) return 0;
    try {
      const { data, error } = await supabaseClient.from('deletions').select('*');
      if (error) {
        if (/relation .* does not exist|could not find the table|schema cache/i.test(error.message || '')) {
          deletionsTableMissing = true;
          return 0;
        }
        throw error;
      }
      let applied = 0;
      for (const row of data || []) {
        const known = await DB.isDeleted(row.table_name, row.record_id);
        await DB.recordRemoteDeletion(row.table_name, row.record_id, row.deleted_at);
        if (known) continue;
        const remove = LOCAL_DELETERS[row.table_name];
        if (remove) { await remove(row.record_id).catch(() => {}); applied++; }
      }
      return applied;
    } catch (e) {
      console.warn('[sync] could not read deletions:', e.message || e);
      return 0;
    }
  }

  // ---------- Push (best effort, called from db.js after every local write) ----------

  // A row-level policy that refuses an UPDATE does not raise an error.
  // Postgres updates zero rows, PostgREST reports success, and supabase-js
  // hands back { error: null }. On an offline-first app that is the worst
  // shape a failure can take: the edit is already saved locally, the screen
  // says saved, and it never reaches the cloud — the exact silent loss the
  // rest of this file exists to prevent. Asking for the written rows back
  // (.select()) is the only way to tell "stored" from "silently refused",
  // which since migration 016 is what a technician editing somebody else's
  // job actually gets.
  function refusedByPolicy(data) {
    return Array.isArray(data) && data.length === 0;
  }

  function reportPolicyRefusal(table, id) {
    const message = 'Not saved to the cloud — this job belongs to another technician. '
      + 'It is still on this device. Ask whoever it is assigned to, or have it reassigned to you.';
    console.warn(`[sync] ${table} ${id} refused by a row-level policy — not backed up.`);
    setStatus({ state: 'partial', lastSyncedAt: syncStatus.lastSyncedAt, error: message });
    if (window.appToast) window.appToast(message);
  }

  async function pushJob(job) {
    if (!isReady()) return;
    try {
      let { data, error } = await supabaseClient.from('jobs').upsert(localJobToRemote(job)).select('id');
      if (error && !jobExtraColumnsMissing && isMissingColumnError(error)) {
        jobExtraColumnsMissing = true;
        console.warn('[sync] jobs.assigned_to / reinspection_interval_months / reminder_sent_for_due_at not in the database yet — run migrations 011-013. Job sync continues without them.');
        ({ data, error } = await supabaseClient.from('jobs').upsert(localJobToRemote(job)).select('id'));
      }
      if (error) throw error;
      if (refusedByPolicy(data)) reportPolicyRefusal('job', job.id);
    } catch (e) {
      console.warn('[sync] push job failed, will retry on next sync:', e.message || e);
    }
  }

  async function pushReport(report) {
    if (!isReady()) return;
    try {
      const { sections, newPaths } = await sectionsForPush(report.jobId, report.sections);
      let { data, error } = await supabaseClient.from('reports').upsert(localReportToRemote(report, sections)).select('job_id');
      if (error && !reportAuditColumnsMissing && isMissingColumnError(error)) {
        reportAuditColumnsMissing = true;
        console.warn('[sync] reports.audit_log / schema_version not in the database yet — run supabase-migration-008-audit-trail.sql. Report sync continues without them.');
        ({ data, error } = await supabaseClient.from('reports').upsert(localReportToRemote(report, sections)).select('job_id'));
      }
      if (error) throw error;
      if (refusedByPolicy(data)) reportPolicyRefusal('report', report.jobId);
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
    await pushTombstone('captures', id);
  }

  async function deleteFootageRemote(id) {
    if (!isReady()) return;
    try { await supabaseClient.from('footage').delete().eq('id', id); }
    catch (e) { console.warn('[sync] delete footage remote failed:', e.message || e); }
    await pushTombstone('footage', id);
  }

  // Same reasoning as reportAuditColumnsMissing/jobExtraColumnsMissing —
  // migration 014's email_provider_id/emailed_at/email_status columns may
  // not exist on this project yet.
  let invoiceExtraColumnsMissing = false;

  function localInvoiceToRemote(invoice) {
    const row = {
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
    };
    if (!invoiceExtraColumnsMissing) {
      row.email_provider_id = invoice.emailProviderId || null;
      row.emailed_at = invoice.emailedAt || null;
      row.email_status = invoice.emailStatus || null;
    }
    return row;
  }

  async function pushInvoice(invoice) {
    if (!isReady()) return;
    try {
      let { error } = await supabaseClient.from('invoices').upsert(localInvoiceToRemote(invoice));
      if (error && !invoiceExtraColumnsMissing && isMissingColumnError(error)) {
        invoiceExtraColumnsMissing = true;
        console.warn('[sync] invoices.email_provider_id / emailed_at / email_status not in the database yet — run supabase-migration-014-email-delivery-tracking.sql. Invoice sync continues without them.');
        ({ error } = await supabaseClient.from('invoices').upsert(localInvoiceToRemote(invoice)));
      }
      if (error) throw error;
    } catch (e) {
      console.warn('[sync] push invoice failed, will retry on next sync:', e.message || e);
    }
  }

  function remoteInvoiceToLocal(ri, existingLocal) {
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
      emailProviderId: ri.email_provider_id || (existingLocal ? existingLocal.emailProviderId : null),
      emailedAt: ri.emailed_at || (existingLocal ? existingLocal.emailedAt : null),
      emailStatus: ri.email_status || (existingLocal ? existingLocal.emailStatus : null),
      createdAt: ri.created_at,
      updatedAt: ri.updated_at,
    };
  }

  async function deleteInvoiceRemote(id) {
    if (!isReady()) return;
    try { await supabaseClient.from('invoices').delete().eq('id', id); }
    catch (e) { console.warn('[sync] delete invoice remote failed:', e.message || e); }
    await pushTombstone('invoices', id);
  }

  async function deleteJobRemote(id) {
    if (!isReady()) return;
    try {
      const { error } = await supabaseClient.from('jobs').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn('[sync] delete job remote failed:', e.message || e);
    }
    // The job cascades server-side, but other devices hold their own
    // copies of the children and would push them back as orphans.
    await pushTombstone('jobs', id);
    await pushTombstone('reports', id);
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
      // A record the server does not have is either new here, or
      // deleted there. Only a tombstone can tell the two apart —
      // without this check the push below resurrects it.
      if (await DB.isDeleted(table, l.id)) continue;
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
      // Before anything else: send deletions this device made while
      // offline, then apply deletions made elsewhere. Doing this first
      // means the push-back branches below already know what is gone,
      // instead of dutifully re-uploading it.
      await flushPendingTombstones();
      await applyRemoteTombstones();
    } catch (e) { console.warn('[sync] tombstone pass failed:', e.message || e); }
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
        if (await DB.isDeleted('jobs', lj.id)) continue;
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
        if (await DB.isDeleted('reports', lr.jobId)) continue;
        const remote = remoteReportsByJobId.get(lr.jobId);
        if (!remote || (lr.updatedAt || 0) > (remote.updated_at || 0)) {
          await pushReport(lr);
        }
      }

      // Each collection is reconciled independently. Before, one failing
      // table threw straight out of fullSync, so a permission problem on
      // captures also silently skipped footage, invoices and the media
      // backup below it — the sync looked like one broken thing when four
      // were being missed. A failure here is recorded and the rest continues.
      const failed = [];
      const collections = [
        {
          table: 'captures',
          localAll: () => DB.getAllCaptures(),
          toLocal: remoteCaptureToLocal,
          putRaw: (rec) => DB.putCaptureRaw(rec),
          push: pushCapture,
        },
        {
          table: 'footage',
          localAll: () => DB.getAllFootage(),
          toLocal: remoteFootageToLocal,
          putRaw: (rec) => DB.putFootageRaw(rec),
          push: pushFootage,
        },
        {
          table: 'invoices',
          localAll: () => DB.getAllInvoices(),
          toLocal: remoteInvoiceToLocal,
          putRaw: (rec) => DB.putInvoiceRaw(rec),
          push: pushInvoice,
        },
      ];

      for (const c of collections) {
        try {
          await syncCollection({ ...c, localAll: await c.localAll() });
        } catch (e) {
          console.warn(`[sync] ${c.table} did not sync:`, e.message || e);
          failed.push({ table: c.table, error: e });
        }
      }

      // Records are cheap and now consistent; bytes are expensive, so they're
      // fetched last and failures here don't fail the sync.
      await pullMissingMedia();

      if (failed.length) {
        setStatus({ state: 'partial', lastSyncedAt: Date.now(), error: syncFailureText(failed) });
        return { ok: false, partial: true, failed: failed.map((f) => f.table) };
      }

      setStatus({ state: 'synced', lastSyncedAt: Date.now(), error: null });
      return { ok: true };
    } catch (e) {
      console.warn('[sync] full sync failed:', e.message || e);
      // The raw message stays in the console for whoever is debugging; the
      // technician gets something that answers the only question they have,
      // which is whether their work is safe.
      setStatus({ state: 'error', error: fatalSyncText(e) });
      return { ok: false, error: e };
    } finally {
      pulling = false;
    }
  }

  // ---------- Auth ----------
  async function getSession() {
    const { data } = await supabaseClient.auth.getSession();
    currentSession = data.session;
    // A restored session skips onAuthStateChange, so without this the app
    // boots showing a technician every admin button until something else
    // happens to refresh it.
    if (currentSession) await refreshRole();
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
    // Role is enforced by Postgres policies (migration 016); these only let
    // the app avoid offering buttons the database would refuse.
    role,
    isAdmin,
    refreshRole,
    // Exposed so the suite can assert on the wording a technician actually
    // reads, rather than on the Postgres codes behind it.
    syncFailureText,
    fatalSyncText,
  };
})();
