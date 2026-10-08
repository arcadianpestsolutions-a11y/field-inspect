// Minimal IndexedDB wrapper — no dependencies.
// Stores:
//   jobs      (id, name, address, notes, clientPhone, clientEmail, status,
//              inspectionDate, inspectionTime, weather, createdAt, updatedAt)
//   captures  (id, jobId, zone, type: 'photo'|'memo', photoBlob?, audioBlob?, createdAt)
//   reports   (jobId [key], sections: {sectionId: {fieldId: value}}, sectionStatus,
//              aiDraft, finalizedAt, updatedAt)
//   sectionDrafts (id [key: `${jobId}::${sectionId}`], jobId, sectionId, values,
//              savedAt) — see report.js's autosave. Local-only, never synced,
//              never audited: a draft is unconfirmed work-in-progress, not an
//              answer. It exists purely so a phone lock, a low battery, or the
//              OS killing a backgrounded tab doesn't erase ten minutes of
//              typed findings that were never near the Save button.

// A page loaded with ?test=1 gets its own IndexedDB so the automated test
// suite (tests/run-tests.html) never touches real job data.
// ?test=1 gets an isolated DB for the automated suite; ?demo=1 gets another
// for handing the app to someone to try. Neither can touch real job data.
const __params = new URLSearchParams(location.search);
window.IS_DEMO = __params.get('demo') === '1';
// Test mode is local-only, exactly like demo mode. Without this, running the
// suite on a browser that happens to hold a live session pulls production
// records into the test database AND pushes every test fixture up to the real
// one — which is precisely what happened.
//
// tests/run-tests.html itself (not just the app-under-test iframe it loads
// via ?test=1) also calls DB.addJob directly for its own DB-layer tests —
// and its OWN address bar has never carried ?test=1, only a cache-busting
// query the operator remembers to add or doesn't. Found by checking a real
// device's job list and finding 32 copies of "Test Job A", "Older", "Newer"
// and "Filter Status Job" sitting in it: the query-string check alone had
// been silently writing test fixtures into the same local database the real
// app reads from, on every single run of the suite. A page loaded from
// /tests/ is unconditionally test mode regardless of its own query string —
// this is not something a forgotten "?test=1" should be able to defeat.
window.IS_TEST = !!__params.get('test') || location.pathname.includes('/tests/');
const DB_NAME = window.IS_TEST ? 'field-inspect-db-test'
  : window.IS_DEMO ? 'field-inspect-db-demo'
  : 'field-inspect-db';
// v5 adds the `deletions` store — see recordDeletion below for why a delete
// has to leave something behind. onupgradeneeded below is written so each
// store is created only if missing, which means an existing device upgrades
// in place without losing any job data.
const DB_VERSION = 9;

// Whether a value can be used to look something up BY KEY.
//
// This exists because an IndexedDB index asked for `undefined` does not return
// nothing: getAll(undefined) and getAllKeys(undefined) return EVERY record. So
// DB.getCaptures(undefined) is every photo in the database, and
// DB.deleteJob(undefined) used to read that as "this job's photos", delete
// them, and write a deletion record for each one so that sync would erase them
// from the cloud and from every other phone as well. Found by a monkey test
// that double-tapped Delete: a handler read currentJobId after a confirmation
// dialog, by which time the screen had been left and it was null. Photos went
// 26 -> 0 and invoices 7 -> 0 in a run that deleted two jobs.
//
// A missing id must mean "no job", never "all of them".
const hasKey = (k) => k !== undefined && k !== null && k !== '';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('captures')) {
        const store = db.createObjectStore('captures', { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
      // DB v6 removes 'footage'. The app records no video at all any more —
      // the camera is a viewfinder for photographs and nothing else — so the
      // store has nothing left to hold. Dropped rather than left dormant
      // because an empty store that nothing writes to is a trap for whoever
      // reads this next and reasonably assumes it is still in use.
      if (db.objectStoreNames.contains('footage')) {
        db.deleteObjectStore('footage');
      }
      if (!db.objectStoreNames.contains('reports')) {
        db.createObjectStore('reports', { keyPath: 'jobId' });
      }
      // DB v7 adds 'swms'. Keyed by its own id rather than by jobId, which
      // is the whole reason it is a separate store: 'reports' is keyed by
      // jobId, so a job holds exactly one report, and a Safe Work Method
      // Statement has to be able to sit alongside an inspection rather than
      // instead of it. jobId is an index here, not the key — and it is
      // nullable, because a SWMS written once for an activity and reused
      // across jobs is the way the document is actually used.
      if (!db.objectStoreNames.contains('swms')) {
        const store = db.createObjectStore('swms', { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
      // DB v8 adds 'leads'. Separate from jobs on purpose: a job is work that
      // exists and a lead is work that might, and putting maybes in the diary
      // is how a diary stops being trusted. A lead that is won becomes a job
      // and keeps a pointer back, so the enquiry it came from is not lost the
      // moment it turns into real work.
      if (!db.objectStoreNames.contains('leads')) {
        const store = db.createObjectStore('leads', { keyPath: 'id' });
        store.createIndex('stage', 'stage', { unique: false });
      }
      // DB v9 adds 'clients'. A client is who you talk to and who pays; the
      // property is where the work happens, and stays on the job. Jobs gain a
      // `clientId` POINTER and keep their own copy of the contact details —
      // see the note on backfillClients below for why that is not redundant.
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('invoices')) {
        const store = db.createObjectStore('invoices', { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains('sectionDrafts')) {
        const store = db.createObjectStore('sectionDrafts', { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains('deletions')) {
        // What was deleted, so the next sync can say so out loud. Keyed
        // "table:id" because a job and its report share an id.
        const store = db.createObjectStore('deletions', { keyPath: 'key' });
        store.createIndex('syncedAt', 'syncedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

const JOB_STATUSES = ['new', 'in_progress', 'review', 'completed'];
const JOB_STATUS_LABELS = {
  new: 'New',
  in_progress: 'Inspection In Progress',
  review: 'Report Review',
  completed: 'Completed',
};

const DB = {
  uid,
  JOB_STATUSES,
  JOB_STATUS_LABELS,

  // ---------- Jobs ----------
  async addJob({ name, address, addressLat, addressLng, notes, clientPhone, clientEmail, clientId, jobType, preferredDocumentType, recurringFromId, scheduledAt, scheduledDurationMins, recurrenceMonths }) {
    const store = await tx('jobs', 'readwrite');
    const now = Date.now();
    const job = {
      id: uid(),
      name,
      // 'termite' (AS 3660.2 inspection) or 'pest_treatment' (general pest
      // treatment / chemical application) — picked at job creation, drives
      // which report schema report.js uses for this job. Never changed
      // after creation, so it's safe for report.js to treat it as fixed.
      jobType: jobType === 'pest_treatment' ? 'pest_treatment' : 'termite',
      // Which document this job was booked to produce, chosen at New Job.
      // Termite work is several different documents off the same job type —
      // an inspection and a monitoring visit are both 'termite' — so this is
      // what lets the report open as the right one without being picked a
      // second time. A preference, not a lock: the document picker on the job
      // screen still changes it.
      preferredDocumentType: preferredDocumentType || '',
      address: address || '',
      // Geocoded once at address-selection time (see app.js's Nominatim
      // suggestion handler) so the aerial mud-map backdrop never needs a
      // second network round-trip. Null if the technician typed a free-text
      // address without picking a suggestion.
      addressLat: typeof addressLat === 'number' ? addressLat : null,
      addressLng: typeof addressLng === 'number' ? addressLng : null,
      notes: notes || '',
      clientPhone: clientPhone || '',
      clientEmail: clientEmail || '',
      // Client has asked not to receive automated email. False is the right
      // starting state for a client who just booked a job. The server checks
      // this too, and the server's copy is the one that decides — this is
      // here so the app can show the state and let a technician set it.
      commsOptOut: false,
      status: 'new',
      inspectionDate: null,
      inspectionTime: null,
      weather: '',
      inspectionStartedAt: null,
      inspectionEndedAt: null,
      // Set when a report is finalized — see ReportUI's finalize handler.
      // Drives the "Due" filter on the job list.
      nextDueAt: null,
      // When the job is actually booked in the diary. Null is a meaningful
      // state, not missing data — it is the unscheduled backlog.
      scheduledAt: typeof scheduledAt === 'number' ? scheduledAt : null,
      scheduledDurationMins: typeof scheduledDurationMins === 'number' ? scheduledDurationMins : 60,
      // The job this one was raised from, so a property's inspection history
      // can be walked backwards.
      // A POINTER to the client record, not a replacement for the three
      // fields above. Those stay, because a finalised report is a compliance
      // document and the client block printed on it is part of what was
      // signed - reading it live would mean correcting a phone number
      // silently rewrote every report ever issued.
      clientId: clientId || null,
      recurringFromId: recurringFromId || null,
      // The property is on a standing plan: re-inspect every N months, and
      // the next visit is raised automatically when this one is completed.
      //
      // Deliberately separate from nextDueAt and reinspectionIntervalMonths,
      // which are both consequences of finalizing a REPORT. That was the
      // weak link at any scale: no report finalized meant no due date, and
      // the property silently fell out of the schedule with nothing anywhere
      // showing it had. A plan lives on the job and survives a visit where
      // the paperwork never got finished.
      recurrenceMonths: typeof recurrenceMonths === 'number' && recurrenceMonths > 0 ? recurrenceMonths : null,
      // Whoever is logged in when the job is created owns it by default —
      // right now that's always the same one technician, so this costs
      // nothing today, but the moment a second person logs in, every job
      // they create is already correctly theirs with no extra step. See
      // scheduler.js's technician filter and app.js's reassign action for
      // where this actually gets read and changed.
      assignedTo: (window.Sync && window.Sync.currentUser && window.Sync.currentUser() && window.Sync.currentUser().email) || '',
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(store.add(job));
    if (window.Sync) window.Sync.pushJob(job);
    return job;
  },


  // ---------- Deletions (tombstones) ----------
  // A delete has to leave something behind, or it does not survive contact
  // with a second device.
  //
  // sync.js pushes any local record the cloud does not have. That rule
  // cannot tell "this was deleted" from "the cloud has not seen this yet" —
  // both are simply absent — so it re-uploaded deleted rows, and a job
  // deleted on the phone came back from the laptop on the next sync. A
  // tombstone is the missing half of the information: it says the absence
  // was deliberate.
  //
  // Kept forever rather than pruned. They are a few dozen bytes each, and
  // the failure mode of pruning too early is the bug coming back — a device
  // that was offline longer than the retention window resurrects everything
  // it still holds.
  async recordDeletion(table, recordId) {
    const store = await tx('deletions', 'readwrite');
    await reqToPromise(store.put({
      key: `${table}:${recordId}`,
      table,
      recordId,
      deletedAt: Date.now(),
      // Null until sync.js has told the server. Anything still null is a
      // delete this device made while it had no signal.
      syncedAt: null,
    }));
  },

  async getDeletions() {
    const store = await tx('deletions', 'readonly');
    return reqToPromise(store.getAll());
  },

  async getUnsyncedDeletions() {
    return (await this.getDeletions()).filter((d) => !d.syncedAt);
  },

  async markDeletionSynced(key) {
    // Two separate transactions on purpose. tx() hands back a store from
    // a NEW transaction each call, and an IndexedDB transaction commits
    // as soon as control leaves the event loop with nothing pending — so
    // a get and a put with an await between them run against a
    // transaction that has already closed, and the write is silently
    // lost. The tests caught exactly that.
    const readStore = await tx('deletions', 'readonly');
    const existing = await reqToPromise(readStore.get(key));
    if (!existing) return;
    existing.syncedAt = Date.now();
    const writeStore = await tx('deletions', 'readwrite');
    await reqToPromise(writeStore.put(existing));
  },

  // Used by the pull side: a tombstone that arrived from another device.
  // Already-synced by definition — it came from the server.
  async recordRemoteDeletion(table, recordId, deletedAt) {
    const store = await tx('deletions', 'readwrite');
    await reqToPromise(store.put({
      key: `${table}:${recordId}`,
      table,
      recordId,
      deletedAt: deletedAt || Date.now(),
      syncedAt: Date.now(),
    }));
  },


  // The tombstone itself, not just whether one exists — sync.js needs
  // deletedAt to decide whether a record that reappeared on the server is a
  // stale resurrection or genuinely newer work.
  async getDeletionRecord(table, recordId) {
    const store = await tx('deletions', 'readonly');
    return reqToPromise(store.get(`${table}:${recordId}`)) || null;
  },
  async isDeleted(table, recordId) {
    const store = await tx('deletions', 'readonly');
    return !!(await reqToPromise(store.get(`${table}:${recordId}`)));
  },

  // ---------- Local-only deletes ----------
  // Used when applying a tombstone that arrived from another device. The
  // record is already gone from the server and already has a tombstone, so
  // these must NOT call back into Sync or record a second one — that would
  // be a device echoing a deletion back at the network that told it.
  async deleteJobLocalOnly(id) {
    for (const c of await this.getCaptures(id)) {
      const s = await tx('captures', 'readwrite');
      await reqToPromise(s.delete(c.id));
    }
    for (const i of await this.getInvoicesForJob(id)) {
      const s = await tx('invoices', 'readwrite');
      await reqToPromise(s.delete(i.id));
    }
    const rstore = await tx('reports', 'readwrite');
    await reqToPromise(rstore.delete(id)).catch(() => {});
    await this.deleteAllSectionDraftsForJob(id).catch(() => {});
    const jstore = await tx('jobs', 'readwrite');
    await reqToPromise(jstore.delete(id));
  },

  async deleteReportLocalOnly(jobId) {
    const store = await tx('reports', 'readwrite');
    await reqToPromise(store.delete(jobId));
  },

  async deleteCaptureLocalOnly(id) {
    const store = await tx('captures', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async deleteInvoiceLocalOnly(id) {
    const store = await tx('invoices', 'readwrite');
    await reqToPromise(store.delete(id));
  },
  // ---------- Recurring service plans ----------
  // Raises the next visit for a property on a standing plan. Idempotent on
  // purpose: it is safe to call on every completion, and safe to call again
  // as a sweep (see catchUpRecurringPlans) for a series that stopped because
  // something went wrong months ago. A plan that quietly stops is the whole
  // failure this exists to prevent, so the repair has to be re-runnable
  // rather than a one-shot at exactly the right moment.
  async ensureNextOccurrence(job) {
    if (!job || !job.recurrenceMonths) return null;

    // A SAFETY NET, not a replacement. When a report is finalized normally it
    // sets next_due_at, the property shows in the backlog, and the existing
    // rebook flow handles it — that all still works untouched, and this does
    // nothing. This only fires for the case that used to lose a client
    // entirely: a visit that completed without paperwork, so no due date was
    // ever set and nothing anywhere remembered the property existed.
    if (job.nextDueAt) return null;

    // Already raised. Matching on lineage rather than a flag means a series
    // cannot double up even if two devices complete the same job offline
    // and sync later.
    const all = await this.getJobs();
    const existing = all.find((j) => j.recurringFromId === job.id);
    if (existing) return existing;

    const from = job.inspectionEndedAt || job.scheduledAt || Date.now();
    const due = new Date(from);
    due.setMonth(due.getMonth() + job.recurrenceMonths);

    const next = await this.addJob({
      name: job.name,
      address: job.address,
      addressLat: job.addressLat,
      addressLng: job.addressLng,
      notes: job.notes,
      clientPhone: job.clientPhone,
      clientEmail: job.clientEmail,
      jobType: job.jobType,
      recurringFromId: job.id,
      // The plan travels with the series, or it would last exactly one hop.
      recurrenceMonths: job.recurrenceMonths,
    });

    // Due, not booked. The visit is committed; which morning it happens on
    // is a decision for the week it falls in, so it lands in the backlog
    // rather than inventing a booking a year out that nobody agreed to.
    // Returning addJob's snapshot would hand back a job whose nextDueAt is
    // still null, because it was set by the update below.
    await this.updateJob(next.id, {
      nextDueAt: due.getTime(),
      assignedTo: job.assignedTo || '',
    });
    return this.getJob(next.id);
  },

  // Repairs any series that stopped. Cheap enough to run on load: it only
  // acts on completed jobs that carry a plan and have no successor, which in
  // a healthy database is none of them.
  async catchUpRecurringPlans() {
    const all = await this.getJobs();
    const raised = [];
    for (const job of all) {
      if (job.status !== 'completed' || !job.recurrenceMonths) continue;
      if (all.some((j) => j.recurringFromId === job.id)) continue;
      const next = await this.ensureNextOccurrence(job);
      if (next) raised.push(next);
    }
    return raised;
  },

  // Low-level put used only by the sync layer to write a record pulled from
  // the cloud without re-stamping updatedAt or triggering another push.
  async putJobRaw(job) {
    const store = await tx('jobs', 'readwrite');
    await reqToPromise(store.put(job));
    return job;
  },

  async getJobs() {
    const store = await tx('jobs', 'readonly');
    const jobs = await reqToPromise(store.getAll());
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ---------- Client history ----------
  // There is no `clients` table — a customer's contact details live on each
  // job record, same as they always have. Building a real client entity
  // means migrating every existing job for a business already using this
  // app daily, which is a much bigger and riskier change than "tell the
  // technician this is a repeat customer." This gets the actual value —
  // recognising a returning client — by matching on the data that already
  // exists, with nothing to migrate and nothing that can go wrong with old
  // records.
  //
  // Phone numbers get typed as "0412 345 678", "0412-345-678", "(04) 1234
  // 5678" — digits-only comparison is the only reliable match. Email is
  // compared case-insensitively, since "Jane@x.com" and "jane@x.com" are
  // the same inbox.
  _normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  },
  _normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  },

  // Returns past jobs for the same client, newest first, excluding the job
  // being looked up from (a job matches itself trivially otherwise). A
  // client is the same person if EITHER their phone or their email matches
  // — a returning customer often gives a different phone (new number, a
  // partner booking this time) but keeps the same email, or vice versa.
  async findClientHistory({ phone, email, excludeJobId } = {}) {
    const normPhone = this._normalizePhone(phone);
    const normEmail = this._normalizeEmail(email);
    if (!normPhone && !normEmail) return [];
    const all = await this.getJobs();
    return all.filter((j) => {
      if (j.id === excludeJobId) return false;
      const phoneMatch = normPhone && this._normalizePhone(j.clientPhone) === normPhone;
      const emailMatch = normEmail && this._normalizeEmail(j.clientEmail) === normEmail;
      return phoneMatch || emailMatch;
    });
  },

  async getJob(id) {
    const store = await tx('jobs', 'readonly');
    return reqToPromise(store.get(id));
  },

  async updateJob(id, changes) {
    const store = await tx('jobs', 'readwrite');
    const existing = await reqToPromise(store.get(id));
    if (!existing) return null;
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await reqToPromise(store.put(updated));
    if (window.Sync) window.Sync.pushJob(updated);
    return updated;
  },

  // A tap-to-book flow only ever checks the hour the technician tapped — if
  // that hour is free but the chosen duration runs into the hour after,
  // nothing catches it, because nothing else in the app looks at durations
  // together. Same gap in the auto-rebook flow: a recurring inspection is
  // booked straight onto its due date with no visibility into what else that
  // day already holds. This is the one place that check lives, so every
  // booking path — the day grid, the backlog's one-tap book, the AI
  // scheduling assistant, and auto-rebook — asks the same question the same
  // way instead of five different half-checks drifting apart over time.
  async getOverlappingJobs(scheduledAt, durationMins, excludeJobId) {
    if (!scheduledAt) return [];
    const start = scheduledAt;
    const end = scheduledAt + (durationMins || 60) * 60000;
    const all = await this.getJobs();
    return all.filter((j) => {
      if (j.id === excludeJobId || !j.scheduledAt) return false;
      const jStart = j.scheduledAt;
      const jEnd = jStart + (j.scheduledDurationMins || 60) * 60000;
      return start < jEnd && jStart < end;
    });
  },

  async deleteJob(id) {
    // Before anything else, and loud rather than quiet: a caller that arrives
    // here without a job is a bug, and carrying on is how every photo went.
    if (!hasKey(id)) throw new Error('deleteJob needs a job id — refusing to guess which job is meant.');
    const captures = await this.getCaptures(id);
    const cstore = await tx('captures', 'readwrite');
    await Promise.all(captures.map((c) => reqToPromise(cstore.delete(c.id))));

    const invoices = await this.getInvoicesForJob(id);
    const istore = await tx('invoices', 'readwrite');
    await Promise.all(invoices.map((i) => reqToPromise(istore.delete(i.id))));

    const rstore = await tx('reports', 'readwrite');
    await reqToPromise(rstore.delete(id)).catch(() => {});

    await this.deleteAllSectionDraftsForJob(id).catch(() => {});

    // A tombstone for the job AND for everything that went with it. The
    // cloud cascades children off the job row, but other devices hold their
    // own copies and would otherwise push the orphans straight back.
    await this.recordDeletion('jobs', id);
    await this.recordDeletion('reports', id);
    for (const c of captures) await this.recordDeletion('captures', c.id);
    for (const i of invoices) await this.recordDeletion('invoices', i.id);

    const jstore = await tx('jobs', 'readwrite');
    await reqToPromise(jstore.delete(id));

    // Storage bytes for this job would otherwise be orphaned in the bucket
    // forever. Best-effort: a failure here must not leave the job undeleted.
    if (window.Media) {
      window.Media.listJobPaths(id)
        .then((paths) => window.Media.removeBlobs(paths))
        .catch((e) => console.warn('[db] could not clean up job media:', e.message || e));
    }
    if (window.Sync) window.Sync.deleteJobRemote(id);
  },

  // ---------- Photo / voice captures ----------
  async addCapture({ jobId, zone, type, photoBlob, audioBlob }) {
    await this.assertJobAlive(jobId);
    const store = await tx('captures', 'readwrite');
    const now = Date.now();
    const capture = {
      id: uid(),
      jobId,
      zone: zone || '',
      type,
      photoBlob: photoBlob || null,
      audioBlob: audioBlob || null,
      createdAt: now,
      // updatedAt drives last-write-wins in sync.js, same as jobs/reports.
      updatedAt: now,
    };
    await reqToPromise(store.add(capture));
    if (window.Sync) window.Sync.pushCapture(capture);
    return capture;
  },

  async updateCapture(id, changes) {
    const store = await tx('captures', 'readwrite');
    const existing = await reqToPromise(store.get(id));
    if (!existing) return null;
    const updated = { ...existing, ...changes, updatedAt: Date.now() };
    await reqToPromise(store.put(updated));
    if (window.Sync) window.Sync.pushCapture(updated);
    return updated;
  },

  // Low-level put used only by the sync layer — never re-triggers a push.
  async putCaptureRaw(capture) {
    const store = await tx('captures', 'readwrite');
    await reqToPromise(store.put(capture));
    return capture;
  },

  async getAllCaptures() {
    const store = await tx('captures', 'readonly');
    return reqToPromise(store.getAll());
  },

  async deleteCapture(id) {
    const store = await tx('captures', 'readwrite');
    await reqToPromise(store.delete(id));
    await this.recordDeletion('captures', id);
    if (window.Sync) window.Sync.deleteCaptureRemote(id);
  },

  async getCaptures(jobId) {
    if (!hasKey(jobId)) return []; // see hasKey: undefined would return every photo
    const store = await tx('captures', 'readonly');
    const idx = store.index('jobId');
    const all = await reqToPromise(idx.getAll(jobId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async getCaptureCount(jobId) {
    const captures = await this.getCaptures(jobId);
    return captures.length;
  },

  // ---------- Reports ----------
  async getReport(jobId) {
    const store = await tx('reports', 'readonly');
    return reqToPromise(store.get(jobId));
  },

  // Writes that belong to a job refuse to run once that job has been deleted.
  // Without this, an autosave, a late camera frame, or a stale open screen
  // recreates a report/invoice/photo for a job that no longer exists, and sync
  // then pushes the orphan to a server that has no job for it, every time.
  // What to tell the technician when a save to this phone fails. Plain words, says
  // whether anything was kept, and what to do next. Pure, so it is unit-tested.
  describeSaveFailure(err, what) {
    const label = what || 'That';
    if (err && err.code === 'JOB_DELETED') return err.message;
    const name = err && err.name;
    const text = String((err && err.message) || err || '');
    if (name === 'QuotaExceededError' || /quota/i.test(text)) {
      return `${label} was NOT saved. This phone is out of storage. Free up some space, then take it again.`;
    }
    return `${label} was NOT saved (${text || 'unknown problem'}). Please try again.`;
  },

  async assertJobAlive(jobId) {
    if (hasKey(jobId) && await this.isDeleted('jobs', jobId)) {
      const err = new Error('This job was deleted, so that change was not saved.');
      err.code = 'JOB_DELETED';
      throw err;
    }
  },

  async saveReport(report) {
    await this.assertJobAlive(report && report.jobId);
    const store = await tx('reports', 'readwrite');
    const toSave = { ...report, updatedAt: Date.now() };
    await reqToPromise(store.put(toSave));
    if (window.Sync) window.Sync.pushReport(toSave);
    return toSave;
  },

  // Low-level put used only by the sync layer.
  async putReportRaw(report) {
    const store = await tx('reports', 'readwrite');
    await reqToPromise(store.put(report));
    return report;
  },

  async deleteReport(jobId) {
    const store = await tx('reports', 'readwrite');
    await reqToPromise(store.delete(jobId));
    await this.recordDeletion('reports', jobId);
  },

  // ---------- Invoices ----------
  async saveInvoice(invoice) {
    await this.assertJobAlive(invoice && invoice.jobId);
    const store = await tx('invoices', 'readwrite');
    const toSave = { ...invoice, updatedAt: Date.now() };
    await reqToPromise(store.put(toSave));
    if (window.Sync) window.Sync.pushInvoice(toSave);
    return toSave;
  },

  // Low-level put used only by the sync layer — never re-triggers a push.
  async putInvoiceRaw(invoice) {
    const store = await tx('invoices', 'readwrite');
    await reqToPromise(store.put(invoice));
    return invoice;
  },

  async getInvoice(id) {
    const store = await tx('invoices', 'readonly');
    return reqToPromise(store.get(id));
  },

  async getInvoicesForJob(jobId) {
    if (!hasKey(jobId)) return []; // see hasKey: undefined would return every invoice
    const store = await tx('invoices', 'readonly');
    const idx = store.index('jobId');
    const all = await reqToPromise(idx.getAll(jobId));
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getAllInvoices() {
    const store = await tx('invoices', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async deleteInvoice(id) {
    const store = await tx('invoices', 'readwrite');
    await reqToPromise(store.delete(id));
    await this.recordDeletion('invoices', id);
    if (window.Sync) window.Sync.deleteInvoiceRemote(id);
  },

  async getAllReports() {
    const store = await tx('reports', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (b.finalizedAt || b.updatedAt || 0) - (a.finalizedAt || a.updatedAt || 0));
  },

  // ---------- Clients ----------
  async addClient({ name, phone, email, address, notes }) {
    const store = await tx('clients', 'readwrite');
    const now = Date.now();
    const record = {
      id: uid(),
      name: name || '',
      phone: phone || '',
      email: email || '',
      // The billing or postal address, which is NOT where the work happens.
      // A strata manager in the city has properties all over Macarthur.
      address: address || '',
      notes: notes || '',
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(store.put(record));
    if (window.Sync) window.Sync.pushClient(record);
    return record;
  },

  async saveClient(client) {
    const store = await tx('clients', 'readwrite');
    const toSave = { ...client, updatedAt: Date.now() };
    await reqToPromise(store.put(toSave));
    if (window.Sync) window.Sync.pushClient(toSave);
    return toSave;
  },

  // Low-level put used only by the sync layer — never re-triggers a push.
  async putClientRaw(client) {
    const store = await tx('clients', 'readwrite');
    await reqToPromise(store.put(client));
    return client;
  },

  async getClient(id) {
    if (!id) return undefined;
    const store = await tx('clients', 'readonly');
    return reqToPromise(store.get(id));
  },

  async getClients() {
    const store = await tx('clients', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  // Deleting a client does NOT delete their work, and the jobs keep their own
  // copy of who it was for — they simply stop pointing at a record that has
  // gone. Mirrors ON DELETE SET NULL in migration 029.
  async deleteClient(id) {
    const store = await tx('clients', 'readwrite');
    await reqToPromise(store.delete(id));
    const jobs = await this.getJobs();
    for (const job of jobs) {
      if (job.clientId === id) await this.updateJob(job.id, { clientId: null });
    }
    await this.recordDeletion('clients', id);
    if (window.Sync) window.Sync.deleteClientRemote(id);
  },

  async getJobsForClient(clientId) {
    if (!clientId) return [];
    const all = await this.getJobs();
    return all.filter((j) => j.clientId === clientId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  // Groups the jobs that already exist into clients, using the same rule the
  // app and migration 029 use: same person if EITHER the digits of the phone
  // match OR the lowercased email matches.
  //
  // Only ever touches jobs whose clientId is still unset, so running it twice
  // creates nothing the second time. Jobs with neither a phone nor an email
  // are left unlinked rather than merged into a guess.
  async backfillClients() {
    const jobs = (await this.getJobs())
      .filter((j) => !j.clientId && (j.clientPhone || j.clientEmail))
      // Newest first, so where details changed over the years the client
      // record ends up holding the most recent version of them.
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!jobs.length) return { created: 0, linked: 0 };

    const clients = await this.getClients();
    let created = 0;
    let linked = 0;

    for (const job of jobs) {
      const details = { phone: job.clientPhone, email: job.clientEmail };
      let match = window.Clients ? window.Clients.matchClient(clients, details) : null;
      if (!match) {
        match = await this.addClient({
          name: job.name || '',
          phone: job.clientPhone || '',
          email: job.clientEmail || '',
        });
        clients.push(match);
        created++;
      }
      await this.updateJob(job.id, { clientId: match.id });
      linked++;
    }
    return { created, linked };
  },

  // ---------- Leads ----------
  async addLead({ name, phone, email, address, addressLat, addressLng, jobType, source, notes, quotedCents }) {
    const store = await tx('leads', 'readwrite');
    const now = Date.now();
    const record = {
      id: uid(),
      name: name || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      addressLat: typeof addressLat === 'number' ? addressLat : null,
      addressLng: typeof addressLng === 'number' ? addressLng : null,
      jobType: jobType === 'pest_treatment' ? 'pest_treatment' : 'termite',
      // Where it came from, because knowing which advertising works is the
      // only way to decide whether to keep paying for it.
      source: source || '',
      notes: notes || '',
      stage: 'new',
      // Separate from createdAt so "how long has it sat in THIS stage" is
      // answerable — a lead that arrived last month but was quoted yesterday
      // is not stale.
      stageChangedAt: now,
      lastContactedAt: null,
      lastFollowUpAt: null,
      followUpCount: 0,
      snoozedUntil: null,
      quotedCents: typeof quotedCents === 'number' ? quotedCents : null,
      lostReason: '',
      // Set when the lead is won, so the enquiry is not lost the moment it
      // becomes real work.
      convertedJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(store.put(record));
    if (window.Sync) window.Sync.pushLead(record);
    return record;
  },

  async saveLead(lead) {
    const store = await tx('leads', 'readwrite');
    const toSave = { ...lead, updatedAt: Date.now() };
    await reqToPromise(store.put(toSave));
    if (window.Sync) window.Sync.pushLead(toSave);
    return toSave;
  },

  // Low-level put used only by the sync layer — never re-triggers a push.
  async putLeadRaw(lead) {
    const store = await tx('leads', 'readwrite');
    await reqToPromise(store.put(lead));
    return lead;
  },

  async getLead(id) {
    const store = await tx('leads', 'readonly');
    return reqToPromise(store.get(id));
  },

  async getLeads() {
    const store = await tx('leads', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  async deleteLead(id) {
    const store = await tx('leads', 'readwrite');
    await reqToPromise(store.delete(id));
    await this.recordDeletion('leads', id);
    if (window.Sync) window.Sync.deleteLeadRemote(id);
  },

  // ---------- Safe Work Method Statements ----------
  // Its own store, not a document type on a report. `reports` is keyed by
  // jobId, so a job holds exactly one — and a SWMS accompanies the work
  // rather than recording it, so it has to be able to exist alongside an
  // inspection instead of replacing it. See DOCUMENT_TYPES in report.js,
  // which says the same thing from the other end.
  async createSwms({ jobId, title, siteAddress }) {
    const store = await tx('swms', 'readwrite');
    const now = Date.now();
    const record = {
      id: uid(),
      // Nullable on purpose. A SWMS written once for subfloor work and
      // reused across a season is how the document is actually used; tying
      // every one to a single job would make the common case the awkward one.
      jobId: jobId || null,
      title: title || 'Safe Work Method Statement',
      siteAddress: siteAddress || '',
      sections: {},
      signedAt: null,
      reviewDueAt: null,
      schemaVersion: window.SWMS_SCHEMA_VERSION || 1,
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(store.put(record));
    if (window.Sync) window.Sync.pushSwms(record);
    return record;
  },

  async saveSwms(swms) {
    const store = await tx('swms', 'readwrite');
    const toSave = { ...swms, updatedAt: Date.now() };
    await reqToPromise(store.put(toSave));
    if (window.Sync) window.Sync.pushSwms(toSave);
    return toSave;
  },

  // Low-level put used only by the sync layer — never re-triggers a push.
  async putSwmsRaw(swms) {
    const store = await tx('swms', 'readwrite');
    await reqToPromise(store.put(swms));
    return swms;
  },

  async getSwms(id) {
    const store = await tx('swms', 'readonly');
    return reqToPromise(store.get(id));
  },

  async getSwmsForJob(jobId) {
    if (!hasKey(jobId)) return []; // see hasKey
    const store = await tx('swms', 'readonly');
    const idx = store.index('jobId');
    const all = await reqToPromise(idx.getAll(jobId));
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async getAllSwms() {
    const store = await tx('swms', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async deleteSwms(id) {
    const store = await tx('swms', 'readwrite');
    await reqToPromise(store.delete(id));
    await this.recordDeletion('swms', id);
    if (window.Sync) window.Sync.deleteSwmsRemote(id);
  },

  // ---------- Self-service backup ----------
  // Jobs, reports (with their full audit trails) and invoices — every record
  // that only lives in Postgres otherwise, so the business is not one
  // Supabase incident from losing them. Deliberately excludes captures:
  // those are photo blobs that would make this megabytes-to-gigabytes and slow to generate on a phone, and they already have their
  // own backup path once media.js syncs them to Supabase Storage. This export
  // is a belt to that path's suspenders, not a replacement for it.
  async exportAllData() {
    // Everything that is text and small. Clients, enquiries and safety statements
    // were added after this was written and were silently left out, so a "backup"
    // restored from it would have had every job and none of the people they were
    // for. Photos are deliberately still not here (see the test beside this).
    const [jobs, reports, invoices, clients, leads, swms] = await Promise.all([
      this.getJobs(),
      this.getAllReports(),
      this.getAllInvoices(),
      this.getClients(),
      this.getLeads(),
      this.getAllSwms(),
    ]);
    return {
      // Which shape of file this is, so whatever reads it later can tell a file
      // written before clients and enquiries existed from one written after.
      format: 2,
      exportedAt: new Date().toISOString(),
      appVersion: window.APP_VERSION || null,
      counts: {
        jobs: jobs.length, reports: reports.length, invoices: invoices.length,
        clients: clients.length, leads: leads.length, swms: swms.length,
      },
      jobs,
      reports,
      invoices,
      clients,
      leads,
      swms,
    };
  },

  // ---------- Section drafts ----------
  // Local-only safety net for a section still being edited — see the note at
  // the top of this file. Never synced (window.Sync has no idea this store
  // exists), never audited, and deliberately separate from `reports` so an
  // autosave tick can never be the thing that writes to the document a
  // signed-off report's audit trail is supposed to be watching.
  async saveSectionDraft(jobId, sectionId, values) {
    const store = await tx('sectionDrafts', 'readwrite');
    await reqToPromise(store.put({ id: `${jobId}::${sectionId}`, jobId, sectionId, values, savedAt: Date.now() }));
  },

  async getSectionDraft(jobId, sectionId) {
    const store = await tx('sectionDrafts', 'readonly');
    return reqToPromise(store.get(`${jobId}::${sectionId}`));
  },

  async deleteSectionDraft(jobId, sectionId) {
    const store = await tx('sectionDrafts', 'readwrite');
    await reqToPromise(store.delete(`${jobId}::${sectionId}`));
  },

  // Called once a report is finalized or a job is deleted — drafts for
  // sections that no longer have anything to draft toward should not
  // linger in the store forever.
  async deleteAllSectionDraftsForJob(jobId) {
    // getAllKeys(undefined) is every draft for every job: somebody's half-written
    // section, wiped, because a different job was deleted with no id.
    if (!hasKey(jobId)) return;
    const store = await tx('sectionDrafts', 'readwrite');
    const index = store.index('jobId');
    const keys = await reqToPromise(index.getAllKeys(jobId));
    await Promise.all(keys.map((k) => reqToPromise(store.delete(k))));
  },

  // Test-only: closes the open connection so the test suite can safely
  // delete-and-recreate the isolated test database between runs. Never
  // called from production code paths.
  async __resetConnection() {
    if (dbPromise) {
      const db = await dbPromise;
      db.close();
    }
    dbPromise = null;
  },
};

// `const DB` alone stays out of window's property list (a top-level const/let
// in a classic script doesn't attach to the global object), so code in this
// document sees it fine via lexical scope, but frame.contentWindow.DB from
// outside an iframe would come back undefined without this explicit export.
window.DB = DB;
