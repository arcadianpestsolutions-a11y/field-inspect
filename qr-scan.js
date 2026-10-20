// Reading the QR sticker inside a bait station cap.
//
// THE PHONE'S OWN CAMERA APP TAKES THE PICTURE (v130).
// This used to run a live viewfinder inside Scope, which meant asking for
// camera permission, a permission sheet that could hang, a stream that had
// to be released, and a whole module (camera.js) to cope with all of it.
// Now Scan station opens the camera app the technician already knows, they
// photograph the sticker, and the code is read from that one photo. If it
// cannot be read, they are told so and offered another go — never left with
// a screen that does nothing.
//
// WHY BOTH DECODERS.
// BarcodeDetector is built into the browser, costs nothing to ship and is
// faster than anything in JavaScript — and iOS Safari does not have it. A
// technician on an iPhone is not a fallback case in this business, it is the
// common case, so jsQR is vendored alongside and used wherever the native one
// is missing or finds nothing.
//
// NOTHING IS KEPT. The photo is decoded in memory and thrown away. It is not
// stored with the job, uploaded or attached to anything — here the camera is
// a barcode reader, not a camera.
//
// WHY THE SCAN IS THE POINT.
// A monitoring system is eight to thirty stations around one house. Finding
// station 17 in a list while kneeling in a garden bed is how a finding gets
// recorded against station 19 — and the station register is the evidence the
// warranty rests on, so that is not a typo, it is a false record. Scanning
// the cap removes the step where the mistake happens.
(() => {
  'use strict';

  const modal = document.getElementById('qr-modal');
  const input = document.getElementById('qr-camera-input');
  const hintEl = document.getElementById('qr-hint');
  const retryBtn = document.getElementById('qr-retry-btn');
  const cancelBtn = document.getElementById('qr-cancel-btn');
  if (!modal || !input) return;

  const { toast } = window.Common;

  // The scan in progress: { resolve }. Only one at a time.
  let pending = null;
  let detector = null;

  function settle(value) {
    if (!pending) return;
    const p = pending;
    pending = null;
    modal.classList.add('hidden');
    p.resolve(value);
  }

  function showState(state) {
    // 'reading' while the photo is decoded; 'failed' when no code was found.
    modal.classList.remove('hidden');
    if (state === 'reading') {
      hintEl.textContent = 'Reading the sticker…';
      retryBtn.classList.add('hidden');
    } else {
      hintEl.textContent = 'No station sticker could be read in that photo. Hold the phone close enough that the sticker fills most of the picture, keep it steady, and try again.';
      retryBtn.classList.remove('hidden');
    }
  }

  function openCamera() {
    input.value = '';
    input.click();
  }

  async function nativeDetector() {
    if (detector !== null) return detector;
    try {
      if (!('BarcodeDetector' in window)) { detector = false; return false; }
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (!formats.includes('qr_code')) { detector = false; return false; }
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
      detector = false;
    }
    return detector;
  }

  function loadImage(blob) {
    // An <img> rather than createImageBitmap, because Safari's support for
    // the latter has come and gone, and an <img> honours the photo's
    // rotation everywhere.
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      img.src = url;
    });
  }

  // Tried at more than one size. A phone photo is 4000px across; jsQR on all
  // of that is slow, and shrinking too far loses a sticker taken from a
  // metre away. 1024 reads most; 1600 catches a small sticker; 640 catches a
  // blurry close-up, where shrinking actually sharpens the edges.
  const SIZES = [1024, 1600, 640];

  function decodeWithJsQr(img) {
    if (!window.jsQR) return null;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (const size of SIZES) {
      const scale = Math.min(1, size / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (found && found.data) return found.data;
      if (scale === 1) break; // already full size; a bigger pass is the same pass
    }
    return null;
  }

  // Reads the first QR code in a photo. Resolves with its text, or null.
  // Never rejects: a photo that is not a photo is simply one with no code.
  async function decodeFile(file) {
    let img;
    try { img = await loadImage(file); } catch (e) {
      // Shown to the technician as "could not be read"; the reason (a format
      // this browser cannot open, say) is kept for whoever has to fix it.
      if (window.ErrorLog) window.ErrorLog.note(e, 'QR scan: read the photo');
      return null;
    }
    try {
      const native = await nativeDetector();
      if (native) {
        const codes = await native.detect(img);
        if (codes && codes.length && codes[0].rawValue) return codes[0].rawValue;
      }
    } catch (e) {
      // Fall through to jsQR, which reads what the native one sometimes won't.
    }
    try { return decodeWithJsQr(img); } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'QR scan: read the photo');
      return null;
    }
  }

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!pending) return;
    // Backing out of the camera: their decision, not a failure.
    if (!file) { settle(null); return; }
    const scanFor = pending;
    showState('reading');
    const text = await decodeFile(file);
    if (pending !== scanFor) return; // cancelled while it was reading
    if (text) {
      // A short buzz where the hardware has one, because a technician is
      // looking at the station, not at the screen.
      try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* not supported */ }
      settle(text);
    } else {
      showState('failed');
    }
  });
  // Newer browsers say when the camera was closed without a photo. Only
  // the first try ends the scan; after a failed read the screen with
  // Try again stays up, so the technician decides.
  input.addEventListener('cancel', () => {
    if (pending && modal.classList.contains('hidden')) settle(null);
  });

  retryBtn.addEventListener('click', () => { if (pending) openCamera(); });
  cancelBtn.addEventListener('click', () => settle(null));

  // Resolves with the decoded text, or null if the technician backed out.
  // Never rejects: a scanner that throws at somebody kneeling in a garden bed
  // is a scanner they stop using.
  //
  // Must be called straight from a tap: phones only open the camera app in
  // response to one, so nothing here waits before input.click().
  function scan() {
    // A camera closed without the browser saying so leaves a scan hanging.
    // The next tap is proof it is over.
    settle(null);
    return new Promise((resolve) => {
      pending = { resolve };
      openCamera();
    });
  }

  // Scans, and only accepts one of Scope's own station stickers. Anything
  // else — a parcel label, a wifi QR taped to a fridge — is refused by name
  // rather than silently doing nothing, because "I scanned it and nothing
  // happened" is the worst possible outcome.
  async function scanStation() {
    const text = await scan();
    if (text === null) return null;
    const assetId = window.Assets ? window.Assets.parseQr(text) : null;
    if (!assetId) {
      toast('That is not a Scope station sticker.');
      return null;
    }
    return assetId;
  }

  window.QrScan = {
    scan,
    scanStation,
    // Exposed so the suite can check the decode path without a camera.
    decodeFile,
    isAvailable: () => true,
  };
})();
