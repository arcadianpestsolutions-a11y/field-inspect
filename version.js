// Bump APP_VERSION alongside sw.js's CACHE_NAME on every deploy. Drives a
// color + "Build vN" label on the login screen so testers can tell at a
// glance whether they're looking at the current build or a stale cached
// one, instead of having to dig into devtools to check.
window.APP_VERSION = 'v43';

(() => {
  function hashToHue(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }

  const hue = hashToHue(window.APP_VERSION);
  const loginView = document.getElementById('view-login');
  const label = document.getElementById('build-version-label');

  if (loginView) {
    loginView.style.background = `linear-gradient(160deg, hsl(${hue}, 55%, 18%), var(--bg) 60%)`;
  }
  if (label) {
    label.textContent = `Build ${window.APP_VERSION}`;
    label.style.color = `hsl(${hue}, 70%, 68%)`;
  }
})();
