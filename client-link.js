// Making, showing and revoking the link a client uses to read their report,
// and collecting their acceptance of a quote through it.
//
// The link is scoped to ONE job and expires. That is not a limitation to work
// around later — it is the design, and migration 027 says why at length: a
// link that leaks should leak one report the client already had, not a
// history, and not an account.
//
// This file never reads a client's data. It writes a token row and builds a
// URL. Everything the client eventually sees is decided server-side by the
// client-portal function, which is the only thing that can read anything.
//
// It does, however, own the one path that puts a remotely-collected signature
// onto a finalised document — see applyAcceptance() below and migration 030.
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
  // Added later than the rest of this panel, so every one of them is checked
  // before it is touched. A device running a half-updated build — an old
  // index.html against this script — must degrade to the link it always had
  // rather than throw on a null and leave the panel stuck on "Loading…".
  const askRow = el('client-link-ask-row');
  const askBox = el('client-link-ask');
  const acceptedBox = el('client-link-accepted');
  const acceptedText = el('client-link-accepted-text');
  const applyBtn = el('client-link-apply');

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));
  const show = (node, on) => { if (node) node.classList.toggle('hidden', !on); };

  // Ninety days. Long enough that a client who files the email and comes back
  // in a month still gets in; short enough that a forwarded link is not a
  // standing key to somebody's house report years later.
  const LIFETIME_DAYS = 90;

  let jobId = null;
  let liveRow = null;
  let liveAcceptance = null;

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
    if (/client_acceptances|acceptance_requested_at/i.test(raw)) {
      return 'Client acceptance is not set up on the server yet — run supabase-migration-030-client-acceptance.sql, then try again.';
    }
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
      .select('token, expires_at, revoked_at, last_seen_at, view_count, acceptance_requested_at')
      .eq('job_id', jobId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = (data || [])[0];
    if (!row) return null;
    return row.expires_at > Date.now() ? row : null;
  }

  // The signature comes back with it, because applying it to the report is
  // one tap away and there is no second round trip worth making. This is the
  // signed-in business reading its own row, not the public endpoint, which
  // never hands a signature image back out.
  async function currentAcceptance() {
    const c = client();
    if (!c) return null;
    const { data, error } = await c.from('client_acceptances')
      .select('id, accepted_name, accepted_at, signature, applied_to_report_at')
      .eq('job_id', jobId)
      .is('superseded_at', null)
      .limit(1);
    // A missing table must not take the link panel down with it — the link
    // works fine on a database where 030 has not been run.
    if (error) {
      if (/client_acceptances/i.test(String(error.message || ''))) return null;
      throw error;
    }
    return (data || [])[0] || null;
  }

  function renderAcceptance(row, acceptance) {
    if (acceptance) {
      show(askRow, false);
      show(acceptedBox, true);
      if (acceptedText) {
        acceptedText.textContent = `${acceptance.accepted_name} accepted this on `
          + `${fmtDate(acceptance.accepted_at)}.`
          + (acceptance.applied_to_report_at
            ? ' The signature is on the report.'
            : ' The signature is not on the report yet.');
      }
      show(applyBtn, !acceptance.applied_to_report_at);
      return;
    }

    show(acceptedBox, false);
    // Shown even before a link exists, because ticking the box and THEN
    // pressing Create is the obvious order to do this in — see create().
    show(askRow, true);
    if (askBox) askBox.checked = !!(row && row.acceptance_requested_at);
  }

  function render(row, acceptance) {
    liveRow = row || null;
    liveAcceptance = acceptance || null;
    const live = !!row;
    show(urlEl, live);
    show(copyBtn, live);
    show(revokeBtn, live);
    show(createBtn, !live);
    renderAcceptance(row, acceptance);

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
    show(urlEl, false);
    show(copyBtn, false);
    show(createBtn, false);
    show(revokeBtn, false);
    show(askRow, false);
    show(acceptedBox, false);
    try {
      const row = await currentLink();
      render(row, row ? await currentAcceptance() : null);
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'client link: open');
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
        // Whatever the box said before the link existed. Ticking it first and
        // then creating the link is the obvious order to do this in, so it had
        // better be the order that works.
        acceptance_requested_at: askBox && askBox.checked ? now : null,
        created_by: user ? user.id : null,
        created_at: now,
        updated_at: now,
      };
      // org_id is left to the column's server-side default, same as every
      // other table since migration 023 — the app cannot choose which
      // business a row belongs to, which is the whole point.
      const { error } = await c.from('client_access').insert(row);
      if (error) throw error;
      render({ ...row, view_count: 0, last_seen_at: null }, null);
      toast('Client link created');
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'client link: create');
      hintEl.textContent = errorText(e);
    } finally {
      createBtn.disabled = false;
    }
  }

  async function setAsking(on) {
    if (!liveRow) return;
    const was = liveRow.acceptance_requested_at;
    const next = on ? Date.now() : null;
    try {
      const { error } = await client().from('client_access')
        .update({ acceptance_requested_at: next, updated_at: Date.now() })
        .eq('token', liveRow.token);
      if (error) throw error;
      liveRow.acceptance_requested_at = next;
      toast(on ? 'The client will be asked to accept' : 'The client will only see their report');
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'client link: ask for acceptance');
      // Put the box back where it was. A tick that silently did not save is
      // worse than one that visibly refused.
      liveRow.acceptance_requested_at = was;
      if (askBox) askBox.checked = !!was;
      hintEl.textContent = errorText(e);
    }
  }

  // The signature goes onto the document HERE, from the app, as a signed-in
  // user who gets named in the report's audit trail — never from the public
  // endpoint that collected it. Migration 030 and ReportUI
  // .applyClientAcceptance both carry the long version of why.
  async function applyAcceptance() {
    if (!liveAcceptance || !window.ReportUI || !window.ReportUI.applyClientAcceptance) {
      toast('Open the report first.');
      return;
    }
    applyBtn.disabled = true;
    try {
      const result = await window.ReportUI.applyClientAcceptance(jobId, {
        name: liveAcceptance.accepted_name,
        signature: liveAcceptance.signature,
        at: liveAcceptance.accepted_at,
      });
      if (!result || !result.ok) {
        toast(result && result.reason === 'already-signed'
          ? 'The report is already signed — the signature on it was taken in person.'
          : 'Could not put the signature on the report.');
        return;
      }
      const now = Date.now();
      const { error } = await client().from('client_acceptances')
        .update({ applied_to_report_at: now, updated_at: now })
        .eq('id', liveAcceptance.id);
      if (error) throw error;
      liveAcceptance.applied_to_report_at = now;
      renderAcceptance(liveRow, liveAcceptance);
      toast('Signature added to the report');
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'client link: apply signature');
      // The report was changed either way — this only failed to record that it
      // was, so say so rather than implying nothing happened.
      hintEl.textContent = 'The signature is on the report, but we could not record that here. Try again when you have signal.';
    } finally {
      applyBtn.disabled = false;
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
      render(null, null);
      toast('Link revoked');
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'client link: revoke');
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
  if (askBox) askBox.addEventListener('change', () => setAsking(askBox.checked));
  if (applyBtn) applyBtn.addEventListener('click', applyAcceptance);
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  openBtn.addEventListener('click', async () => {
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    const job = window.currentJobForSwms ? await window.currentJobForSwms() : null;
    if (!job) { toast('Open a job first.'); return; }
    await open(job.id);
  });

  window.ClientLink = { open, portalUrlFor, LIFETIME_DAYS, errorText };
})();
