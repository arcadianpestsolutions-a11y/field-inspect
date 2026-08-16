// Minimal IndexedDB wrapper — no dependencies.
// Stores: jobs (id, name, address, notes, createdAt)
//         captures (id, jobId, zone, type: 'photo'|'memo', photoBlob?, audioBlob?, createdAt)

const DB_NAME = 'field-inspect-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('captures')) {
        const store = db.createObjectStore('captures', { keyPath: 'id' });
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

const DB = {
  uid,

  async addJob({ name, address, notes }) {
    const store = await tx('jobs', 'readwrite');
    const job = { id: uid(), name, address: address || '', notes: notes || '', createdAt: Date.now() };
    await reqToPromise(store.add(job));
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

  async deleteJob(id) {
    const captures = await this.getCaptures(id);
    const cstore = await tx('captures', 'readwrite');
    await Promise.all(captures.map((c) => reqToPromise(cstore.delete(c.id))));
    const jstore = await tx('jobs', 'readwrite');
    await reqToPromise(jstore.delete(id));
  },

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
};
