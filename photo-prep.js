// Every photo, before it is kept (v129).
//
// Since v129 photos come from the phone's own camera app (or its gallery)
// rather than a viewfinder inside Scope: better focus, flash and low light,
// which is what a subfloor needs. The catch is size. A phone camera photo is
// 3 to 12 MB at 4000 pixels across, and every one of them is stored on the
// phone, uploaded, and read by the AI, which refuses images over about 5 MB.
//
// So each one is made a sensible size here: at most 2048 pixels on its long
// side, saved as a JPEG. That is far more than a report page or an AI read
// needs, and keeps fine detail (frass, mud tubes, a moisture reading on a
// meter screen) clear when zoomed. Typically 400 KB to 1 MB.
//
// It is drawn through an <img>, which applies the photo's own rotation
// (EXIF), so a portrait shot stays portrait. If anything at all goes wrong
// (an image the browser cannot decode, no canvas, out of memory) the
// ORIGINAL file is kept: a photo too big is a nuisance, a photo lost is not
// acceptable.
//
// EXPOSES: window.PhotoPrep = { prepare, MAX_EDGE, QUALITY }

(() => {
  'use strict';

  const MAX_EDGE = 2048;
  const QUALITY = 0.85;
  // Already small and already a JPEG: leave it exactly as it is.
  const SMALL_ENOUGH_BYTES = 900 * 1024;

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not decode the photo')); };
      img.src = url;
    });
  }

  async function prepare(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
    if (!file || !(file instanceof Blob)) return file;
    if (!/^image\//.test(file.type || 'image/')) return file;
    try {
      const img = await loadImage(file);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return file;
      const longEdge = Math.max(w, h);
      if (longEdge <= maxEdge && file.type === 'image/jpeg' && file.size <= SMALL_ENOUGH_BYTES) return file;
      const scale = Math.min(1, maxEdge / longEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const g = canvas.getContext('2d');
      if (!g) return file;
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      // Never swap a photo for something bigger, or for nothing.
      if (!out || !out.size || (out.size >= file.size && longEdge <= maxEdge)) return file;
      return out;
    } catch (e) {
      console.warn('[photo-prep] kept the original photo:', (e && e.message) || e);
      return file;
    }
  }

  window.PhotoPrep = { prepare, MAX_EDGE, QUALITY };
})();
