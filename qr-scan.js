// Reading the QR sticker inside a bait station cap.
//
// WHY BOTH DECODERS.
// BarcodeDetector is built into the browser, costs nothing to ship and is
// faster than anything in JavaScript — and iOS Safari does not have it. A
// technician on an iPhone is not a fallback case in this business, it is the
// common case, so jsQR is vendored alongside and used wherever the native one
// is missing. Native first where it exists, because a decode that happens in
// the browser's own code is one that keeps working when the phone is cold.
//
// NOTHING LEAVES THE DEVICE. Frames are pulled into a canvas, decoded in
// memory and thrown away. No frame is stored, uploaded or recorded — the
// camera here is a barcode reader, not a camera.
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
  const video = document.getElementById('qr-video');
  const hintEl = document.getElementById('qr-hint');
  const cancelBtn = document.getElementById('qr-cancel-btn');
  if (!modal || !video) return;

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));

  let stream = null;
  let running = false;
  let cancelled = false;
  let rafId = null;
  let canvas = null;
  let detector = null;

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (window.Camera) window.Camera.release(stream);
    stream = null;
    video.srcObject = null;
    modal.classList.add('hidden');
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

  function decodeWithJsQr() {
    if (!window.jsQR) return null;
    if (!video.videoWidth) return null;
    if (!canvas) canvas = document.createElement('canvas');
    // Decoded at a capped width. A full 1920px frame costs several times more
    // to scan for no benefit — a QR that cannot be read at 640 across is one
    // the technician needs to move closer to anyway.
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    return found && found.data ? found.data : null;
  }

  // Resolves with the decoded text, or null if the technician backed out.
  // Never rejects: a scanner that throws at somebody kneeling in a garden bed
  // is a scanner they stop using.
  async function scan(opts) {
    const o = opts || {};
    if (running) return null;
    if (!window.Camera) { toast('The camera module did not load. Reopen the app and try again.'); return null; }

    cancelled = false;
    hintEl.textContent = o.hint || 'Point the camera at the sticker inside the station cap.';
    modal.classList.remove('hidden');

    try {
      stream = await window.Camera.open({
        // A barcode does not need 1080p, and a smaller stream starts faster
        // and decodes cheaper.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        isCancelled: () => cancelled,
      });
    } catch (err) {
      // Closing the scanner is a decision, not a failure.
      if (window.ErrorLog && !(err && err.code === 'cancelled')) window.ErrorLog.note(err, 'QR scan: camera');
      stop();
      const message = window.Camera.messageFor(err);
      if (message) toast(message);
      return null;
    }

    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay attribute covers it */ }

    const native = await nativeDetector();
    running = true;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        stop();
        resolve(value);
      };

      cancelBtn.onclick = () => { cancelled = true; finish(null); };

      const tick = async () => {
        if (!running) return;
        let text = null;
        try {
          if (native) {
            const codes = await native.detect(video);
            text = codes && codes.length ? codes[0].rawValue : null;
          } else {
            text = decodeWithJsQr();
          }
        } catch (e) {
          // A single bad frame is not a failure. Detectors throw on frames
          // that arrive mid-resize, and giving up on one would make the
          // scanner look broken at the exact moment the phone rotates.
          text = null;
        }

        if (text) {
          // A short buzz where the hardware has one, because a technician is
          // looking at the station, not at the screen.
          try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* not supported */ }
          finish(text);
          return;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    });
  }

  // Scans, and only accepts one of Scope's own station stickers. Anything
  // else — a parcel label, a wifi QR taped to a fridge — is refused by name
  // rather than silently doing nothing, because "I scanned it and nothing
  // happened" is the worst possible outcome.
  async function scanStation() {
    const text = await scan({ hint: 'Point the camera at the sticker inside the station cap.' });
    if (text === null) return null;
    const assetId = window.Assets ? window.Assets.parseQr(text) : null;
    if (!assetId) {
      toast('That is not a Scope station sticker.');
      return null;
    }
    return assetId;
  }

  cancelBtn.addEventListener('click', () => { cancelled = true; });

  window.QrScan = {
    scan,
    scanStation,
    // Exposed so the suite can assert on the decode path without a camera.
    decodeWithJsQr,
    isAvailable: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  };
})();
