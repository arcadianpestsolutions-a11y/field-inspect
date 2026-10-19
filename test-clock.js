// A fixed clock for the test suite (v126). Does nothing in normal use.
//
// Two dozen tests book jobs on "the 9th of this month" or "the 19th", and the
// scheduler rightly treats a past time differently from a future one. So the
// suite passed early in a month and failed later in it: on the 14th one test
// broke, on the 20th another. A test that depends on the day it is run is a
// test that cannot be trusted on any day.
//
// When the test page switches it on, this shifts the clock so the app believes
// it is a fixed moment (TEST_NOW, below) and then lets time run on normally
// from there. "Today", "this month" and the day of the week are then the same
// on every run, whatever the real date is.
//
// ONLY in a test page (?test=1, or the /tests/ folder) AND only when the test
// page has stored the offset in sessionStorage for this tab. Neither is true
// for anybody using the app, so in normal use this file returns on its first
// line. Loaded straight after error-log.js (which must stay first), before
// anything else reads the time.

(() => {
  'use strict';

  const KEY = 'scope-test-clock-offset';
  // Sunday 1 November 2026, 7am Sydney. Just after this was written, so dates
  // the tests treat as "next year" (2027) are still in the future, and early
  // enough in the morning that every booking on any day of the month is ahead.
  const TEST_NOW = new Date(2026, 10, 1, 7, 0, 0, 0).getTime();

  function install(offset) {
    if (!offset || window.Date.__testClock) return;
    const RealDate = window.Date;
    class TestDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...args);
      }
      static now() { return RealDate.now() + offset; }
    }
    TestDate.__testClock = true;
    TestDate.__offset = offset;
    TestDate.RealDate = RealDate;
    window.Date = TestDate;
  }

  window.TestClock = {
    KEY,
    TEST_NOW,
    // Called by the test page: work out the offset once, store it for the
    // frame, and shift this window too.
    start() {
      // Already shifted (an earlier run in this tab): keep that offset, so this
      // page and the app in the frame always agree on what time it is.
      const offset = window.Date.__testClock
        ? window.Date.__offset
        : TEST_NOW - window.Date.now();
      try { sessionStorage.setItem(KEY, String(offset)); } catch (e) { /* tests then run on the real clock */ }
      install(offset);
      return offset;
    },
  };

  let isTest = false;
  try {
    isTest = new URLSearchParams(location.search).has('test') || (location.pathname || '').includes('/tests/');
  } catch (e) { /* not a page with a location */ }
  if (!isTest) return;
  let stored = 0;
  try { stored = Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { /* no storage */ }
  install(stored);
})();
