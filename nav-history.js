// The phone's own Back button, made to mean "back one screen".
//
// WHY THIS EXISTS. The app is a single page that swaps screens by hiding and
// showing them, and until now it never told the browser it had moved. So the
// browser's history held one entry however deep somebody had gone, and the
// system Back button (Android's, or the edge swipe that stands in for it) left
// the app altogether from any screen: from the middle of a report section, with
// half a sentence typed, one reflex press and the app was gone. It is the most
// natural gesture on a phone and the one thing here that did not work.
//
// THE DESIGN IS ONE SENTINEL ENTRY, NOT A STACK.
// While anything is open that Back should close — a screen other than the job
// list, a dialog, a panel — exactly one extra history entry sits above the
// page's own. Pressing Back removes it, which is the browser telling us it
// happened; we answer by doing precisely what tapping the on-screen Back button
// would do, and put the sentinel straight back if there is still somewhere to
// go. At the job list with nothing open there is no sentinel, so Back behaves
// as it always did and leaves the app — the ordinary way out.
//
// WHY NOT ONE ENTRY PER SCREEN. Every on-screen Back button would then need to
// pop an entry too, in every module, and the first one forgotten leaves history
// out of step with the screens for the rest of the session. One sentinel is
// restored by a single observer, whatever route got somebody to a screen, so
// there is nothing for any screen to remember.
//
// "WHAT WOULD TAPPING BACK DO" IS DELIBERATELY NOT RE-IMPLEMENTED. This clicks
// the button a person would have tapped. Every screen's Back already does the
// right thing for that screen — asks before discarding typed text, stops a
// recording, releases the camera — and all of it comes along for free.
(() => {
  'use strict';

  if (window.NavHistory) return;

  // Screens with nowhere above them. The login screen is here too: nothing to go
  // back to, and a Back press there should leave.
  const ROOT_VIEWS = new Set(['view-joblist', 'view-login']);

  // Overlays Back should close first, nearest-to-the-finger first. Ids, because
  // every one of them already has a working close or cancel button and that is
  // the thing to press.
  const OVERLAY_CLOSERS = [
    'detail-close', 'bulk-zone-cancel', 'qr-cancel-btn', 'slot-picker-cancel', 'record-cancel',
    'client-link-close', 'agent-close', 'calendar-feed-close', 'reminders-close',
    'selection-cancel-btn', 'more-close-btn', 'job-form-cancel',
  ];

  // The live camera. Back does NOT close this: it would end an inspection with a
  // reflex, and the photographs and recording in progress are not recoverable.
  // Swallowed with a word of explanation instead.
  const GUARDED_MODALS = ['inspection-modal'];

  // The history API behind a seam. A page inside an iframe shares session
  // history with the page that holds it, so the test suite must not push real
  // entries; it swaps this for a recorder.
  const realHistory = {
    push() { try { window.history.pushState({ scopeNav: 1 }, ''); } catch (e) { /* history unavailable */ } },
    back() { try { window.history.back(); } catch (e) { /* history unavailable */ } },
  };
  const defaultHistory = window.IS_TEST ? { push() {}, back() {} } : realHistory;
  let hist = defaultHistory;

  let hasSentinel = false;
  // Removing the sentinel ourselves also raises a popstate. That one is not a
  // person pressing Back and must not be acted on. Time-limited, so a browser
  // that never raises it cannot leave the next real Back press ignored.
  let ignoreUntil = 0;
  const IGNORE_WINDOW_MS = 700;

  const $ = (id) => document.getElementById(id);
  const shown = (el) => !!el && el.getBoundingClientRect().width > 1
    && !el.closest('.hidden') && getComputedStyle(el).visibility !== 'hidden';

  function currentView() {
    const open = Array.from(document.querySelectorAll('section.view')).filter((v) => !v.classList.contains('hidden'));
    return open.length ? open[open.length - 1].id : '';
  }
  const openDialog = () => document.querySelector('body > .app-dialog');
  const guardedOpen = () => GUARDED_MODALS.map($).find((m) => m && !m.classList.contains('hidden'));
  const openCloser = () => OVERLAY_CLOSERS.map($).find(shown);

  // Is there something open that a Back press should close?
  function needsSentinel() {
    const view = currentView();
    if (!view) return false;
    return !ROOT_VIEWS.has(view) || !!openDialog() || !!guardedOpen() || !!openCloser();
  }

  // Brings the sentinel in line with what is on screen. Cheap, and safe to call
  // as often as anything changes: it only acts when the two disagree.
  function sync() {
    const need = needsSentinel();
    if (need && !hasSentinel) {
      // NEVER PUSH WHILE OUR OWN REMOVAL IS STILL IN FLIGHT. history.back() is
      // not instant, and a pushState issued before it completes lands first: the
      // browser's belated "back" then removes the NEW entry instead of the old
      // one. The page believes an entry is armed that is not, and the next real
      // Back press leaves the app. Caught by a test that went from the job list
      // into a screen within a few milliseconds; any code that returns to the
      // list and carries straight on can do the same. Wait for the removal's
      // popstate (or the time limit), then look again.
      if (Date.now() < ignoreUntil) { setTimeout(sync, 30); return; }
      hist.push();
      hasSentinel = true;
    } else if (!need && hasSentinel) {
      // Nothing left for Back to close: take our entry away, so the next press
      // leaves the app instead of seeming to do nothing.
      hasSentinel = false;
      ignoreUntil = Date.now() + IGNORE_WINDOW_MS;
      hist.back();
    }
  }

  // Does what tapping Back would do, and says what that was. Never throws: a
  // Back press that breaks something is worse than one that does nothing.
  function handleBack() {
    try {
      const dialog = openDialog();
      if (dialog) {
        const cancel = dialog.querySelector('.btn-secondary') || dialog.querySelector('button');
        if (cancel) cancel.click();
        return 'closed a dialog';
      }
      if (guardedOpen()) {
        if (typeof window.appToast === 'function') window.appToast('Finish or cancel the inspection first.');
        return 'ignored: inspection in progress';
      }
      const closer = openCloser();
      if (closer) { closer.click(); return 'closed ' + closer.id; }

      const view = currentView();
      if (!view || ROOT_VIEWS.has(view)) return 'nothing to go back to';
      // Exact suffix, not a loose match: "backlog" is an id on the scheduler too.
      const back = Array.from(document.querySelectorAll('#' + view + ' button[id$="back-btn"]')).find(shown);
      if (back) { back.click(); return 'back from ' + view; }
      return 'no back button on ' + view;
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'handling the Back button');
      return 'failed';
    }
  }

  // The browser reports a Back press by removing the sentinel.
  function onPop(ev) {
    if (Date.now() < ignoreUntil) {
      ignoreUntil = 0;
      // The removal is finished. A screen opened while it was in flight has been
      // waiting for exactly this to get its entry.
      schedule();
      return 'ignored: our own';
    }
    // Landing ON the sentinel is the Forward button re-entering the entry we
    // removed earlier, not somebody pressing Back. Treat it as the sentinel
    // existing again and let sync() keep or remove it as the screen requires;
    // otherwise a stale entry would make the next Back press look like nothing
    // happened, and leaving the app would take two.
    if (ev && ev.state && ev.state.scopeNav) {
      hasSentinel = true;
      sync();
      return 'forward onto the sentinel';
    }
    hasSentinel = false;
    // Restore the sentinel FIRST, before acting. A second press that arrives
    // while the first is still being handled must find something to remove, or
    // it removes the page's own entry and takes the app with it.
    if (needsSentinel()) { hist.push(); hasSentinel = true; }
    const did = handleBack();
    // The press may have navigated, closed an overlay, or opened a confirmation
    // ("discard your typing?"). Whatever it did, bring the sentinel into line
    // with the result.
    setTimeout(sync, 0);
    return did;
  }

  // Watches for any screen, dialog or panel opening or closing. Class changes
  // are all this app ever uses to show or hide anything, so that is all that is
  // watched, collapsed to one check per burst of changes.
  //
  // A plain timer, not requestAnimationFrame: frames do not run while a page is
  // hidden, so a screen change made while the app was in the background would
  // leave the sentinel out of step until somebody looked at it again.
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { sync(); } catch (e) { /* never break the page */ } }, 0);
  }
  function start() {
    if (!document.body) return;
    new MutationObserver(schedule).observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
    });
    window.addEventListener('popstate', onPop);
    schedule();
  }

  window.NavHistory = {
    // For the suite and the chaos harness.
    handleBack, onPop, sync, needsSentinel,
    hasSentinel: () => hasSentinel,
    isConsuming: () => Date.now() < ignoreUntil,
    // Passing nothing restores the default, which under test is a no-op: never
    // the real history, which a test iframe shares with the page that holds it.
    setHistory(h) { hist = h || defaultHistory; hasSentinel = false; ignoreUntil = 0; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
