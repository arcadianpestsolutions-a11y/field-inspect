// Bump APP_VERSION alongside sw.js's CACHE_NAME on every deploy. Drives the
// "BUILD vN" label on the login screen so testers can tell at a glance
// whether they're looking at the current build or a stale cached one,
// instead of having to dig into devtools to check.
window.APP_VERSION = 'v66';

(() => {
  function hashToHue(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }

  const label = document.getElementById('build-version-label');
  if (!label) return;

  // The build identity now lives entirely in this label, not in a
  // full-screen wash behind it.
  //
  // It used to tint the whole login view from a hue hashed off the version
  // string, which made builds unmistakably distinct — and also meant every
  // other deploy opened on an arbitrary purple or magenta that had nothing
  // to do with the rest of the app. The point was never the colour of the
  // screen; it was being able to tell two builds apart in a second. The
  // label says the version in words, so it can do that job alone.
  //
  // What varies per build is kept inside the instrument palette: a hue
  // rotation of at most ±25° around phosphor green (145°), so consecutive
  // builds still read as visibly different without any of them looking like
  // a different product.
  const spread = (hashToHue(window.APP_VERSION) % 51) - 25; // -25..+25
  label.textContent = `Build ${window.APP_VERSION}`;
  label.style.color = `hsl(${145 + spread}, 85%, 62%)`;
})();
