// ---------------------------------------------------------------------------
// undo-delete.js - "Deleted. Undo" for jobs, photos, enquiries, clients and safety statements.
//
// PURPOSE   Deleting a job removes its photos, invoices and report from the phone
//           AND from the cloud, and there is no in-app restore. A confirm dialog
//           stops accidents of intent, not of the thumb. So a delete is held back
//           for a few seconds: the thing disappears at once, a bar offers Undo, and
//           only when the time runs out is anything actually deleted.
// EXPOSES   window.UndoDelete = { start, undo, flush, hides, pending, delayMs }
// DEPENDS   nothing at load. db.js asks hides() before returning jobs, a job, or a
//           job's photos, so every screen agrees the item is gone.
// TESTS     tests/run-tests.js - "Undo" group.
//
// WHY HELD BACK RATHER THAN DELETED AND RESTORED. A real delete also tells the
// cloud, removes the files from storage and writes tombstones for other devices.
// None of that can be taken back, so restoring from a snapshot would leave other
// devices and the bucket out of step. Holding the delete is the only undo that is
// actually true. The failure mode is the safe one: if the app is closed or the
// phone dies inside the window, nothing was deleted and the item is still there.
//
// One pending delete at a time. Starting another commits the first straight away
// (the person has moved on), so there is never a queue of half-deleted things.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const hidden = { job: new Set(), capture: new Set(), lead: new Set(), client: new Set(), swms: new Set() };
  let current = null; // { kind, ids, commit, refresh, timer }
  let bar = null;
  let barWanted = false;
  // Where the bar may show, by kind: the list you land on after deleting. Elsewhere
  // it would sit on top of a screen's own bottom buttons (Finalize, Save) for ten
  // seconds, so it waits out of sight and comes back if you return to one of these.
  const BAR_VIEWS = {
    job: ['view-job', 'view-joblist'],
    capture: ['view-job', 'view-joblist'],
    lead: ['view-leads'],
    client: ['view-clients'],
    swms: ['view-swms-list'],
  };
  const onBarView = () => {
    const shown = Array.from(document.querySelectorAll('.view')).filter((v) => !v.classList.contains('hidden'));
    const allowed = BAR_VIEWS[(current && current.kind) || 'job'] || [];
    return shown.length === 1 && allowed.includes(shown[0].id);
  };
  function applyBar() {
    const visible = barWanted && onBarView();
    if (bar) bar.classList.toggle('hidden', !visible);
    if (document.body) document.body.classList.toggle('undo-open', visible); // lets toasts clear it
  }
  let watching = false;
  function watchViews() {
    if (watching) return;
    watching = true;
    const obs = new MutationObserver(applyBar);
    document.querySelectorAll('.view').forEach((v) => obs.observe(v, { attributes: true, attributeFilter: ['class'] }));
  }

  // Real use gets ten seconds: long enough for gloves. The test build commits at
  // once so the existing delete tests, which look for the end result, still pass;
  // the undo tests set their own delay. Decided when asked, not when this file
  // loads: IS_TEST is set by db.js, which loads after this.
  const state = { delayMs: null };
  const currentDelay = () => (state.delayMs === null ? (window.IS_TEST ? 0 : 10000) : state.delayMs);

  function hides(kind, id) {
    const set = hidden[kind];
    return !!set && set.has(id);
  }

  function pending() {
    return current ? { kind: current.kind, ids: current.ids.slice() } : null;
  }

  function showBar(message, onUndo) {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'undo-bar';
      bar.className = 'undo-bar hidden';
      bar.setAttribute('role', 'status');
      bar.setAttribute('aria-live', 'polite');
      const text = document.createElement('span');
      text.id = 'undo-text';
      text.className = 'undo-text';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'undo-btn';
      btn.className = 'undo-btn';
      btn.textContent = 'Undo';
      bar.appendChild(text);
      bar.appendChild(btn);
      document.body.appendChild(bar);
    }
    bar.querySelector('#undo-text').textContent = message;
    const btn = bar.querySelector('#undo-btn');
    btn.onclick = onUndo;
    barWanted = true;
    watchViews();
    applyBar();
  }

  function hideBar() {
    barWanted = false;
    if (bar) bar.classList.add('hidden');
    if (document.body) document.body.classList.remove('undo-open');
  }

  function release(entry) {
    entry.ids.forEach((id) => hidden[entry.kind].delete(id));
  }

  // Really delete it. On failure the item comes back rather than staying
  // invisible and undeleted, and the person is told.
  async function commitEntry(entry) {
    clearTimeout(entry.timer);
    if (current === entry) { current = null; hideBar(); }
    try {
      await entry.commit();
    } catch (err) {
      if (window.ErrorLog) window.ErrorLog.note(err, 'undo-delete: delete');
      if (window.appToast) window.appToast('Could not delete that. It is still here.');
    } finally {
      release(entry);
      if (entry.refresh) { try { await entry.refresh(); } catch (e) { /* the next redraw will catch up */ } }
    }
  }

  // Hides the item(s) now and deletes them after the delay unless undone.
  //   kind: 'job' | 'capture' | 'lead' | 'client' | 'swms'      ids: the ids to hide
  //   message: what the bar says   commit: async () => the real delete
  //   refresh: async () => redraw whatever is on screen
  async function start({ kind, ids, message, commit, refresh }) {
    if (!hidden[kind] || !ids || !ids.length) throw new Error('UndoDelete.start needs a kind and ids');
    if (current) await commitEntry(current); // the previous one is final now
    ids.forEach((id) => hidden[kind].add(id));
    const entry = { kind, ids: ids.slice(), commit, refresh, timer: null };
    current = entry;
    const delay = currentDelay();
    if (delay > 0) {
      showBar(message, () => undo());
    }
    entry.timer = setTimeout(() => commitEntry(entry), delay);
    if (refresh) { try { await refresh(); } catch (e) { /* ignore */ } }
  }

  // Bring it back. Returns true if there was something to restore.
  async function undo() {
    const entry = current;
    if (!entry) return false;
    clearTimeout(entry.timer);
    current = null;
    hideBar();
    release(entry);
    if (entry.refresh) { try { await entry.refresh(); } catch (e) { /* ignore */ } }
    if (window.appToast) window.appToast('Restored');
    return true;
  }

  // Commit now (used before something that must see the real state, and by tests).
  async function flush() {
    if (current) await commitEntry(current);
  }

  window.UndoDelete = {
    start, undo, flush, hides, pending,
    get delayMs() { return currentDelay(); },
    set delayMs(v) { state.delayMs = v === null ? null : Math.max(0, Number(v) || 0); },
  };
})();
