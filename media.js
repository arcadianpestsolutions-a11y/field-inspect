// Blob backup to Supabase Storage — the durable half of sync.
//
// sync.js moves records (jobs, reports, capture/footage metadata). This module
// moves the bytes those records point at: site photos, voice memos, inspection
// video, and the photos attached to report sections. Records are small and
// live in Postgres; bytes are large and live in the `inspection-media` bucket,
// referenced by an object path.
//
// Everything here is best-effort by design. A failed upload must never break
// the local save — the technician is standing in a subfloor with one bar of
// signal, and the local IndexedDB copy is still intact. Failed uploads are
// retried on the next full sync, because that sync re-checks every record for
// a missing path rather than trusting a queue.
(() => {
  'use strict';

  if (!window.supabaseClient) {
    console.warn('[media] Supabase not configured — media backup unavailable.');
    return;
  }
  const supabaseClient = window.supabaseClient;
  const BUCKET = 'inspection-media';

  // Keep a real extension on stored objects so the bucket stays browsable and
  // a downloaded file opens in the right app without renaming.
  const EXT_BY_TYPE = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
  };

  function extFor(blob) {
    const type = (blob && blob.type) || '';
    if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type];
    // MediaRecorder hands back types like "video/webm;codecs=vp9,opus".
    const base = type.split(';')[0].trim();
    if (EXT_BY_TYPE[base]) return EXT_BY_TYPE[base];
    if (base.startsWith('image/')) return 'jpg';
    if (base.startsWith('video/')) return 'webm';
    if (base.startsWith('audio/')) return 'webm';
    return 'bin';
  }

  // Paths are grouped by job so a whole job's evidence can be found, exported,
  // or removed as one unit — which is what a three-year retention policy and a
  // subject-access request both actually need.
  function pathFor(jobId, kind, id, blob) {
    return `${jobId}/${kind}/${id}.${extFor(blob)}`;
  }

  // Returns the stored path, or null if the upload didn't happen. upsert is on
  // so a retry after a partial failure overwrites rather than erroring.
  async function uploadBlob(path, blob) {
    if (!blob || !path) return null;
    try {
      const { error } = await supabaseClient.storage
        .from(BUCKET)
        .upload(path, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' });
      if (error) throw error;
      return path;
    } catch (e) {
      console.warn('[media] upload failed for', path, '-', e.message || e);
      return null;
    }
  }

  async function downloadBlob(path) {
    if (!path) return null;
    try {
      const { data, error } = await supabaseClient.storage.from(BUCKET).download(path);
      if (error) throw error;
      return data || null;
    } catch (e) {
      console.warn('[media] download failed for', path, '-', e.message || e);
      return null;
    }
  }

  async function removeBlobs(paths) {
    const list = (paths || []).filter(Boolean);
    if (!list.length) return;
    try {
      const { error } = await supabaseClient.storage.from(BUCKET).remove(list);
      if (error) throw error;
    } catch (e) {
      console.warn('[media] remove failed:', e.message || e);
    }
  }

  // Lists every object stored under a job, so job deletion can clean up the
  // bucket instead of leaving orphaned bytes behind forever.
  async function listJobPaths(jobId) {
    const found = [];
    for (const kind of ['capture', 'memo', 'footage', 'report']) {
      try {
        const { data, error } = await supabaseClient.storage.from(BUCKET).list(`${jobId}/${kind}`, { limit: 1000 });
        if (error) throw error;
        for (const entry of data || []) found.push(`${jobId}/${kind}/${entry.name}`);
      } catch (e) {
        console.warn('[media] list failed for', jobId, kind, '-', e.message || e);
      }
    }
    return found;
  }

  window.Media = { BUCKET, pathFor, uploadBlob, downloadBlob, removeBlobs, listJobPaths };
})();
