// Making, showing and revoking the link a client uses to read their report.
//
// The link is scoped to ONE job and expires. That is not a limitation to work
// around later — it is the design, and migration 027 says why at length: a
// link that leaks should leak one report the client already had, not a
// history, and not an account.
//
// This file never reads a client's data. It writes a token row and builds a
// URL. Everything the client eventually sees is decided server-side by the
// client-portal function, which is the only thing that can read anything.
(() => {
  'use strict';

  const panel = document.getElementById('client-link-panel');
  const openBtn = document.getElementById('client-link-btn');
  if (!panel || !openBtn) return;

  const el = (id) => document.getElementById(id);
  const hintEl = el('client-link-hint');
  const urlEl = el('client-link-url');
  const copyBtn = el('client-link-copy');
  const createBtn = el('client-link-create');
  const revokeBtn = el('client-link-revoke');
  const closeBtn = el('client-link-close');

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));

  // Ninety days. Long enough that a client who files the email and comes back
  // in a month still gets in; short enough that a forwarded link is not a
  // standing key to somebody's house report years later.
  const LIFETIME_DAYS = 90;

  let jobId = null;

  const client = () => window.supabaseClient || null;

  function portalUrlFor(token) {
    // Built from where this app is served rather than hardcoded, so it is
    // right on the live site, in a test build and on localhost without
    // anybody maintaining a second copy of the address.
    const base = location.href.replace(/[^/]*(\?.*)?$/, '');
    return `${base}portal.html?t=${token}`;
  }

  function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Same reasoning as calendar-feed.js: a missing table reads as the app
  // being broken when it is one SQL file that has not been run.
  function errorText(err) {
    const raw = String((err && err.message) || err || '');
    if (/relation .* does not exist|could not find the table|schema cache/i.test(raw)) {
      return 'Client links are not set up on the server yet — run supabase-migration-027-client-portal.sql, then try again.';
    }
    if (/not authenticated|jwt|permission denied|42501/i.test(raw)) return 'Sign in again, then try creating the link.';
    if (/failed to fetch|networkerror|load failed/i.test(raw) || navigator.onLine === false) {
      return 'No connection — try again once you have signal.';
    }
    return 'Could not create the client link — try again.';
  }

  async function currentLink() {
    const c = client();
    if (!c) return null;
    const { data, error } = await c.from('client_access')
      .select('token, expires_at, revoked_at, last_seen_at, view_count')
      .eq('job_id', jobId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = (data || [])[0];
    if (!row) return null;
    return row.expires_at > Date.now() ? row : null;
  }

  function render(row) {
    const live = !!row;
    urlEl.classList.toggle('hidden', !live);
    copyBtn.classList.toggle('hidden', !live);
    revokeBtn.classList.toggle('hidden', !live);
    createBtn.classList.toggle('hidden', live);

    if (!live) {
      hintEl.textContent = `Creates a page where this client can read their own report and see their invoice. `
        + `It works for ${LIFETIME_DAYS} days and can be revoked at any time. It shows them this job and nothing else.`;
      return;
    }
    urlEl.value = portalUrlFor(row.token);
    // What the link has actually done. "Opened 3 times, last on 4 April" is
    // how somebody notices a link being read months later by somebody they
    // did not send it to.
    const seen = row.view_count
      ? `Opened ${row.view_count} ${row.view_count === 1 ? 'time' : 'times'}, last on ${fmtDate(row.last_seen_at)}.`
      : 'Not opened yet.';
    hintEl.textContent = `Works until ${fmtDate(row.expires_at)}. ${seen} `
      + 'Anyone with this link can read this report, so send it to the client and nobody else.';
  }

  async function open(id) {
    jobId = id;
    panel.classList.remove('hidden');
    hintEl.textContent = 'Loading…';
    urlEl.classList.add('hidden');
    copyBtn.classList.add('hidden');
    createBtn.classList.add('hidden');
    revokeBtn.classList.add('hidden');
    try {
      render(await currentLink());
    } catch (e) {
      hintEl.textContent = errorText(e);
    }
  }

  async function create() {
    const c = client();
    if (!c) { toast('Sign in to create a client link.'); return; }
    createBtn.disabled = true;
    try {
      const now = Date.now();
      const user = window.Sync && window.Sync.currentUser ? window.Sync.currentUser() : null;
      const row = {
        token: randomToken(),
        job_id: jobId,
        expires_at: now + LIFETIME_DAYS * 86400000,
        created_by: user ? user.id : null,
        created_at: now,
        updated_at: now,
      };
      // org_id is left to the column's server-side default, same as every
      // other table since migration 023 — the app cannot choose which
      // business a row belongs to, which is the whole point.
      const { error } = await c.from('client_access').insert(row);
      if (error) throw error;
      render({ ...row, view_count: 0, last_seen_at: null });
      toast('Client link created');
    } catch (e) {
      hintEl.textContent = errorText(e);
    } finally {
      createBtn.disabled = false;
    }
  }

  async function revoke() {
    if (!await askConfirm(
      'The client will not be able to open their report with this link any more. You can create a new one at any time.',
      { title: 'Revoke this link?', okLabel: 'Revoke', danger: true })) return;
    revokeBtn.disabled = true;
    try {
      const { error } = await client().from('client_access')
        .update({ revoked_at: Date.now(), updated_at: Date.now() })
        .eq('job_id', jobId)
        .is('revoked_at', null);
      if (error) throw error;
      render(null);
      toast('Link revoked');
    } catch (e) {
      hintEl.textContent = errorText(e);
    } finally {
      revokeBtn.disabled = false;
    }
  }

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlEl.value);
      toast('Link copied');
    } catch (e) {
      // Clipboard access is refused in some in-app browsers. The value is in
      // a plain text input, so selecting it never actually blocks a copy.
      urlEl.select();
      toast('Copy blocked here — the link is selected, use your keyboard');
    }
  });
  createBtn.addEventListener('click', create);
  revokeBtn.addEventListener('click', revoke);
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  openBtn.addEventListener('click', async () => {
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    const job = window.currentJobForSwms ? await window.currentJobForSwms() : null;
    if (!job) { toast('Open a job first.'); return; }
    await open(job.id);
  });

  window.ClientLink = { open, portalUrlFor, LIFETIME_DAYS, errorText };
})();
