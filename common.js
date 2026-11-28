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
//   fmtDay, money, pad2, adminOnlyDelete, wirePrint, pdfSheet, settled,
//   loadScript, ensureHtml2pdf }
// Also listens for input across the page and says when a box is full.

(() => {
  'use strict';

  // A message at the bottom of the screen; the console when the app shell
  // that draws it is not there (the test page, a print window).
  const toast = (msg, opts) => (window.appToast ? window.appToast(msg, opts) : console.log(msg));

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

  // Only an admin deletes the shared lists (clients, enquiries, safety
  // statements), and the server enforces it (migration 050). Asked before the
  // delete, so a technician gets a reason instead of a record that quietly
  // comes back on the next sync. Resolves true when the delete may go ahead.
  // No signed-in session means no server rule to mirror: demo, a local-only
  // phone, the test page.
  async function adminOnlyDelete(what) {
    const S = window.Sync;
    if (window.IS_DEMO || !S || typeof S.isAdmin !== 'function') return true;
    if (typeof S.currentUser === 'function' && !S.currentUser()) return true;
    if (S.isAdmin()) return true;
    const say = `Only an admin can delete ${what}. Ask whoever runs Scope for your business to delete it.`;
    if (window.Dialog) await window.Dialog.alert(say, { title: 'Ask an admin' });
    else toast(say);
    return false;
  }

  // The "Print / Save as PDF" button in a print window (a report, an invoice,
  // the chemical register, an SOP). Wired from here: the window inherits the
  // app's Content-Security-Policy, which refuses onclick="" (v186), and the
  // buttons silently did nothing until v188.
  function wirePrint(win) {
    if (!win || !win.document) return;
    for (const btn of win.document.querySelectorAll('[data-print]')) btn.addEventListener('click', () => win.print());
  }

  // A box that is full says so (break-it run, 28 Nov 2026). A pasted name
  // longer than the box holds was cut at the limit without a word, and the
  // job was saved under half a name. Once per filling: the browser lets no
  // more in, so the next keystroke does nothing and fires nothing.
  const fullSaid = new WeakSet();
  function limitReached(e) {
    const t = e.target;
    if (!t || typeof t.value !== 'string' || !(t.maxLength > 0)) return;
    if (t.value.length < t.maxLength) { fullSaid.delete(t); return; }
    if (fullSaid.has(t)) return;
    fullSaid.add(t);
    toast(`That is as much as this box holds (${t.maxLength} characters). Anything longer was dropped.`);
  }
  document.addEventListener('input', limitReached, true);

  // The white sheet a PDF is drawn on. html2pdf rasterises what is on screen,
  // so for a few seconds the raw report covers the app and every tap lands on
  // it (overnight run, 28 Nov 2026: the tapper hit it nine times in a row).
  // The banner says why. It sits outside the part that is drawn.
  function pdfSheet() {
    const overlay = document.createElement('div');
    overlay.className = 'pdf-sheet';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow:auto;';
    const banner = document.createElement('div');
    banner.className = 'pdf-sheet-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'Making the PDF. This takes a few seconds.';
    banner.style.cssText = 'position:sticky;top:0;z-index:1;padding:12px 16px;background:#0b0f0d;color:#e2e8f0;font:600 15px/1.3 system-ui,sans-serif;text-align:center;';
    overlay.appendChild(banner);
    return overlay;
  }

  // Every <img> under root loaded and two frames painted: what html2canvas
  // captures is whatever is drawn at that instant, so a still-loading photo
  // came out blank. Called by all three PDF builders.
  async function settled(root) {
    await Promise.all(Array.from(root.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // A script fetched when it is first needed, not at start. Same origin, so
  // the Content-Security-Policy allows it; still in the offline shell
  // (sw.js), so it is there with no signal.
  const scriptLoads = new Map();
  function loadScript(src) {
    if (!scriptLoads.has(src)) {
      scriptLoads.set(src, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => { scriptLoads.delete(src); reject(new Error('could not load ' + src)); };
        document.head.appendChild(s);
      }));
    }
    return scriptLoads.get(src);
  }
  // html2pdf is 885 KB, the largest file in the app, and a PDF is made once
  // a day at most; it used to be parsed on every start (overnight run,
  // 29 Nov 2026). Every PDF builder calls this first.
  async function ensureHtml2pdf() {
    if (!window.html2pdf) await loadScript('vendor/html2pdf.bundle.min.js');
    if (!window.html2pdf) throw new Error('PDF library not loaded');
    return window.html2pdf;
  }

  window.Common = { toast, askConfirm, askPrompt, el, escapeHtml, fmtDay, money, pad2, adminOnlyDelete, wirePrint, pdfSheet, settled, loadScript, ensureHtml2pdf };
})();
