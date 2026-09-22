// "Add this to your home screen" notice — iOS only, and only when the app
// is NOT already running as an installed home-screen app.
//
// WHY THIS IS NOT A NAG
// WebKit deletes all script-writeable storage — IndexedDB included — after
// 7 days without interaction with the site. Everything this app holds
// locally lives in IndexedDB: jobs, reports, captures, the section drafts
// that exist specifically so interrupted work is not lost. In a Safari tab
// that data is on a 7-day timer.
//
// Home-screen web apps are exempt: the first-party storage of an installed
// app whose manifest declares display:standalone (this one's does) is not
// subject to that cap. So on iOS "install it" is not a nicety about having
// an icon — it is the difference between work that persists and work that
// can be deleted out from under a technician between jobs.
//
// Android/Chrome has no equivalent eviction rule, and desktop is not where
// this gets used in the field, so neither is shown this.
(() => {
  'use strict';

  const DISMISS_KEY = 'fi-ios-install-dismissed';

  function isIOS() {
    const ua = navigator.userAgent || '';
    // iPadOS 13+ reports itself as a Mac; the touch-point check is what
    // separates an actual iPad from a desktop Safari on a Mac.
    const iPadOS = /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadOS;
  }

  function isStandalone() {
    // navigator.standalone is the iOS-specific signal and the reliable one
    // there; the media query is the cross-browser standard. Either counts.
    if (navigator.standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function alreadyDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function remember() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* private mode — it reappears, which is the safe way to fail */ }
  }

  function render() {
    const bar = document.createElement('div');
    bar.className = 'ios-install-notice';
    bar.id = 'ios-install-notice';

    const text = document.createElement('div');
    text.className = 'ios-install-text';
    const strong = document.createElement('strong');
    strong.textContent = 'Add Field Inspect to your Home Screen';
    text.appendChild(strong);
    const detail = document.createElement('span');
    detail.textContent = 'Tap Share, then "Add to Home Screen". Until you do, iPhone can delete saved jobs, photos and unfinished reports after 7 days of not opening it.';
    text.appendChild(detail);
    bar.appendChild(text);

    const dismiss = document.createElement('button');
    dismiss.className = 'link-btn ios-install-dismiss';
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      remember();
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    bar.appendChild(dismiss);

    document.body.insertBefore(bar, document.body.firstChild);
  }

  function maybeShow() {
    // Demo mode has its own banner and its data is disposable — two stacked
    // warnings on a screen someone is being shown the app on helps nobody.
    if (window.IS_DEMO || window.IS_TEST) return;
    if (!isIOS() || isStandalone() || alreadyDismissed()) return;
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShow);
  } else {
    maybeShow();
  }

  // Exposed for the test suite, which has to drive the platform checks
  // directly — there is no way to make a desktop test browser report
  // itself as a non-installed iPhone.
  window.IosInstallNotice = { isIOS, isStandalone, render, maybeShow, DISMISS_KEY };
})();
