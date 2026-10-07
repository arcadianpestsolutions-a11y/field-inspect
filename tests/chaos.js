// A clumsy human, as a program. Exploratory testing, not a regression suite.
//
// The ordinary suite checks that features work when used the way they were
// designed. This checks what happens when they are not: tapping Back while the
// camera is still starting, double-tapping Save, typing a name that is a piece
// of HTML, hitting Finalize before anything is filled in, losing signal in the
// middle of a save, importing a photo that is not a photo. It picks controls at
// random from whatever is actually on screen, prefers ones it has not tried
// yet, and after EVERY action checks that nothing broke.
//
// DEMO MODE ONLY, and it cannot be talked out of it. The demo runs on its own
// IndexedDB (field-inspect-db-demo) with invented jobs, no session and no
// network. Load this from a page opened with ?demo=1:
//
//     const s = document.createElement('script'); s.src = '/tests/chaos.js';
//     document.head.appendChild(s);
//     Chaos.run({ seed: 1, steps: 600 });     // returns at once, runs in the page
//     Chaos.report();                         // small JSON, safe to poll
//
// Same seed, same behaviour: a failure can be replayed and, more usefully,
// reduced. It only taps what a finger could reach — an element covered by an
// overlay is skipped, because a handler a person cannot trigger is not a bug a
// person can hit — and elements that are visible but NEVER reachable are
// reported, since "the button is there and cannot be tapped" is a real defect.
(() => {
  'use strict';

  if (window.Chaos) return;
  // Two independent checks, and both must hold. The first is the flag the app
  // itself sets; the second is what it actually did with it, so a future change
  // to how demo mode is detected cannot quietly point this at real data.
  if (!window.IS_DEMO || window.IS_TEST) {
    throw new Error('chaos.js refuses to run outside ?demo=1. It deletes things and types garbage.');
  }
  // run() adds a third check before the first action: it asks the browser which
  // databases exist rather than trusting a flag.

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // mulberry32: tiny, seedable, good enough to choose buttons.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const C = {
    state: 'idle', seed: 0, step: 0, total: 0, rand: Math.random,
    trace: [], findings: new Map(), clicked: new Map(), obscured: new Map(),
    views: new Map(), nativeDialogs: [], blockedNav: [], consoleErrors: [],
    harnessErrors: [], errorLogStart: 0, camera: { ok: 0, deny: 0, missing: 0, hang: 0, slow: 0 },
    imports: 0, startedAt: 0, online: true,
  };
  window.Chaos = C;

  // ---- keeping it inside the sandbox --------------------------------------
  // Native dialogs would freeze the page, and the app is supposed to have
  // replaced them (dialog.js) because on an installed iOS home-screen app they
  // return instantly with nothing on screen. So using one is a finding.
  for (const name of ['alert', 'confirm', 'prompt']) {
    window[name] = (msg) => { C.nativeDialogs.push({ name, msg: String(msg).slice(0, 120), step: C.step }); return name === 'prompt' ? '' : true; };
  }
  window.open = (url) => { C.blockedNav.push({ via: 'window.open', url: String(url).slice(0, 100), step: C.step }); return null; };
  window.print = () => { C.blockedNav.push({ via: 'print', step: C.step }); };
  // A real <a href="https://..."> or mailto: would navigate this page away and
  // end the run. Hash links are the app's own navigation and are left alone.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') || href === '') return;
    e.preventDefault();
    C.blockedNav.push({ via: 'anchor', url: href.slice(0, 100), step: C.step });
  }, true);
  // The native file picker would block waiting for a person. Imports are done
  // by handing the input a file directly, which is what choosing one does.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type="file"]')) e.preventDefault();
  }, true);
  // If a tap reloads the whole page this object dies with it, so the last few
  // actions are written down as they happen. A page that reloads under a thumb
  // loses whatever was half-typed, which is worth knowing the cause of.
  const noteLast = () => {
    try { sessionStorage.setItem('chaos-last', JSON.stringify({ step: C.step, seed: C.seed, at: Date.now(), trace: C.trace.slice(-6) })); } catch (e) { /* storage blocked */ }
  };
  window.addEventListener('pagehide', noteLast);
  window.addEventListener('beforeunload', noteLast);
  const origError = console.error.bind(console);
  console.error = (...args) => {
    try { C.consoleErrors.push({ step: C.step, msg: args.map((a) => (a && a.message) || String(a)).join(' ').slice(0, 200) }); } catch (e) { /* never */ }
    origError(...args);
  };

  // A camera that behaves like a phone's: usually fine, sometimes slow,
  // sometimes refused, sometimes it never answers at all.
  function fakeStream() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const ctx = c.getContext('2d');
    let t = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = '#2b3a4a'; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#e8b030'; ctx.fillRect((t * 9) % 580, 190, 70, 70);
      ctx.fillStyle = '#fff'; ctx.font = '26px sans-serif'; ctx.fillText('SAMPLE FRAME ' + t++, 18, 40);
    }, 100);
    const stream = c.captureStream(10);
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
    }
    return stream;
  }
  const nav = navigator;
  if (!nav.mediaDevices) { try { Object.defineProperty(nav, 'mediaDevices', { value: {}, configurable: true }); } catch (e) { /* ignore */ } }
  try {
    nav.mediaDevices.getUserMedia = () => new Promise((resolve, reject) => {
      const r = C.rand();
      const err = (name) => Object.assign(new Error(name), { name });
      if (r < 0.50) { C.camera.ok++; setTimeout(() => resolve(fakeStream()), Math.floor(C.rand() * 700)); }
      else if (r < 0.65) { C.camera.deny++; setTimeout(() => reject(err('NotAllowedError')), Math.floor(C.rand() * 300)); }
      else if (r < 0.75) { C.camera.missing++; reject(err('NotFoundError')); }
      else if (r < 0.88) { C.camera.slow++; setTimeout(() => resolve(fakeStream()), 2500 + Math.floor(C.rand() * 2500)); }
      else { C.camera.hang++; /* never settles, like a dismissed permission sheet */ }
    });
  } catch (e) { /* if it cannot be replaced the camera simply is not exercised */ }
  try {
    Object.defineProperty(nav, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  } catch (e) { /* ignore */ }

  // ---- looking at the screen the way a person does -------------------------
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.classList && p.classList.contains('hidden')) return false;
      if (p.hasAttribute && p.hasAttribute('hidden')) return false;
    }
    return true;
  };
  const labelOf = (el) => (el.getAttribute('aria-label') || el.title || el.value || el.textContent || '')
    .trim().replace(/\s+/g, ' ').slice(0, 30);
  const keyOf = (el) => {
    const view = (el.closest('section.view') || {}).id || 'global';
    return view + '|' + (el.id || (el.tagName.toLowerCase() + '.' + String(el.className).split(/\s+/)[0] + ':' + labelOf(el)));
  };
  const describe = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + labelOf(el) + '"');
  const currentViews = () => Array.from(document.querySelectorAll('section.view')).filter((v) => !v.classList.contains('hidden'));
  const currentViewId = () => (currentViews()[0] || {}).id || 'none';

  // Controls that take you somewhere else.
  const NAV_SELECTOR = 'button[id*="back"], button[id*="cancel"], button[id*="close"], #open-more-btn, '
    + '#open-scheduler-btn, #open-leads-btn, #open-clients-btn, #open-swms-btn, #open-assets-btn, '
    + '#open-business-btn, #open-archive-btn';

  // Things the monkey must not touch, each for a reason.
  // Call and Text hand the phone number to the phone's own apps by assigning
  // location.href = 'tel:' / 'sms:', which cannot be intercepted from here and
  // which takes the page with it on anything that is not a phone.
  const FORBIDDEN_ID = new Set(['logout-btn', 'report-export-btn', 'export-data-btn', 'lead-call-btn', 'lead-text-btn']);
  const FORBIDDEN_TEXT = /reset demo|log ?out|sign ?out|export/i;

  const SELECTOR = [
    'button', 'a[href^="#"]', '[role="button"]', 'summary', 'select',
    'input:not([type="file"]):not([type="hidden"]):not([type="range"])', 'textarea',
    'li.report-section-item', '.doc-type-card', 'label.client-link-ask',
    '.job-card', '.job-item', '[data-job-id]', '[data-id]', '.agenda-item', '.scheduler-slot',
  ].join(',');

  // The topmost open dialog or modal, if any. While one is up a person can only
  // touch what is inside it, so that is all the monkey may pick from — picking
  // from behind it would test handlers nobody can reach.
  function topModal() {
    const open = Array.from(document.querySelectorAll('.modal, .app-dialog, [role="dialog"]')).filter(visible);
    return open.length ? open[open.length - 1] : null;
  }

  function candidates() {
    const modal = topModal();
    const out = [];
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (FORBIDDEN_ID.has(el.id)) continue;
      if (FORBIDDEN_TEXT.test(labelOf(el))) continue;
      if (!visible(el)) continue;
      if (modal && !modal.contains(el)) continue;
      out.push(el);
    }
    return out;
  }

  // A finger lands on whatever is on top at that spot, not on the thing that
  // was aimed at. Sends the same events a touch does (the app dismisses dialogs
  // on mousedown outside the card, so a bare click would miss that), to the
  // element actually under the point. Returns what was really hit.
  async function tap(el) {
    const r = el.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y) || el;
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    hit.dispatchEvent(new MouseEvent('mousedown', init));
    hit.dispatchEvent(new MouseEvent('mouseup', init));
    hit.dispatchEvent(new MouseEvent('click', init));
    return hit;
  }

  // Would a finger land on this element, or on something covering it?
  // Remembers WHAT was in the way, because "could not be tapped" is only a
  // finding if somebody can say what was on top of it.
  function reachable(el) {
    C.lastCover = '';
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* detached */ }
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      C.lastCover = 'off-screen at ' + [r.left, r.top, r.width, r.height].map(Math.round).join(',');
      return false;
    }
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    if (!ok) {
      C.lastCover = (hit ? describe(hit) + ' ' + String(hit.className).slice(0, 30) : 'nothing')
        + ' over ' + [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    }
    return ok;
  }

  // Novelty-seeking: a control tried nine times is a tenth as likely as one
  // never tried, so a few hundred steps cover a few hundred different things
  // instead of the same three buttons.
  function pickWeighted(list) {
    const w = list.map((el) => 1 / (1 + 2 * (C.clicked.get(keyOf(el)) || 0)));
    let total = w.reduce((a, b) => a + b, 0);
    let r = C.rand() * total;
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  const choose = (arr) => arr[Math.floor(C.rand() * arr.length)];

  // What a hand might type, and an input that is not what it claims to be.
  const WORDS = [
    '', ' ', 'a', 'Jo', 'O\'Brien & Sons', '"quoted" name', 'Zoë Müller', '\u{1F600}\u{1F41C}', 'x'.repeat(4000),
    '<img src=x onerror="window.__xss=(window.__xss||0)+1">', '"><svg onload=window.__xss=(window.__xss||0)+1>',
    '‮evil', 'line one\nline two\n\n', '%s %d {{7*7}} ${1+1}', '   padded   ', '0412 345 678', '+61 412 345 678',
    '(04) 1234-5678', '12', '-1', '99999999999999999999', '0', '1e309', 'a@b.co', 'not an email@@x', '02 9127 1320',
    '１２３４', 'Mr. Smith, 14 Example Rd, Camden NSW 2570', '\t', 'DROP TABLE jobs;--',
  ];
  const DATES = ['1900-01-01', '2026-10-04', '2026-04-05', '2032-02-29', '2099-12-31', '2026-12-31', '2027-01-01', ''];
  const TIMES = ['00:00', '02:30', '12:00', '23:59', ''];

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function typeInto(el) {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (el.tagName === 'SELECT') {
      const opts = Array.from(el.options);
      if (opts.length) setValue(el, choose(opts).value);
      return 'select';
    }
    if (t === 'checkbox' || t === 'radio') { el.click(); return 'toggle'; }
    if (t === 'date') { const v = choose(DATES); setValue(el, v); return 'date ' + v; }
    if (t === 'time') { const v = choose(TIMES); setValue(el, v); return 'time ' + v; }
    if (t === 'number') { const v = choose(['0', '-1', '1', '99999', '1.5', '']); setValue(el, v); return 'number ' + v; }
    const v = choose(WORDS);
    setValue(el, v);
    return JSON.stringify(v.slice(0, 24));
  }

  // A photo import, and the things a person imports by mistake.
  async function makeFile(kind) {
    if (kind === 'empty') return new File([], 'IMG_0001.jpg', { type: 'image/jpeg' });
    if (kind === 'text') return new File(['this is not a picture'], 'notes.jpg', { type: 'image/jpeg' });
    if (kind === 'pdf') return new File(['%PDF-1.4 fake'], 'quote.pdf', { type: 'application/pdf' });
    if (kind === 'huge') {
      const c = document.createElement('canvas'); c.width = 6000; c.height = 4500;
      const x = c.getContext('2d'); x.fillStyle = '#556'; x.fillRect(0, 0, 6000, 4500);
      return new File([await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.6))], 'IMG_BIG.jpg', { type: 'image/jpeg' });
    }
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#' + Math.floor(C.rand() * 0xffffff).toString(16).padStart(6, '0');
    x.fillRect(0, 0, 320, 240); x.fillStyle = '#fff'; x.fillText('SAMPLE ' + C.imports, 10, 20);
    return new File([await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))], 'IMG_' + (1000 + C.imports) + '.jpg', { type: 'image/jpeg' });
  }
  async function importInto(input) {
    const kind = choose(['good', 'good', 'good', 'good', 'empty', 'text', 'pdf', 'huge']);
    const dt = new DataTransfer();
    dt.items.add(await makeFile(kind));
    if (input.multiple && C.rand() < 0.5) { dt.items.add(await makeFile('good')); dt.items.add(await makeFile('good')); }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    C.imports++;
    return 'import ' + kind;
  }

  // ---- what counts as broken ----------------------------------------------
  function finding(type, detail, extra) {
    const sig = type + '|' + String(detail).slice(0, 140);
    const view = currentViewId();
    let f = C.findings.get(sig);
    if (!f) {
      f = { sig, type, detail: String(detail).slice(0, 300), view, count: 0, firstStep: C.step, trace: C.trace.slice(-8), extra: extra || null };
      C.findings.set(sig, f);
    }
    f.count++;
  }

  const BAD_TEXT = /\[object Object\]|\bNaN\b|Invalid Date|\bundefined\b|\bNaN[:\-\/]/;
  async function checkInvariants(actionDesc) {
    // 1. Anything uncaught since the last look. Uses the app's own error log,
    //    which is also what a technician's phone would have recorded.
    if (window.ErrorLog) {
      const all = window.ErrorLog.list();
      for (const e of all.slice(C.errorLogSeen || 0)) finding('uncaught-' + e.kind, e.message + ' @ ' + e.source + ':' + e.line, { stack: (e.stack || '').split('\n').slice(0, 3).join(' | ') });
      C.errorLogSeen = all.length;
    }
    // 2. Exactly one screen showing.
    const views = currentViews();
    C.views.set(views[0] ? views[0].id : 'none', (C.views.get(views[0] ? views[0].id : 'none') || 0) + 1);
    if (views.length !== 1) finding('view-count', views.length + ' screens visible: ' + views.map((v) => v.id).join(','));
    // 3. Script injection that actually ran.
    if (window.__xss) { finding('XSS', 'typed markup was executed (' + window.__xss + ' times) after: ' + actionDesc); window.__xss = 0; }
    // 4. Visibly broken text on the current screen.
    if (views[0]) {
      const text = views[0].innerText || '';
      const m = text.match(BAD_TEXT);
      if (m) {
        const i = text.indexOf(m[0]);
        finding('bad-text', '"' + m[0] + '" on screen: …' + text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ') + '…');
      }
    }
    // 5. Sideways scrolling, which on a phone means something is too wide.
    if (document.documentElement.scrollWidth > innerWidth + 3) {
      finding('h-scroll', 'page is ' + document.documentElement.scrollWidth + 'px wide in a ' + innerWidth + 'px window');
    }
    // 6. Nothing to tap at all: the person is stuck.
    if (!candidates().length) finding('dead-end', 'no tappable control on ' + currentViewId());
  }

  // The data underneath, checked every so often rather than every step.
  async function integrity() {
    try {
      const [jobs, reports, invoices, captures] = await Promise.all([
        DB.getJobs(), DB.getAllReports(), DB.getAllInvoices(), DB.getAllCaptures(),
      ]);
      const ids = new Set();
      for (const j of jobs) {
        if (ids.has(j.id)) finding('integrity', 'duplicate job id ' + j.id);
        ids.add(j.id);
        if (typeof j.name !== 'string') finding('integrity', 'job with a non-text name: ' + typeof j.name);
        if (j.scheduledAt != null && !Number.isFinite(j.scheduledAt)) finding('integrity', 'job scheduledAt is ' + j.scheduledAt);
        if (j.scheduledDurationMins != null && !(Number.isFinite(j.scheduledDurationMins) && j.scheduledDurationMins > 0)) {
          finding('integrity', 'job duration is ' + j.scheduledDurationMins);
        }
      }
      for (const r of reports) {
        if (!ids.has(r.jobId)) finding('orphan', 'a report belongs to a job that no longer exists');
        if (!r.sections || typeof r.sections !== 'object') finding('integrity', 'report with no sections object');
      }
      for (const i of invoices) if (!ids.has(i.jobId)) finding('orphan', 'an invoice belongs to a job that no longer exists');
      for (const c of captures) if (!ids.has(c.jobId)) finding('orphan', 'a photo belongs to a job that no longer exists');
      C.lastCounts = { jobs: jobs.length, reports: reports.length, invoices: invoices.length, captures: captures.length };
    } catch (e) {
      finding('integrity', 'could not read the database: ' + (e && e.message));
    }
  }

  // ---- one human action ----------------------------------------------------
  async function act() {
    const roll = C.rand();
    const view = currentViewId();
    const record = (kind, target, extra) => {
      C.trace.push({ i: C.step, view, kind, target: target || '', extra: extra || '' });
      if (C.trace.length > 60) C.trace.shift();
      return kind + ' ' + (target || '') + ' ' + (extra || '');
    };

    if (roll < 0.04) {
      C.online = !C.online;
      Object.defineProperty(navigator, 'onLine', { get: () => C.online, configurable: true });
      window.dispatchEvent(new Event(C.online ? 'online' : 'offline'));
      return record('signal', C.online ? 'back' : 'lost');
    }
    if (roll < 0.06) {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(80);
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return record('backgrounded-and-returned');
    }
    if (roll < 0.075) { await sleep(Math.floor(C.rand() * 500)); return record('waited'); }
    if (roll < 0.10) {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((i) => i.closest('section.view:not(.hidden)'));
      if (inputs.length) { const inp = choose(inputs); return record('import', inp.id || 'file input', await importInto(inp)); }
    }

    // With a dialog open, sometimes tap the dim area outside it, which is how
    // people dismiss one.
    const modal = topModal();
    if (modal && C.rand() < 0.12) {
      const h = document.elementFromPoint(4, Math.floor(innerHeight / 2)) || modal;
      const init = { bubbles: true, cancelable: true, clientX: 4, clientY: innerHeight / 2, view: window };
      h.dispatchEvent(new MouseEvent('mousedown', init)); h.dispatchEvent(new MouseEvent('mouseup', init)); h.dispatchEvent(new MouseEvent('click', init));
      return record('tap-outside-dialog', describe(h));
    }

    let list = candidates();
    if (!list.length) return record('nothing-to-tap');
    // People do not stay on one screen for ever. A screen that already holds a
    // large share of the visits pushes towards the controls that leave it —
    // without this the Scheduler, which is mostly buttons, ate 60% of a run.
    const share = (C.views.get(view) || 0) / (C.step + 1);
    if (!modal && C.step > 40 && share > 0.22 && C.rand() < 0.5) {
      const leaving = list.filter((b) => b.matches(NAV_SELECTOR));
      if (leaving.length) list = leaving;
    }
    const el = pickWeighted(list);
    const k = keyOf(el);
    if (!reachable(el)) {
      C.obscured.set(k, (C.obscured.get(k) || 0) + 1);
      C.coveredBy = C.coveredBy || new Map();
      C.coveredBy.set(k, C.lastCover);
      return record('could-not-reach', describe(el));
    }

    const tag = el.tagName;
    const isField = tag === 'TEXTAREA' || tag === 'SELECT'
      || (tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio)$/i.test(el.type));
    if (isField) {
      C.clicked.set(k, (C.clicked.get(k) || 0) + 1);
      return record('type', describe(el), typeInto(el));
    }

    C.clicked.set(k, (C.clicked.get(k) || 0) + 1);
    const style = C.rand();
    // Every repeat tap goes to the SAME SPOT, and lands on whatever is there by
    // then. After the first tap opens a dialog, the second hits the dialog.
    const landed = (h) => (h === el || el.contains(h) || h.contains(el) ? '' : ' (landed on ' + describe(h) + ')');
    if (style < 0.70) { const h = await tap(el); return record('tap', describe(el) + landed(h)); }
    if (style < 0.82) {
      await tap(el); await sleep(Math.floor(C.rand() * 120));
      const h = await tap(el);
      return record('double-tap', describe(el) + landed(h));
    }
    if (style < 0.88) {
      const n = 4 + Math.floor(C.rand() * 3);
      let h = el;
      for (let i = 0; i < n; i++) { h = await tap(el); await sleep(Math.floor(C.rand() * 40)); }
      return record('mash', describe(el) + landed(h), n + 'x');
    }
    // Tap, then change your mind before it has finished: reach for Back, which
    // is only tappable if nothing has opened over it in the meantime.
    await tap(el);
    await sleep(Math.floor(C.rand() * 80));
    const back = candidates().filter((b) => b.matches('button[id*="back"], button[id*="cancel"], button[id*="close"]'));
    if (back.length) {
      const b = choose(back);
      if (reachable(b)) { await tap(b); return record('tap-then-back', describe(el), '-> ' + describe(b)); }
      return record('tap-then-back', describe(el), '-> back was covered');
    }
    return record('tap', describe(el));
  }

  // ---- a tour of the front door -------------------------------------------
  // Every top-level screen once, in a random order, so a run starts having SEEN
  // the whole app rather than hoping the dice find the way to the archive. From
  // there the monkey is on its own.
  async function goHome() {
    for (let i = 0; i < 6 && currentViewId() !== 'view-joblist'; i++) {
      const modal = topModal();
      if (modal) { const h = document.elementFromPoint(4, Math.floor(innerHeight / 2)) || modal;
        h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await sleep(60); }
      const back = Array.from(document.querySelectorAll('button[id*="back"]')).filter(visible).filter(reachable);
      if (back.length) await tap(back[back.length - 1]);
      await sleep(120);
    }
    return currentViewId() === 'view-joblist';
  }
  async function tour() {
    const targets = ['open-scheduler-btn', 'open-leads-btn', 'open-clients-btn', 'open-swms-btn',
      'open-assets-btn', 'open-business-btn', 'open-archive-btn'];
    for (let i = targets.length - 1; i > 0; i--) { const j = Math.floor(C.rand() * (i + 1)); [targets[i], targets[j]] = [targets[j], targets[i]]; }
    for (const id of targets) {
      if (!await goHome()) { C.harnessErrors.push({ step: 0, msg: 'tour could not get home before ' + id }); continue; }
      const more = document.getElementById('open-more-btn');
      let btn = document.getElementById(id);
      if (btn && !visible(btn) && more && visible(more)) { await tap(more); await sleep(120); btn = document.getElementById(id); }
      if (btn && visible(btn) && reachable(btn)) { await tap(btn); await sleep(250); C.clicked.set(keyOf(btn), 1); }
      else C.harnessErrors.push({ step: 0, msg: 'tour could not reach ' + id });
      try { await checkInvariants('tour ' + id); } catch (e) { /* recorded elsewhere */ }
    }
    await goHome();
  }

  // ---- the loop ------------------------------------------------------------
  async function loop(steps, delay, doTour) {
    C.state = 'running';
    if (doTour) { try { await tour(); } catch (e) { C.harnessErrors.push({ step: 0, msg: 'tour: ' + String((e && e.message) || e).slice(0, 120) }); } }
    while (C.state === 'running' && C.step < steps) {
      C.step++;
      let desc = '';
      try { desc = await act(); } catch (e) { C.harnessErrors.push({ step: C.step, msg: String((e && e.message) || e).slice(0, 160) }); }
      noteLast();
      await sleep(delay);
      try { await checkInvariants(desc); } catch (e) { C.harnessErrors.push({ step: C.step, msg: 'invariant: ' + String((e && e.message) || e).slice(0, 160) }); }
      if (C.step % 25 === 0) await integrity();
    }
    await integrity();
    if (C.state === 'running') C.state = 'done';
  }

  C.run = async function run(opts) {
    const o = opts || {};
    // The second of the two guards: confirm the database this page has open is
    // the demo one, by asking the browser rather than trusting a flag.
    try {
      const dbs = indexedDB.databases ? await indexedDB.databases() : [];
      const names = dbs.map((d) => d.name);
      if (names.includes('field-inspect-db') && !names.includes('field-inspect-db-demo')) {
        throw new Error('only the real database exists here');
      }
    } catch (e) { throw new Error('chaos.js will not run: ' + e.message); }

    C.seed = o.seed == null ? 1 : o.seed;
    C.rand = rng(C.seed);
    C.step = 0; C.total = o.steps || 300; C.startedAt = Date.now();
    C.errorLogSeen = window.ErrorLog ? window.ErrorLog.list().length : 0;
    loop(C.total, o.delay == null ? 35 : o.delay, o.tour !== false);
    return 'started seed ' + C.seed;
  };
  C.stop = () => { C.state = 'stopped'; };

  C.report = function report(opts) {
    const o = opts || {};
    const findings = Array.from(C.findings.values()).sort((a, b) => b.count - a.count);
    const allIds = Array.from(document.querySelectorAll('button[id]')).map((b) => b.id);
    const clickedIds = new Set(Array.from(C.clicked.keys()).map((k) => k.split('|')[1]));
    // Visible, picked at least three times, and a finger never once landed on it.
    const neverReached = Array.from(C.obscured.entries())
      .filter(([k, n]) => n >= 3 && !C.clicked.has(k))
      .map(([k, n]) => k + ' x' + n + ' — ' + ((C.coveredBy && C.coveredBy.get(k)) || '?'));
    return {
      state: C.state, seed: C.seed, step: C.step + '/' + C.total, seconds: Math.round((Date.now() - C.startedAt) / 1000),
      counts: C.lastCounts || null,
      screens: Object.fromEntries(C.views),
      distinctControlsTried: C.clicked.size,
      camera: C.camera, imports: C.imports,
      nativeDialogs: C.nativeDialogs.slice(0, 5), blockedNav: C.blockedNav.slice(0, 5),
      harnessErrors: C.harnessErrors.slice(0, 5),
      consoleErrors: o.console ? C.consoleErrors.slice(0, 15) : C.consoleErrors.length,
      neverReachable: neverReached.slice(0, 15),
      unusedButtonIds: o.unused ? allIds.filter((id) => !clickedIds.has(id)) : undefined,
      findings: findings.slice(0, o.limit || 12).map((f) => ({
        type: f.type, detail: f.detail, view: f.view, count: f.count, firstStep: f.firstStep, extra: f.extra,
        lastActions: o.traces ? f.trace.map((t) => t.kind + ' ' + t.target + (t.extra ? ' ' + t.extra : '')) : undefined,
      })),
      findingTotal: findings.length,
    };
  };
})();
