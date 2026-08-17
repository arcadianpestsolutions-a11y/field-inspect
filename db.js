// Minimal IndexedDB wrapper — no dependencies.
// Stores:
//   jobs      (id, name, address, notes, clientPhone, clientEmail, status,
//              inspectionDate, inspectionTime, weather, createdAt, updatedAt)
//   captures  (id, jobId, zone, type: 'photo'|'memo', photoBlob?, audioBlob?, createdAt)
//   footage   (id, jobId, zone, source: 'live'|'imported', kind: 'video'|'photo',
//              blob, fileName?, note?, createdAt)
//   reports   (jobId [key], sections: {sectionId: {fieldId: value}}, sectionStatus,
//              aiDraft, finalizedAt, updatedAt)

const DB_NAME = 'field-inspect-db';
const DB_VERSION = 2;

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
  async addJob({ name, address, notes, clientPhone, clientEmail }) {
    const store = await tx('jobs', 'readwrite');
    const now = Date.now();
    const job = {
      id: uid(),
      name,
      address: address || '',
      notes: notes || '',
      clientPhone: clientPhone || '',
      clientEmail: clientEmail || '',
      status: 'new',
      inspectionDate: null,
      inspectionTime: null,
      weather: '',
      inspectionStartedAt: null,
      inspectionEndedAt: null,
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

    const rstore = await tx('reports', 'readwrite');
    await reqToPromise(rstore.delete(id)).catch(() => {});

    const jstore = await tx('jobs', 'readwrite');
    await reqToPromise(jstore.delete(id));

    if (window.Sync) window.Sync.deleteJobRemote(id);
  },

  // ---------- Photo / voice captures ----------
  async addCapture({ jobId, zone, type, photoBlob, audioBlob }) {
    const store = await tx('captures', 'readwrite');
    const capture = {
      id: uid(),
      jobId,
      zone: zone || '',
      type,
      photoBlob: photoBlob || null,
      audioBlob: audioBlob || null,
      createdAt: Date.now(),
    };
    await reqToPromise(store.add(capture));
    return capture;
  },

  async updateCapture(id, changes) {
    const store = await tx('captures', 'readwrite');
    const existing = await reqToPromise(store.get(id));
    if (!existing) return null;
    const updated = { ...existing, ...changes };
    await reqToPromise(store.put(updated));
    return updated;
  },

  async deleteCapture(id) {
    const store = await tx('captures', 'readwrite');
    await reqToPromise(store.delete(id));
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
    const item = {
      id: uid(),
      jobId,
      zone: zone || '',
      source: source || 'live', // 'live' | 'imported'
      kind: kind || 'video', // 'video' | 'photo'
      blob,
      fileName: fileName || '',
      note: note || '',
      createdAt: Date.now(),
    };
    await reqToPromise(store.add(item));
    return item;
  },

  async getFootage(jobId) {
    const store = await tx('footage', 'readonly');
    const idx = store.index('jobId');
    const all = await reqToPromise(idx.getAll(jobId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async deleteFootage(id) {
    const store = await tx('footage', 'readwrite');
    await reqToPromise(store.delete(id));
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

  async getAllReports() {
    const store = await tx('reports', 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (b.finalizedAt || b.updatedAt || 0) - (a.finalizedAt || a.updatedAt || 0));
  },
};
