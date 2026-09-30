// Opening the camera, and failing in a way somebody can act on.
//
// This was inside app.js's inspection flow, and every line of it is there
// because something went wrong on a real phone:
//
//   - getUserMedia does NOT always settle. Dismiss the OS permission sheet
//     with a swipe rather than answering it and the promise hangs forever
//     with nothing to catch.
//   - So it is raced against a deadline — but a fixed deadline was itself a
//     bug. A first-time user gets a permission sheet, and anyone who reads it
//     before tapping Allow blew through the timeout and was told the camera
//     had failed when it was about to work. The deadline therefore depends on
//     whether a human is still being asked something.
//   - A stream that arrives after we stopped waiting has to be released, or
//     the camera indicator light stays on with nobody holding a reference.
//   - Browsers only expose the camera in a secure context. Served over plain
//     http from a LAN address — exactly how somebody tests a build on their
//     phone — navigator.mediaDevices is undefined, and reaching straight for
//     getUserMedia throws "Cannot read properties of undefined", which tells
//     a technician nothing.
//
// It moved here when the QR scanner needed the same camera. Two copies of
// this would have meant the scanner slowly re-learning all of it.
//
// Errors carry a `code` rather than a sentence, because what to say depends
// on what the caller was trying to do — MESSAGES has the default wording for
// callers with nothing better to say.
(() => {
  'use strict';

  const MESSAGES = {
    insecure: 'The camera needs a secure connection (https). Open the app on its https address rather than an IP address.',
    unsupported: 'This browser does not support camera capture.',
    denied: 'Camera access is blocked for this site. Allow it in your browser settings, then try again.',
    blocked: 'Camera access was blocked. Allow it for this site in your browser settings, then try again.',
    timeout: 'The camera never responded. Check this site has camera permission, then try again.',
    notfound: 'No camera was found on this device.',
    cancelled: null, // their own choice — no error language for it
    failed: 'Could not start the camera.',
  };

  function fail(code, cause) {
    const err = new Error(code);
    err.code = code;
    if (cause) err.cause = cause;
    return err;
  }

  function messageFor(err) {
    const code = (err && err.code) || 'failed';
    if (code === 'cancelled') return null;
    const base = MESSAGES[code] || MESSAGES.failed;
    if (code === 'failed' && err && err.cause && err.cause.message) {
      return `${base} ${err.cause.message}`;
    }
    return base;
  }

  // opts.video      — the video constraints (defaults to a rear-facing stream)
  // opts.isCancelled— called repeatedly; return true to abandon the wait, so a
  //                   second tap on the button can back out of a hung prompt
  async function open(opts) {
    const o = opts || {};

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw fail(window.isSecureContext ? 'unsupported' : 'insecure');
    }

    let permission = 'unknown';
    try {
      if (navigator.permissions && navigator.permissions.query) {
        permission = (await navigator.permissions.query({ name: 'camera' })).state;
      }
    } catch (e) { /* Safari and Firefox may not expose 'camera' — fall through */ }

    if (permission === 'denied') throw fail('denied');

    // Already granted: the camera should appear quickly, so a short deadline
    // is right. Still being asked: give a person a genuinely human amount of
    // time to read the sheet.
    const deadlineMs = permission === 'granted' ? 20000 : 120000;
    let gaveUp = false;

    const request = navigator.mediaDevices.getUserMedia({
      video: o.video || {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      // No microphone. Neither photographs nor QR codes have any use for one,
      // and not asking is both one less permission prompt and one less thing
      // recorded inside a client's home.
      audio: false,
    });
    request.then((late) => { if (gaveUp) late.getTracks().forEach((t) => t.stop()); }).catch(() => {});

    try {
      return await Promise.race([
        request,
        new Promise((_, reject) => setTimeout(() => {
          gaveUp = true;
          reject(fail('timeout'));
        }, deadlineMs)),
        new Promise((_, reject) => {
          const poll = setInterval(() => {
            if (gaveUp || (o.isCancelled && o.isCancelled())) {
              gaveUp = true;
              clearInterval(poll);
              reject(fail('cancelled'));
            }
          }, 150);
          setTimeout(() => clearInterval(poll), deadlineMs + 1000);
        }),
      ]);
    } catch (err) {
      gaveUp = true;
      if (err && err.code) throw err;
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw fail('blocked', err);
      if (err && err.name === 'NotFoundError') throw fail('notfound', err);
      throw fail('failed', err);
    }
  }

  function release(stream) {
    if (!stream) return;
    try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* already gone */ }
  }

  window.Camera = { open, release, messageFor, MESSAGES };
})();
