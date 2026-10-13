// Small helpers every screen used to carry its own copy of (v125).
//
// Thirteen copies of toast(), seventeen of the confirm/prompt pair, ten of
// el(), eleven of escapeHtml. Each was tiny and they all behaved the same,
// which is exactly why they drifted: a fix made in one never reached the
// others. They live here now, once.
//
// Only helpers that were IDENTICAL everywhere moved. Ones that merely look
// alike stay where they are, because they differ on purpose: the date
// formatters that print "never" for a missing date, or follow the phone's
// own locale; the three plural() helpers with different arguments; the
// element builders el(tag, ...) in job-details.js, today-ui.js, photo-walk.js
// and reminders-ui.js. Moving those would have changed what people see.
//
// Everything reaches for its dependency at the moment it is called, never at
// load: appToast is defined by app.js, which loads after most screens, and
// Dialog by dialog.js. Loaded straight after html-safe.js and dialog.js.
//
// EXPOSES: window.Common = { toast, askConfirm, askPrompt, el, escapeHtml,
//   fmtDay, money, pad2 }

(() => {
  'use strict';

  // A message at the bottom of the screen; the console when the app shell
  // that draws it is not there (the test page, a print window).
  const toast = (msg) => (window.appToast ? window.appToast(msg) : console.log(msg));

  // In-app confirm and prompt. The native ones return immediately with
  // nothing on screen in an installed iOS home-screen app (see dialog.js), so
  // they are only the fallback for a page without dialog.js.
  const askConfirm = (msg, opts) => (window.Dialog
    ? window.Dialog.confirm(msg, opts)
    : Promise.resolve(window.confirm(msg)));
  const askPrompt = (msg, def, opts) => (window.Dialog
    ? window.Dialog.prompt(msg, def, opts)
    : Promise.resolve(window.prompt(msg, def)));

  const el = (id) => document.getElementById(id);

  // Every piece of text put into HTML goes through this (html-safe.js).
  const escapeHtml = (s) => window.HtmlSafe.escape(s);

  // "14 Oct 2026", or '' for no date.
  const fmtDay = (ts) => (ts ? new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  // "$1,234.50" from cents, through invoicing.js when it is loaded.
  const money = (cents) => (window.Invoicing
    ? window.Invoicing.formatMoney(cents)
    : `$${((cents || 0) / 100).toFixed(2)}`);

  const pad2 = (n) => String(n).padStart(2, '0');

  window.Common = { toast, askConfirm, askPrompt, el, escapeHtml, fmtDay, money, pad2 };
})();
