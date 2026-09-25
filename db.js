// Minimal IndexedDB wrapper — no dependencies.
// Stores:
//   jobs      (id, name, address, notes, clientPhone, clientEmail, status,
//              inspectionDate, inspectionTime, weather, createdAt, updatedAt)
//   captures  (id, jobId, zone, type: 'photo'|'memo', photoBlob?, audioBlob?, createdAt)
//   footage   (id, jobId, zone, source: 'live'|'imported', kind: 'video'|'photo',
//              blob, fileName?, note?, createdAt)
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
const DB_VERSION = 5;

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
      if (!db.objectStoreNames.contains('footage')) {
        const store = db.createObjectStore('footage', { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains('reports')) {
        db.createObjectStore('reports', { keyPath: 'jobId' });
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
  async addJob({ name, address, addressLat, addressLng, notes, clientPhone, clientEmail, jobType, recurringFromId, scheduledAt, scheduledDurationMins, recurrenceMonths }) {
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
    for (const f of await this.getFootage(id)) {
      const s = await tx('footage', 'readwrite');
      await reqToPromise(s.delete(f.id));
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

  async deleteFootageLocalOnly(id) {
    const store = await tx('footage', 'readwrite');
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
    const captures = await this.getCaptures(id);
    const cstore = await tx('captures', 'readwrite');
    await Promise.all(captures.map((c) => reqToPromise(cstore.delete(c.id))));

    const footage = await this.getFootage(id);
    const fstore = await tx('footage', 'readwrite');
    await Promise.all(footage.map((f) => reqToPromise(fstore.delete(f.id))));

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
    for (const f of footage) await this.recordDeletion('footage', f.id);
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
    const store = await tx('captures', 'readonly');
    const idx = store.index('jobId');
    const all = await reqToPromise(idx.getAll(jobId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async getCaptureCount(jobId) {
    const captures = await this.getCaptures(jobId);
    return captures.length;
  },

  // ---------- Footage (video, live-recorded or imported) ----------
  async addFootage({ jobId, zone, source, kind, blob, fileName, note }) {
    const store = await tx('footage', 'readwrite');
    const now = Date.now();
    const item = {
      id: uid(),
      jobId,
      zone: zone || '',
      source: source || 'live', // 'live' | 'imported'
      kind: kind || 'video', // 'video' | 'photo'
      blob,
      fileName: fileName || '',
      note: note || '',
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(store.add(item));
    if (window.Sync) window.Sync.pushFootage(item);
    return item;
  },

  async getFootage(jobId) {
    const store = await tx('footage', 'readonly');
    const idx = store.index('jobId');
    const all = await reqToPromise(idx.getAll(jobId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  // Low-level put used only by the sync layer — never re-triggers a push.
  async putFootageRaw(item) {
    const store = await tx('footage', 'readwrite');
    await reqToPromise(store.put(item));
    return item;
  },

  async getAllFootage() {
    const store = await tx('footage', 'readonly');
    return reqToPromise(store.getAll());
  },

  async deleteFootage(id) {
    const store = await tx('footage', 'readwrite');
    await reqToPromise(store.delete(id));
    await this.recordDeletion('footage', id);
    if (window.Sync) window.Sync.deleteFootageRemote(id);
  },

  // ---------- Reports ----------
  async getReport(jobId) {
    const store = await tx('reports', 'readonly');
    return reqToPromise(store.get(jobId));
  },

  async saveReport(report) {
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

  // ---------- Self-service backup ----------
  // Jobs, reports (with their full audit trails) and invoices — every record
  // that only lives in Postgres otherwise, so the business is not one
  // Supabase incident from losing them. Deliberately excludes captures and
  // footage: those are photo/video blobs that would make this megabytes-to-
  // gigabytes and slow to generate on a phone, and they already have their
  // own backup path once media.js syncs them to Supabase Storage. This export
  // is a belt to that path's suspenders, not a replacement for it.
  async exportAllData() {
    const [jobs, reports, invoices] = await Promise.all([
      this.getJobs(),
      this.getAllReports(),
      this.getAllInvoices(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      appVersion: window.APP_VERSION || null,
      counts: { jobs: jobs.length, reports: reports.length, invoices: invoices.length },
      jobs,
      reports,
      invoices,
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
