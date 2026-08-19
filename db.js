// Minimal IndexedDB wrapper — no dependencies.
// Stores:
//   jobs      (id, name, address, notes, clientPhone, clientEmail, status,
//              inspectionDate, inspectionTime, weather, createdAt, updatedAt)
//   captures  (id, jobId, zone, type: 'photo'|'memo', photoBlob?, audioBlob?, createdAt)
//   footage   (id, jobId, zone, source: 'live'|'imported', kind: 'video'|'photo',
//              blob, fileName?, note?, createdAt)
//   reports   (jobId [key], sections: {sectionId: {fieldId: value}}, sectionStatus,
//              aiDraft, finalizedAt, updatedAt)

// A page loaded with ?test=1 gets its own IndexedDB so the automated test
// suite (tests/run-tests.html) never touches real job data.
const DB_NAME = new URLSearchParams(location.search).get('test') ? 'field-inspect-db-test' : 'field-inspect-db';
// v3 adds the `invoices` store. onupgradeneeded below is written so each
// store is created only if missing, which means an existing device upgrades
// in place without losing any job data.
const DB_VERSION = 3;

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
  async addJob({ name, address, addressLat, addressLng, notes, clientPhone, clientEmail, jobType, recurringFromId, scheduledAt, scheduledDurationMins }) {
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
      createdAt: now,
      updatedAt: now,
    };
    await reqToPromise(store.add(job));
    if (window.Sync) window.Sync.pushJob(job);
    return job;
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
    if (window.Sync) window.Sync.deleteInvoiceRemote(id);
  },

  async getAllReports() {
    const store = await tx('reports', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (b.finalizedAt || b.updatedAt || 0) - (a.finalizedAt || a.updatedAt || 0));
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
