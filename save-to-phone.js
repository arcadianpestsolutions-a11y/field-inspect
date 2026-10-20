// "Save to phone": a copy of a job's photos in the phone's own photo gallery.
//
// Scope keeps every photo inside the app and the cloud. A web app cannot
// quietly write into the camera roll as well, so this is a button, and it
// takes the route that actually ends in the gallery on each kind of phone:
//
//   iPhone / iPad: the share sheet. Its "Save Image" puts the photos in the
//     Photos app. A download on iOS goes to the Files app instead, where
//     nobody looks for a photo.
//   Android and computers: a download. On Android that lands in Downloads,
//     which the Gallery and Google Photos both show. Android's share sheet
//     has no plain "save to gallery" on most phones, only other apps.
//
// The share sheet only opens straight from a tap, so the caller passes blobs
// it already holds: nothing here waits on the database before sharing.
//
// The copy saved is the photo as Scope keeps it (at most 2048 px, see
// photo-prep.js), which is what goes in the report.
(() => {
  'use strict';

  const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS says it is a Mac

  // File names a person can recognise in a gallery months later:
  // "Scope 12 Smith St - Subfloor - 2026-10-20 (1).jpg".
  function fileName(jobLabel, zone, createdAt, n) {
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const d = new Date(createdAt || Date.now());
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const parts = ['Scope', clean(jobLabel), clean(zone), day].filter(Boolean);
    const base = parts.length > 1 ? `${parts[0]} ${parts.slice(1).join(' - ')}` : parts[0];
    return `${base}${n ? ` (${n})` : ''}.jpg`;
  }

  function filesFor(photos, jobLabel) {
    return photos.map((p, i) => new File([p.blob], fileName(jobLabel, p.zone, p.createdAt, photos.length > 1 ? i + 1 : 0),
      { type: p.blob.type || 'image/jpeg' }));
  }

  // Replaceable by the suite, which cannot have real files land on disk.
  const io = {
    clickLink: (a) => a.click(),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  async function download(files) {
    for (let i = 0; i < files.length; i++) {
      const url = URL.createObjectURL(files[i]);
      const a = document.createElement('a');
      a.href = url;
      a.download = files[i].name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      io.clickLink(a);
      a.remove();
      // Revoked later, not now: the browser reads the file after the click.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      // Spaced out, because a browser that sees several downloads in the
      // same instant may keep only the first.
      if (i < files.length - 1) await io.wait(350);
    }
  }

  // photos: [{ blob, zone, createdAt }]. Resolves 'shared', 'downloaded',
  // 'cancelled' or 'none'. Never rejects, and says nothing itself: the caller
  // knows how to word it.
  async function save(photos, { jobLabel = '' } = {}) {
    const list = (photos || []).filter((p) => p && p.blob);
    if (!list.length) return 'none';
    const files = filesFor(list, jobLabel);

    if (isApple() && navigator.canShare && navigator.share) {
      let shareable = false;
      try { shareable = navigator.canShare({ files }); } catch (e) { shareable = false; }
      if (shareable) {
        try {
          await navigator.share({ files });
          return 'shared';
        } catch (err) {
          // Closing the sheet is a choice. Anything else (the tap was too
          // long ago, say) falls through to a download rather than nothing.
          if (err && err.name === 'AbortError') return 'cancelled';
          if (window.ErrorLog) window.ErrorLog.note(err, 'save to phone: share sheet');
        }
      }
    }
    await download(files);
    return 'downloaded';
  }

  window.SaveToPhone = { save, fileName, isApple, _io: io };
})();
