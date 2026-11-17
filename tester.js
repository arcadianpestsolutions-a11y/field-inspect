// Trial businesses: what a tester did, and what they thought of each report.
//
// ONLY FOR A BUSINESS MARKED AS ON TRIAL (organisations.tester, migration
// 045). For everyone else every function here does nothing, so Arcadian's own
// day is never recorded and never interrupted.
//
// WHAT IS RECORDED. Which buttons were pressed (by their id or action name),
// the screen they were on, and a handful of named steps (a job made, an
// inspection started, a report finalised or emailed). Job ids and document
// types, never a client's name, address, phone or email. The tester is told
// this once, the first time the app opens on their login.
//
// WHAT IS ASKED. After each report is finalised: a 1-5 rating, what they
// liked, what could be better. Skippable, never in the way of the report. The
// same form, with everything sent so far, is under More > Trial feedback.
//
// QUEUED ON THE PHONE FIRST, like error-log.js. A tester in a subfloor has no
// signal, and feedback typed there must not be lost: it waits in
// localStorage and goes when the phone is back online.
//
// EXPOSES: window.Tester = { active, event, askAfterReport, openTracker, flush, feedbackSent }
(() => {
  'use strict';

  if (window.Tester) return;

  const LOG_KEY = 'scope-tester-log';
  const FEEDBACK_KEY = 'scope-tester-feedback';
  const WELCOMED_KEY = 'scope-tester-welcomed';
  const MAX_LOG = 600;
  const uid = () => (window.DB && window.DB.uid ? window.DB.uid() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // The suite switches it on by hand; in the real app it follows the business.
  let forced = null;
  function active() {
    if (forced !== null) return forced;
    if (window.IS_TEST || window.IS_DEMO) return false;
    const org = window.Org && window.Org.get ? window.Org.get() : null;
    return !!(org && org.tester);
  }

  function read(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function write(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* full or blocked: the trial log is not worth breaking the app for */ }
  }

  // Which screen is showing: the first visible .view's id.
  function screen() {
    const v = Array.from(document.querySelectorAll('.view')).find((x) => !x.classList.contains('hidden'));
    return v ? String(v.id || '').slice(0, 60) : '';
  }

  // Only short labels and numbers survive: anything that could be a client's
  // details is dropped rather than trusted to the caller.
  function cleanDetail(detail) {
    const out = {};
    for (const [k, v] of Object.entries(detail || {})) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string' && v.length <= 60 && !/@|\d{6,}/.test(v)) out[k] = v;
    }
    return out;
  }

  function event(name, detail) {
    if (!active()) return;
    const d = Object.assign({}, detail || {});
    const jobId = typeof d.jobId === 'string' ? d.jobId.slice(0, 80) : null;
    delete d.jobId;
    const list = read(LOG_KEY);
    list.push({
      id: uid(), at: Date.now(), event: String(name).slice(0, 60), jobId,
      detail: cleanDetail(d), version: window.APP_VERSION || '', screen: screen(), sent: false,
    });
    // Oldest sent entries go first when it fills; unsent ones are kept.
    while (list.length > MAX_LOG) {
      const i = list.findIndex((e) => e.sent);
      list.splice(i >= 0 ? i : 0, 1);
    }
    write(LOG_KEY, list);
    scheduleFlush(4000);
  }

  // ---- sending ----
  let flushing = false;
  let timer = null;
  function scheduleFlush(ms) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, ms);
  }

  const canSend = () => active() && navigator.onLine !== false && window.supabaseClient
    && window.Sync && window.Sync.currentUser && window.Sync.currentUser();

  async function flush() {
    if (flushing || !canSend()) return;
    flushing = true;
    try {
      const log = read(LOG_KEY).filter((e) => !e.sent);
      if (log.length) {
        const rows = log.slice(0, 200).map((e) => ({
          id: e.id, occurred_at: e.at, event: e.event, job_id: e.jobId, detail: e.detail,
          app_version: e.version, screen: e.screen,
        }));
        const { error } = await window.supabaseClient.from('tester_activity').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
        if (!error) {
          const done = new Set(rows.map((r) => r.id));
          write(LOG_KEY, read(LOG_KEY).map((e) => (done.has(e.id) ? Object.assign({}, e, { sent: true }) : e)));
        }
      }
      const fb = read(FEEDBACK_KEY).filter((f) => !f.sent);
      if (fb.length) {
        const rows = fb.map((f) => ({
          id: f.id, created_at: f.at, job_id: f.jobId, document_type: f.documentType, report_title: f.title,
          rating: f.rating, liked: f.liked, better: f.better, app_version: f.version,
        }));
        const { error } = await window.supabaseClient.from('tester_feedback').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
        if (!error) {
          const done = new Set(rows.map((r) => r.id));
          write(FEEDBACK_KEY, read(FEEDBACK_KEY).map((f) => (done.has(f.id) ? Object.assign({}, f, { sent: true }) : f)));
        }
      }
    } catch (e) {
      /* no signal, or the tables are not there yet: it stays queued */
    } finally {
      flushing = false;
    }
  }

  // ---- the feedback form ----
  // Its own DOM, like booking-notice.js, so a stale cached index.html cannot
  // leave it half there.
  function form({ jobId, documentType, title, heading }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'tester-feedback';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const card = document.createElement('div');
      card.className = 'tester-feedback-card';
      overlay.appendChild(card);

      const h = document.createElement('h2');
      h.textContent = heading;
      card.appendChild(h);
      if (title) {
        const sub = document.createElement('p');
        sub.className = 'tester-feedback-sub';
        sub.textContent = title;
        card.appendChild(sub);
      }

      const rateLabel = document.createElement('p');
      rateLabel.className = 'tester-feedback-label';
      rateLabel.textContent = 'How was it overall?';
      card.appendChild(rateLabel);
      const stars = document.createElement('div');
      stars.className = 'tester-feedback-stars';
      let rating = 0;
      const words = ['', 'Poor', 'Not great', 'OK', 'Good', 'Great'];
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.rating = String(i);
        b.textContent = `${i}`;
        b.title = words[i];
        b.setAttribute('aria-label', `${i} out of 5, ${words[i]}`);
        b.addEventListener('click', () => {
          rating = i;
          stars.querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.rating) <= i));
          rateWord.textContent = words[i];
        });
        stars.appendChild(b);
      }
      card.appendChild(stars);
      const rateWord = document.createElement('p');
      rateWord.className = 'tester-feedback-word';
      card.appendChild(rateWord);

      const box = (label, ph) => {
        const l = document.createElement('label');
        l.className = 'tester-feedback-label';
        l.textContent = label;
        const t = document.createElement('textarea');
        t.rows = 3;
        t.maxLength = 4000;
        t.placeholder = ph;
        l.appendChild(t);
        card.appendChild(l);
        return t;
      };
      const liked = box('What did you like?', 'e.g. the walk-through was quick');
      const better = box('What could be better?', 'e.g. I wanted to add a photo to the roof void');

      const note = document.createElement('p');
      note.className = 'tester-feedback-note';
      note.textContent = 'This goes to the Scope team. If you have no signal it is kept on the phone and sent later.';
      card.appendChild(note);

      const row = document.createElement('div');
      row.className = 'row gap';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'btn btn-secondary flex1';
      skip.dataset.choice = 'skip';
      skip.textContent = 'Not now';
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'btn btn-primary flex1';
      send.dataset.choice = 'send';
      send.textContent = 'Send feedback';
      row.append(skip, send);
      card.appendChild(row);

      const err = document.createElement('p');
      err.className = 'tester-feedback-err';
      card.appendChild(err);

      const history = sentSoFar();
      if (history.length) {
        const hh = document.createElement('p');
        hh.className = 'tester-feedback-label';
        hh.textContent = `What you have told us so far (${history.length})`;
        card.appendChild(hh);
        const list = document.createElement('ul');
        list.className = 'tester-feedback-history';
        for (const f of history.slice().reverse().slice(0, 30)) {
          const li = document.createElement('li');
          const when = new Date(f.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
          li.textContent = `${when}${f.title ? ' · ' + f.title : ''}${f.rating ? ' · ' + f.rating + '/5' : ''}`
            + `${f.liked ? ' · Liked: ' + f.liked : ''}${f.better ? ' · Better: ' + f.better : ''}`
            + (f.sent ? '' : ' (waiting for signal)');
          list.appendChild(li);
        }
        card.appendChild(list);
      }

      const close = (saved) => { overlay.remove(); resolve(saved); };
      skip.addEventListener('click', () => { event('feedback_skipped', { jobId, documentType }); close(false); });
      send.addEventListener('click', () => {
        const l = liked.value.trim();
        const b = better.value.trim();
        if (!rating && !l && !b) { err.textContent = 'Pick a number or write something first, or tap Not now.'; return; }
        const list = read(FEEDBACK_KEY);
        list.push({
          id: uid(), at: Date.now(), jobId: jobId || null, documentType: documentType || null,
          title: title ? String(title).slice(0, 120) : null, rating: rating || null,
          liked: l || null, better: b || null, version: window.APP_VERSION || '', sent: false,
        });
        write(FEEDBACK_KEY, list);
        event('feedback_sent', { jobId, documentType, rating: rating || 0 });
        flush();
        if (window.Common) window.Common.toast('Thanks, your feedback is saved.');
        close(true);
      });
      document.body.appendChild(overlay);
    });
  }

  // After a report is finalised. Never throws and never blocks the report:
  // the caller does not wait on it.
  // Waits its turn: finalising can be followed by other questions (emailing
  // the client, the booking notice), and this must not sit on top of them.
  const somethingElseAsking = () => !!document.querySelector('body > .app-dialog, .booking-notice, .tester-feedback');
  async function askAfterReport({ jobId, documentType, title } = {}) {
    if (!active()) return false;
    for (let i = 0; i < 240 && somethingElseAsking(); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (somethingElseAsking()) return false;
    await new Promise((r) => setTimeout(r, forced !== null ? 0 : 1200));
    if (somethingElseAsking()) return false;
    return form({ jobId, documentType, title, heading: 'How was this report?' });
  }

  function openTracker() {
    if (!active()) return Promise.resolve(false);
    event('feedback_opened');
    return form({ heading: 'Trial feedback' });
  }

  const sentSoFar = () => read(FEEDBACK_KEY);

  // ---- the trail of taps ----
  // One listener for the whole app, so every screen is covered without
  // touching each one. The label is the button's id or data-action, never
  // its text (which can hold a client's name).
  function onTap(e) {
    if (!active()) return;
    const t = e.target && e.target.closest ? e.target.closest('button, a, [data-action], [role="button"]') : null;
    if (!t || t.closest('.tester-feedback')) return;
    const label = t.id || (t.dataset && (t.dataset.action || t.dataset.choice || t.dataset.status || t.dataset.tab)) || '';
    if (!label) return;
    event('tap', { what: String(label).slice(0, 60) });
  }

  // ---- More > Trial feedback, and a word on the first day ----
  function addMoreItem() {
    if (!active() || document.getElementById('open-tester-feedback-btn')) return;
    const panel = document.querySelector('#more-sheet .more-sheet-panel');
    if (!panel) return;
    const b = document.createElement('button');
    b.id = 'open-tester-feedback-btn';
    b.className = 'more-item';
    b.innerHTML = '<span>💬</span> Trial feedback';
    b.addEventListener('click', () => {
      const sheet = document.getElementById('more-sheet');
      if (sheet) sheet.classList.add('hidden');
      openTracker();
    });
    panel.insertBefore(b, panel.querySelector('#more-close-btn'));
  }

  let welcomed = false;
  async function welcomeOnce() {
    if (welcomed || !active()) return;
    welcomed = true;
    try { if (localStorage.getItem(WELCOMED_KEY)) return; localStorage.setItem(WELCOMED_KEY, String(Date.now())); } catch (e) { return; }
    const msg = 'Thanks for trialling Scope. While you do, Scope keeps a record of which buttons and steps you use, '
      + 'never your clients’ names, addresses, phone numbers or emails, so we can see what works and what gets in the way. '
      + 'After each report it will ask what you thought. You can also send feedback any time under More > Trial feedback.';
    if (window.Dialog && window.Dialog.alert) await window.Dialog.alert(msg, { title: 'Welcome to the Scope trial' });
  }

  // Called when the org profile may have changed (sign-in, refresh).
  function check() {
    if (!active()) return;
    addMoreItem();
    welcomeOnce();
    scheduleFlush(2000);
  }

  window.Tester = {
    active, event, askAfterReport, openTracker, flush, feedbackSent: sentSoFar, check,
    // For the suite only.
    _force(on) { forced = on === null ? null : !!on; },
    _keys: { LOG_KEY, FEEDBACK_KEY, WELCOMED_KEY },
  };

  document.addEventListener('click', onTap, true);
  window.addEventListener('online', () => scheduleFlush(1500));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  if (!window.IS_TEST) {
    const start = () => { setTimeout(() => { if (active()) { event('app_open'); check(); } }, 3000); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
