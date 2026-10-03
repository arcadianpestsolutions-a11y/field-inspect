// What went wrong, written down, so "it broke" can become "it broke HERE".
//
// Until this existed there was exactly one global error handler in the whole
// app, and it lived in report.js. Everywhere else, a failure while a
// technician was under a house with no signal meant a button that simply did
// nothing: no message, no record, nothing left afterwards to debug from. The
// first real job produced "adding a job wasn't working" and no trace of why —
// it could not be reproduced and could not be explained, so it was guessed at.
//
// WHAT IT DOES, IN ORDER OF IMPORTANCE
//   1. Records every uncaught error and unhandled promise rejection in a small
//      ring buffer in localStorage. That works offline, which is exactly when
//      it matters.
//   2. Says one plain sentence on screen, so the person is not left tapping a
//      dead button wondering whether it registered.
//   3. Sends the record to the server whenever there is a session and a
//      connection, so it can be read without anybody copying anything out of a
//      phone. Offline, the queue just waits.
//   4. Lets a person copy the log as text (Archive screen), as a fallback for
//      when none of that worked.
//
// LOADED FIRST, before every other script, on purpose: a failure while the
// rest of the app is still loading is exactly the kind that otherwise leaves a
// blank screen and nothing else.
//
// IT MUST NEVER BE THE PROBLEM. Every path in here is wrapped so that a fault
// in the logger is swallowed rather than reported — a handler that throws
// inside an error handler is how a minor bug becomes an infinite loop. It also
// never records its own failures to send.
//
// WHAT IT KEEPS, AND WHAT IT DELIBERATELY DOES NOT
//   Kept: the message, where it came from (file:line), a trimmed stack, the
//   build version, which screen was showing, online/offline, and when.
//   Not kept: anything the person typed, any client's name or address, any
//   report content. Messages are cut to 300 characters and stacks to 1200 so a
//   stray value that happens to be embedded in an error string cannot travel
//   far, and nothing but the error itself is ever read.
(() => {
  'use strict';

  const KEY = 'scope-error-log-v1';
  const MAX_ENTRIES = 40;
  const MAX_MESSAGE = 300;
  const MAX_STACK = 1200;
  // The same error repeating in a loop (a render failing on every tick) must
  // be one entry with a count, not forty identical lines that push out
  // everything else.
  const DEDUPE_MS = 5000;
  // One sentence on screen at most this often. A failure that fires on every
  // keystroke must not turn the screen into a wall of toasts.
  const TOAST_EVERY_MS = 15000;

  const params = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
  // Same test the app uses (db.js sets window.IS_TEST from this), repeated
  // here because this file loads before db.js and has to decide on its own.
  const IS_TEST = !!params.get('test') || (location.pathname || '').includes('/tests/');
  const IS_DEMO = !!params.get('demo');

  let lastToastAt = 0;
  let flushing = false;
  let flushTimer = null;
  // In-memory fallback for when localStorage is blocked (private windows,
  // cleared site data). The log is still useful for the rest of the session.
  let memory = [];

  // ---- storage -------------------------------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return memory.slice();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return memory.slice();
    }
  }

  function save(entries) {
    memory = entries.slice(-MAX_ENTRIES);
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (e) { /* blocked or full — memory copy stands */ }
    try { window.dispatchEvent(new CustomEvent('errorlog-changed')); } catch (e) { /* nobody listening */ }
  }

  // ---- shaping -------------------------------------------------------------
  const clip = (value, max) => String(value == null ? '' : value).slice(0, max);

  function currentScreen() {
    try {
      const el = document.querySelector('section.view:not(.hidden)');
      return el && el.id ? el.id.replace(/^view-/, '') : '';
    } catch (e) { return ''; }
  }

  function newId() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Noise that is not a fault in the app. Each is a real thing that fires
  // constantly in browsers and means nothing, and logging them buries the
  // entries that do.
  function isNoise(message, kind, reasonName) {
    const m = String(message || '');
    // Browsers fire this when a layout settles mid-frame. Harmless, constant.
    if (/ResizeObserver loop/i.test(m)) return true;
    // A cross-origin script failing reports only this, with no file or line —
    // usually a browser extension, and there is nothing here to diagnose.
    if (m === 'Script error.' || m === 'Script error') return true;
    // Somebody cancelling something (closing the camera, backing out of a
    // picker) is not a failure.
    if (kind === 'rejection' && reasonName === 'AbortError') return true;
    return false;
  }

  // Offline, a failed fetch is the expected result rather than a bug. Still
  // recorded — it can explain a "nothing saved" later — but never announced.
  function isExpectedOffline(message) {
    if (typeof navigator !== 'undefined' && navigator.onLine !== false) return false;
    return /failed to fetch|networkerror|load failed|network request failed/i.test(String(message || ''));
  }

  // ---- recording -----------------------------------------------------------
  function record(kind, message, source, line, col, stack, reasonName) {
    try {
      if (isNoise(message, kind, reasonName)) return null;

      const now = Date.now();
      const entries = load();
      const msg = clip(message, MAX_MESSAGE);
      const src = clip(source, 200);

      // Same thing again within a few seconds: bump the count, do not add a row.
      const prev = entries[entries.length - 1];
      if (prev && prev.message === msg && prev.source === src && prev.kind === kind
        && now - prev.at < DEDUPE_MS) {
        prev.count = (prev.count || 1) + 1;
        prev.lastAt = now;
        save(entries);
        return prev;
      }

      const entry = {
        id: newId(),
        at: now,
        lastAt: now,
        count: 1,
        kind,
        message: msg,
        source: src,
        line: Number(line) || null,
        col: Number(col) || null,
        stack: clip(stack, MAX_STACK),
        version: clip(window.APP_VERSION || '', 20),
        screen: currentScreen(),
        online: typeof navigator !== 'undefined' ? navigator.onLine !== false : null,
        sent: false,
      };
      entries.push(entry);
      save(entries);

      if (!isExpectedOffline(msg)) announce(now);
      scheduleFlush();
      return entry;
    } catch (e) {
      return null; // the logger never throws
    }
  }

  // One plain sentence. Not the error text: "Cannot read properties of
  // undefined" means nothing to somebody mid-job, and it is already written
  // down for the person who can use it.
  function announce(now) {
    try {
      if (IS_TEST) return; // the suite throws on purpose; it must not paint over itself
      if (now - lastToastAt < TOAST_EVERY_MS) return;
      lastToastAt = now;
      if (typeof window.appToast === 'function') {
        window.appToast('Something went wrong. It has been noted.');
      }
    } catch (e) { /* swallowed */ }
  }

  window.addEventListener('error', (ev) => {
    try {
      const err = ev && ev.error;
      record('error', (err && err.message) || (ev && ev.message) || 'Unknown error',
        (ev && ev.filename) || '', ev && ev.lineno, ev && ev.colno, err && err.stack);
    } catch (e) { /* swallowed */ }
  });

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const r = ev && ev.reason;
      const message = r && typeof r === 'object' ? (r.message || r.error_description || r.code || String(r)) : String(r);
      record('rejection', message || 'Unhandled promise rejection', '', null, null,
        r && r.stack, r && r.name);
    } catch (e) { /* swallowed */ }
  });

  // ---- sending -------------------------------------------------------------
  // Only with a real session. The insert is allowed for any signed-in user of
  // a business and for nobody else, so a signed-out device simply keeps its
  // queue until somebody signs in.
  function canSend() {
    try {
      if (IS_TEST || IS_DEMO) return false;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
      if (!window.supabaseClient) return false;
      const user = window.Sync && typeof window.Sync.currentUser === 'function' ? window.Sync.currentUser() : null;
      return !!user;
    } catch (e) { return false; }
  }

  function scheduleFlush(delay) {
    try {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flush(); }, delay == null ? 3000 : delay);
    } catch (e) { /* swallowed */ }
  }

  async function flush() {
    // Re-entrancy guard. A failure inside the send must not start another
    // send, and two overlapping flushes would insert the same row twice.
    if (flushing) return;
    flushing = true;
    try {
      if (!canSend()) return;
      const entries = load();
      const pending = entries.filter((e) => !e.sent);
      if (!pending.length) return;

      const user = window.Sync.currentUser();
      const rows = pending.map((e) => ({
        id: e.id,
        occurred_at: e.at,
        kind: e.kind,
        message: e.message,
        source: e.source,
        line: e.line,
        col: e.col,
        stack: e.stack,
        app_version: e.version,
        screen: e.screen,
        online: e.online,
        occurrences: e.count || 1,
        user_id: user.id || null,
        user_agent: clip(navigator.userAgent, 300),
      }));

      // "On conflict do nothing", so a retry after a half-finished send cannot
      // duplicate a row — and the table never needs UPDATE granted (031).
      const { error } = await window.supabaseClient.from('client_errors')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) return; // a table not yet created, or no signal: try again next time, say nothing

      const sentIds = new Set(pending.map((e) => e.id));
      save(load().map((e) => (sentIds.has(e.id) ? Object.assign({}, e, { sent: true }) : e)));
    } catch (e) {
      /* swallowed — and deliberately NOT recorded, or a failing send logs
         itself, which schedules a send, which fails */
    } finally {
      flushing = false;
    }
  }

  try {
    window.addEventListener('online', () => scheduleFlush(1000));
    // Signing in is when queued entries can finally leave. Checked shortly
    // after load, and then whenever the connection comes back.
    window.addEventListener('load', () => scheduleFlush(6000));
  } catch (e) { /* swallowed */ }

  // ---- reading it back -----------------------------------------------------
  function asText() {
    const entries = load();
    if (!entries.length) return 'No problems recorded on this device.';
    const lines = ['Scope problem log — ' + (window.APP_VERSION || 'unknown build'), ''];
    for (const e of entries.slice().reverse()) {
      lines.push(new Date(e.at).toISOString() + (e.count > 1 ? '  (x' + e.count + ')' : ''));
      lines.push('  ' + e.kind + ': ' + e.message);
      if (e.source || e.line) lines.push('  at ' + (e.source || '?') + ':' + (e.line || '?') + ':' + (e.col || '?'));
      lines.push('  build ' + (e.version || '?') + ' · screen ' + (e.screen || '?') + ' · ' + (e.online === false ? 'offline' : 'online'));
      if (e.stack) lines.push('  ' + e.stack.split('\n').slice(0, 6).join('\n  '));
      lines.push('');
    }
    return lines.join('\n');
  }

  // ---- the Archive-screen button ------------------------------------------
  // Wired from here rather than from app.js so the whole feature is one file
  // plus one button, and so it is guarded the way every late-added control in
  // this app is: a device running a half-updated index.html finds no button
  // and does nothing, instead of throwing on a null.
  function wireButton() {
    try {
      const btn = document.getElementById('error-log-btn');
      const hint = document.getElementById('error-log-hint');
      if (!btn || !hint) return;

      const refresh = () => {
        const n = load().length;
        btn.textContent = n ? 'Copy problem log (' + n + ')' : 'Copy problem log';
        hint.textContent = n
          ? 'Copies what went wrong on this device as text, to paste to whoever is fixing it. '
            + 'It holds error details only — no client names or report content.'
          : 'Nothing has gone wrong on this device.';
      };
      refresh();
      window.addEventListener('errorlog-changed', refresh);

      btn.addEventListener('click', async () => {
        const text = asText();
        try {
          await navigator.clipboard.writeText(text);
          if (window.appToast) window.appToast('Problem log copied');
        } catch (e) {
          // Clipboard access is refused in some in-app browsers. A temporary
          // selected textarea is the older route and still works in most.
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (window.appToast) window.appToast(ok ? 'Problem log copied' : 'Copy blocked here');
          } catch (e2) {
            if (window.appToast) window.appToast('Copy blocked here');
          }
        }
      });
    } catch (e) { /* swallowed */ }
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButton);
    else wireButton();
  } catch (e) { /* swallowed */ }

  window.ErrorLog = {
    // Exposed for a handler that catches an error itself and still wants it on
    // the record — a try/catch that shows "could not save" should say why too.
    note(err, where) {
      try {
        const message = err && err.message ? err.message : String(err);
        return record('handled', (where ? where + ': ' : '') + message, '', null, null, err && err.stack, err && err.name);
      } catch (e) { return null; }
    },
    list: load,
    count: () => load().length,
    unsent: () => load().filter((e) => !e.sent).length,
    asText,
    flush,
    clear() { memory = []; try { localStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ } },
    KEY, MAX_ENTRIES, MAX_MESSAGE, MAX_STACK, DEDUPE_MS,
  };
})();
