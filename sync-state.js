// ---------------------------------------------------------------------------
// sync-state.js - what the app tells you about "is my work safe?", and the
// waiting states around it.
//
// PURPOSE   In the field the one question is whether the photos are backed up.
//           The old bar said "Signed in as ... Synced 3:15 PM" and nothing about
//           how many photos had not left the phone. This works out one honest
//           state (backed up / uploading / waiting / offline / problem), draws it
//           as a coloured dot and a sentence, counts photos still on the phone
//           only, gives "Sync now" a visible working state, shows placeholder
//           cards instead of "No jobs yet" while the first sync is still
//           fetching, and lets you pull the list down to sync.
// EXPOSES   window.SyncState = { describe, agoLabel, countPending, pending,
//           update, input, isFirstSync, skeletonCards, installPullToRefresh,
//           setTestInput }
// DEPENDS   DB.getAllCaptures; optionally window.Sync (status, pullAll).
// TESTS     tests/run-tests.js - "Sync state" group.
//
// Wording rule shared with the rest of the app: say what is true, say the work is
// safe on the phone when it is, and never say "synced" or "backed up" while
// something is still waiting.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

  // "just now", "4 min ago", "3:15 pm", "yesterday 3:15 pm", "8 Oct". Pure.
  function agoLabel(ts, now) {
    if (!ts) return '';
    const mins = Math.round((now - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const d = new Date(ts);
    const n = new Date(now);
    const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(' am', ' am').replace(' pm', ' pm');
    const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    if (sameDay) return time;
    const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
    if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return `yesterday ${time}`;
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  // The one state to show. Input: { online, status: {state, lastSyncedAt, error}, pending, now }.
  // Output: { level, text, detail }. level is one of
  //   'ok' (backed up) | 'working' (syncing now) | 'waiting' (work still only on the phone)
  //   | 'offline' | 'problem' | 'idle' (not synced yet).
  function describe(input) {
    const i = input || {};
    const status = i.status || { state: 'idle' };
    const pending = Math.max(0, i.pending || 0);
    const now = i.now || Date.now();
    const photos = pending ? plural(pending, 'photo') : '';

    if (i.online === false) {
      return {
        level: 'offline',
        text: pending
          ? `Offline. ${photos} saved on this phone and will upload when you are back online`
          : 'Offline. Everything is saved on this phone',
        detail: '',
      };
    }
    if (status.state === 'syncing') {
      return { level: 'working', text: pending ? `Syncing. ${photos} to upload` : 'Syncing', detail: '' };
    }
    if (status.state === 'error') {
      return {
        level: 'problem',
        text: 'Could not sync. Your work is safe on this phone and it will try again',
        detail: status.error || '',
      };
    }
    if (status.state === 'partial') {
      return {
        level: 'problem',
        text: 'Some items are not backed up yet. They are safe on this phone',
        detail: status.error || '',
      };
    }
    if (status.state === 'synced' && status.lastSyncedAt) {
      const when = agoLabel(status.lastSyncedAt, now);
      if (pending) return { level: 'waiting', text: `Synced ${when}. ${photos} still to upload`, detail: '' };
      return { level: 'ok', text: `All backed up, ${when}`, detail: '' };
    }
    return { level: 'idle', text: pending ? `Not synced yet. ${photos} on this phone only` : 'Not synced yet', detail: '' };
  }

  // ---------- What is only on this phone ----------
  // A capture whose bytes are held locally but has no storage path has not been
  // uploaded. Voice notes count the same way.
  let pendingCount = 0;
  async function countPending() {
    try {
      const all = await window.DB.getAllCaptures();
      return all.filter((c) => (c.photoBlob && !c.photoPath) || (c.audioBlob && !c.audioPath)).length;
    } catch (e) {
      return 0;
    }
  }
  const pending = () => pendingCount;

  // ---------- Live input ----------
  let testInput = null;
  function setTestInput(v) { testInput = v; return update(); }

  function input() {
    if (testInput) return Object.assign({ now: Date.now() }, testInput);
    return {
      online: navigator.onLine !== false,
      status: window.Sync && window.Sync.getStatus ? window.Sync.getStatus() : { state: 'idle' },
      pending: pendingCount,
      now: Date.now(),
    };
  }

  const isFirstSync = () => {
    const i = input();
    return i.online !== false && !!i.status && i.status.state === 'syncing' && !i.status.lastSyncedAt;
  };

  // ---------- Drawing it ----------
  let lastLevel = null;
  function update() {
    const view = describe(input());
    const text = document.getElementById('sync-status-text');
    const bar = document.getElementById('sync-bar');
    if (bar) {
      let dot = document.getElementById('sync-dot');
      if (!dot && text) {
        dot = document.createElement('span');
        dot.id = 'sync-dot';
        dot.className = 'sync-dot';
        dot.setAttribute('aria-hidden', 'true');
        text.parentNode.insertBefore(dot, text);
      }
      if (dot) dot.className = `sync-dot sync-dot-${view.level}`;
      bar.setAttribute('data-sync-level', view.level);
    }
    if (text) {
      text.textContent = view.text;
      text.setAttribute('role', 'status');
    }
    const detail = document.getElementById('sync-detail');
    if (detail) {
      detail.textContent = view.detail;
      detail.classList.toggle('hidden', !view.detail);
    }
    // "Sync now" shows that it is working, and cannot be pressed twice.
    const btn = document.getElementById('sync-now-btn');
    if (btn) {
      const working = view.level === 'working';
      btn.disabled = working;
      btn.classList.toggle('is-working', working);
      btn.textContent = working ? 'Syncing…' : 'Sync now';
    }
    // Screens that depend on "is the first sync still running?" redraw when the state
    // actually changes, not on every refresh.
    if (view.level !== lastLevel) {
      lastLevel = view.level;
      document.dispatchEvent(new Event('scope-sync-state'));
    }
    return view;
  }

  async function refreshPending() {
    pendingCount = await countPending();
    update();
  }

  // ---------- Placeholder cards ----------
  // While the very first sync is still fetching and nothing is on the phone yet,
  // "No jobs yet. Tap + New Job" is wrong: the jobs are on their way.
  function skeletonCards(count) {
    const frag = document.createDocumentFragment();
    for (let n = 0; n < (count || 3); n++) {
      const card = document.createElement('div');
      card.className = 'skeleton-card';
      card.setAttribute('aria-hidden', 'true');
      ['w60', 'w90', 'w40'].forEach((w) => {
        const line = document.createElement('span');
        line.className = `skeleton-line ${w}`;
        card.appendChild(line);
      });
      frag.appendChild(card);
    }
    return frag;
  }

  // ---------- Pull the home list down to sync ----------
  const PULL_TRIGGER = 80;
  function installPullToRefresh() {
    const content = document.querySelector('#view-joblist .content');
    if (!content || content.__ptr) return;
    content.__ptr = true;
    const hint = document.createElement('div');
    hint.id = 'ptr-hint';
    hint.className = 'ptr-hint';
    hint.setAttribute('aria-hidden', 'true');
    content.insertBefore(hint, content.firstChild);
    let startY = null;
    let pull = 0;
    const canSync = () => !!(window.Sync && window.Sync.pullAll && window.Sync.currentUserId && window.Sync.currentUserId() && navigator.onLine !== false);

    content.addEventListener('touchstart', (e) => {
      startY = (content.scrollTop <= 0 && e.touches.length === 1) ? e.touches[0].clientY : null;
      pull = 0;
    }, { passive: true });
    content.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || content.scrollTop > 0) { pull = 0; hint.style.height = '0px'; hint.textContent = ''; return; }
      pull = dy;
      if (!canSync()) return; // nothing to sync (demo, offline, signed out): do not tease it
      hint.style.height = `${Math.min(56, dy / 2)}px`;
      hint.textContent = dy >= PULL_TRIGGER ? 'Release to sync' : 'Pull to sync';
    }, { passive: true });
    const end = () => {
      const go = startY !== null && pull >= PULL_TRIGGER && canSync();
      startY = null;
      pull = 0;
      hint.style.height = '0px';
      hint.textContent = '';
      if (go) {
        const btn = document.getElementById('sync-now-btn');
        if (btn && !btn.disabled) btn.click();
      }
    };
    content.addEventListener('touchend', end, { passive: true });
    content.addEventListener('touchcancel', end, { passive: true });
  }

  function start() {
    installPullToRefresh();
    update();
    refreshPending();
    if (window.Sync && window.Sync.onStatusChange) window.Sync.onStatusChange(() => { refreshPending(); });
    window.addEventListener('online', refreshPending);
    window.addEventListener('offline', refreshPending);
    window.addEventListener('scope-captures-changed', refreshPending);
    // The words use relative times ("4 min ago"), so keep them fresh while open.
    setInterval(() => { if (!document.hidden) update(); }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.SyncState = {
    describe, agoLabel, countPending, pending, update, input, isFirstSync,
    skeletonCards, installPullToRefresh, setTestInput, refreshPending,
  };
})();
