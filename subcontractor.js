// ---------------------------------------------------------------------------
// subcontractor.js - what the app is for someone working under a host business.
//
// PURPOSE   A subcontractor signs up through a host's link (join.html), is
//           approved by the host, and then sees only the jobs the host gives
//           them. Their reports carry the host's name and logo, with their own
//           name and licence as the inspector, and go to the host to review
//           and send. This file is the subcontractor's side: the screen shown
//           while they wait, their own details, the licence and insurance
//           dates, and the words that say where a report is up to.
// EXPOSES   window.Subcontractor = { isSub, isActive, state, hostName, apply,
//           openMyDetails, blockReason, paperwork, expiryState, paperworkState,
//           reviewState, reviewLine, gateText }
// DEPENDS   Sync (role, subcontractor, refreshRole, pullAll, signOut), Common
//           (toast), Org (refresh). Works with none of them present: test and
//           demo mode have no Sync, and then nobody is a subcontractor.
// TOUCHES   Nothing stored on the phone. Their details are saved through
//           sub_update_my_profile (migration 048).
// TESTS     tests/run-tests.js - "Subcontractors" group.
//
// THE LOCK IS NOT HERE. What a subcontractor can read and change is decided by
// the database (migration 048). Everything this file hides is a courtesy, so
// the app does not offer a button that would fail.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const S = () => window.Sync || null;

  // The demo, opened with &as=sub, shows the app as a subcontractor of the
  // made-up business sees it. Nothing is signed in and nothing is saved; it is
  // there so the screens can be looked at without a second login.
  const DEMO_SUB = !!window.IS_DEMO && /[?&]as=sub(&|$)/.test(window.location.search || '');
  function demoState() {
    const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
    return {
      subId: 'demo', orgId: 'demo', status: 'active',
      business: { name: 'Sample Pest Co Pty Ltd', tradingName: 'Sample Pest Co' },
      me: {
        email: 'jordan@leepest.example', fullName: 'Jordan Lee', businessName: 'Lee Pest Services',
        abn: '', phone: '0400 000 001', licenceNumber: 'DEMO-0002', licenceExpiry: day(200),
        insurer: 'Example Mutual', insurancePolicy: 'EX-12345', insuranceExpiry: day(20),
      },
    };
  }

  const isSub = () => { if (DEMO_SUB) return true; const s = S(); return !!(s && typeof s.isSubcontractor === 'function' && s.isSubcontractor()); };
  const state = () => { if (DEMO_SUB) return demoState(); const s = S(); return (s && typeof s.subcontractor === 'function' && s.subcontractor()) || null; };
  const isActive = () => { const st = state(); return isSub() && !!st && st.status === 'active'; };
  function hostName() {
    const st = state();
    const b = (st && st.business) || {};
    return b.tradingName || b.name || 'the business';
  }
  const toast = (msg) => window.Common.toast(msg);

  // ---------- Dates: licence and insurance ----------
  // The same rules as supabase/functions/_shared/subcontractor.js (the suite
  // checks the two agree). Kept here as well because this has to work with no
  // signal, and that file is not part of the offline app.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function cleanDate(v) {
    const s = String(v == null ? '' : v).trim();
    if (!ISO_DATE.test(s)) return '';
    const d = new Date(`${s}T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10) === s ? s : '';
  }
  function todayIso(now) {
    const d = new Date(now == null ? Date.now() : now);
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(d);
      if (ISO_DATE.test(parts)) return parts;
    } catch (e) { /* fall through to UTC */ }
    return d.toISOString().slice(0, 10);
  }
  // 'none' (no date given), 'ok', 'soon' (within warnDays), 'lapsed'.
  function expiryState(dateIso, now, warnDays) {
    const d = cleanDate(dateIso);
    if (!d) return 'none';
    const today = todayIso(now);
    if (d < today) return 'lapsed';
    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + (Number.isFinite(warnDays) ? warnDays : 30));
    return d <= limit.toISOString().slice(0, 10) ? 'soon' : 'ok';
  }
  function niceDate(iso) {
    const d = cleanDate(iso);
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${months[m - 1]} ${y}`;
  }
  // { lapsed: [sentence], soon: [sentence], blocked }. blocked: something has
  // lapsed, so no report may be started or submitted until it is brought up
  // to date.
  function paperworkState(me, now) {
    const m = me || {};
    const lapsed = [];
    const soon = [];
    for (const [word, date] of [['licence', m.licenceExpiry], ['insurance', m.insuranceExpiry]]) {
      const st = expiryState(date, now);
      if (st === 'lapsed') lapsed.push(`The ${word} on record expired on ${niceDate(date)}.`);
      else if (st === 'soon') soon.push(`The ${word} on record expires on ${niceDate(date)}.`);
    }
    return { lapsed, soon, blocked: lapsed.length > 0 };
  }

  function paperwork(now) {
    const st = state();
    return paperworkState(st && st.me, now);
  }

  // A sentence when this subcontractor may not start or submit a report, else
  // ''. Asked by the Start button and by Sign and submit.
  function blockReason(now) {
    if (!isSub()) return '';
    if (!isActive()) return `You cannot work on jobs for ${hostName()} at the moment.`;
    const p = paperwork(now);
    if (!p.blocked) return '';
    return `${p.lapsed.join(' ')} Update it under My details before you start or submit a report for ${hostName()}.`;
  }

  // ---------- Where a subcontractor's report is up to ----------
  // Worked out from the report's own audit trail, so there is nothing extra to
  // keep in step: 'finalized' is the subcontractor signing and submitting,
  // 'returned' is the host sending it back (which also un-finalises it), and
  // 'reviewed' is the host marking it checked. Emailing it counts as reviewed.
  //   { state: 'none' | 'waiting' | 'returned' | 'reviewed', at, by, note }
  //
  // THE TWO PHONES' CLOCKS ARE NOT TRUSTED TO AGREE. The subcontractor signs on
  // one phone and the business reviews on another, and a phone set a few
  // minutes slow would make "reviewed" look older than the signature it is
  // about. So a review names the submission it is for (`of`, the report's
  // finalizedAt at that moment) and is matched on that; a return is counted
  // against the submissions rather than timed against them. Times are only
  // compared for older entries that carry no `of`, and for the email stamp.
  function reviewState(report) {
    const r = report || {};
    const log = (Array.isArray(r.auditLog) ? r.auditLog : []).filter(Boolean);
    const latest = (list) => list.reduce((a, b) => (!a || (b.at || 0) >= (a.at || 0) ? b : a), null);
    const finals = log.filter((e) => e.event === 'finalized');
    const returns = log.filter((e) => e.event === 'returned');
    const reviews = log.filter((e) => e.event === 'reviewed');
    const lastFinal = latest(finals);
    if (r.finalizedAt) {
      const since = lastFinal ? lastFinal.at : r.finalizedAt;
      const hit = latest(reviews.filter((e) => e.of === r.finalizedAt))
        || latest(reviews.filter((e) => e.of === undefined && (e.at || 0) >= since));
      if (hit) return { state: 'reviewed', at: hit.at, by: hit.userEmail || '' };
      if (r.emailedAt && r.emailedAt >= since) return { state: 'reviewed', at: r.emailedAt, by: '' };
      return { state: 'waiting', at: since, by: (lastFinal && lastFinal.userEmail) || '' };
    }
    // Not finalised. Sent back, if every submission so far has been returned.
    if (returns.length && returns.length >= finals.length) {
      const last = latest(returns);
      return { state: 'returned', at: last.at, by: last.userEmail || '', note: last.note || '' };
    }
    return { state: 'none' };
  }

  // The line a subcontractor reads on their own job. '' when there is nothing
  // to say (a report not yet submitted and never sent back).
  function reviewLine(report, host) {
    const rs = reviewState(report);
    const who = host || hostName();
    if (rs.state === 'waiting') return `Submitted. With ${who} to review and send.`;
    if (rs.state === 'reviewed') return `Reviewed by ${who}.`;
    if (rs.state === 'returned') return `Sent back by ${who}${rs.note ? `: ${rs.note}` : '.'} Make the change, then sign and submit again.`;
    return '';
  }

  // ---------- The screen shown instead of the app ----------
  // Pure, so the suite can read the words.
  function gateText(status, host) {
    const who = host || 'the business';
    if (status === 'pending') {
      return {
        title: `Waiting for ${who} to approve you`,
        body: `Your details and the agreement you signed have gone to ${who}. You can start as soon as they approve you. There is nothing more you need to do.`,
        retry: true,
      };
    }
    if (status === 'declined') {
      return {
        title: `${who} did not approve this application`,
        body: `If you think that is a mistake, contact ${who} directly.`,
        retry: true,
      };
    }
    return {
      title: `Your access to ${who} has ended`,
      body: `The jobs you were given have been taken off this phone. If you think that is a mistake, contact ${who} directly.`,
      retry: true,
    };
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  let checking = false;
  async function checkAgain() {
    const s = S();
    if (!s || checking) return;
    checking = true;
    try {
      if (s.refreshRole) await s.refreshRole();
      if (window.Org && window.Org.refresh) await window.Org.refresh().catch(() => {});
      apply();
      if (isActive()) {
        toast(`You are approved. Jobs from ${hostName()} will appear here.`);
        if (s.pullAll) await s.pullAll().catch(() => {});
        if (window.renderJobListPublic) window.renderJobListPublic();
      } else {
        toast('No change yet.');
      }
    } finally {
      checking = false;
    }
  }

  function renderGate() {
    const old = document.getElementById('sub-gate');
    if (old) old.remove();
    if (!isSub() || isActive()) return;
    const st = state() || {};
    const text = gateText(st.status, hostName());
    const retry = el('button', { type: 'button', id: 'sub-gate-retry', class: 'btn btn-primary full', text: 'Check again' });
    retry.addEventListener('click', () => { checkAgain(); });
    const out = el('button', { type: 'button', id: 'sub-gate-logout', class: 'btn btn-secondary full', text: 'Log out' });
    out.addEventListener('click', async () => {
      const s = S();
      if (s && s.signOut) await s.signOut().catch(() => {});
      const g = document.getElementById('sub-gate');
      if (g) g.remove();
      document.body.classList.remove('is-sub');
      if (window.showLoginView) window.showLoginView();
    });
    const gate = el('section', { id: 'sub-gate', class: 'sub-gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sub-gate-title' }, [
      el('div', { class: 'sub-gate-card' }, [
        el('h2', { id: 'sub-gate-title', text: text.title }),
        el('p', { class: 'sub-gate-body', text: text.body }),
        retry,
        out,
      ]),
    ]);
    document.body.appendChild(gate);
  }

  // ---------- Licence and insurance banner on the job list ----------
  function renderBanner() {
    const old = document.getElementById('sub-banner');
    if (old) old.remove();
    if (!isActive()) return;
    const p = paperwork();
    if (!p.lapsed.length && !p.soon.length) return;
    const host = document.querySelector('#view-joblist main.content');
    if (!host) return;
    const lines = p.blocked
      ? `${p.lapsed.join(' ')} You cannot start or submit a report for ${hostName()} until it is up to date.`
      : `${p.soon.join(' ')} Update it before then so your work is not held up.`;
    const btn = el('button', { type: 'button', class: 'link-btn', id: 'sub-banner-btn', text: 'Update my details' });
    btn.addEventListener('click', openMyDetails);
    const banner = el('div', { id: 'sub-banner', class: `sub-banner${p.blocked ? ' sub-banner-blocked' : ''}`, role: 'status' }, [
      el('span', { class: 'sub-banner-text', text: lines }),
      btn,
    ]);
    host.insertBefore(banner, host.firstChild);
  }

  // ---------- My details ----------
  const MY_FIELDS = [
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'licenceNumber', label: 'Pest management licence number', type: 'text' },
    { key: 'licenceExpiry', label: 'Licence expires', type: 'date' },
    { key: 'insurer', label: 'Insurer', type: 'text' },
    { key: 'insurancePolicy', label: 'Insurance policy number', type: 'text' },
    { key: 'insuranceExpiry', label: 'Insurance expires', type: 'date' },
  ];

  function openMyDetails() {
    const st = state();
    if (!st) return;
    const existing = document.getElementById('sub-details-panel');
    if (existing) existing.remove();
    const me = st.me || {};
    const card = el('div', { class: 'business-card' });
    card.appendChild(el('h2', { text: 'My details' }));
    card.appendChild(el('p', {
      class: 'business-hint',
      text: `You are working for ${hostName()} as ${me.fullName || me.email || 'a subcontractor'}`
        + `${me.businessName ? ` (${me.businessName})` : ''}. Your name and licence number go on every report as the inspector. `
        + `${hostName()} can see these details. To change your name, business name or ABN, ask them.`,
    }));
    const inputs = {};
    for (const f of MY_FIELDS) {
      const input = el('input', { type: f.type, id: `sub-my-${f.key}`, autocomplete: 'off' });
      input.value = me[f.key] || '';
      inputs[f.key] = input;
      card.appendChild(el('label', { class: 'business-field' }, [
        el('span', { class: 'business-label', text: f.label }),
        input,
      ]));
    }
    const note = el('p', { class: 'calendar-feed-hint', id: 'sub-my-hint', text: '' });
    card.appendChild(note);
    const cancel = el('button', { type: 'button', class: 'btn btn-secondary flex1', id: 'sub-my-cancel', text: 'Cancel' });
    const save = el('button', { type: 'button', class: 'btn btn-primary flex1', id: 'sub-my-save', text: 'Save' });
    card.appendChild(el('div', { class: 'row gap' }, [cancel, save]));
    const panel = el('section', { id: 'sub-details-panel', class: 'modal' }, [card]);
    cancel.addEventListener('click', () => panel.remove());
    save.addEventListener('click', async () => {
      const changes = {};
      for (const f of MY_FIELDS) changes[f.key] = inputs[f.key].value.trim();
      if (!changes.licenceNumber) { note.textContent = 'Enter your licence number.'; return; }
      for (const key of ['licenceExpiry', 'insuranceExpiry']) {
        if (changes[key] && !cleanDate(changes[key])) { note.textContent = 'One of those dates is not a real date.'; return; }
      }
      if (DEMO_SUB) { panel.remove(); toast('In the demo nothing is saved.'); return; }
      const client = window.supabaseClient;
      if (!client) { note.textContent = 'You need to be online to save your details.'; return; }
      save.disabled = true;
      try {
        const { data, error } = await client.rpc('sub_update_my_profile', { p_org: st.orgId, p: changes });
        if (error) throw error;
        if (data !== true) throw new Error('Those details were not saved. Your access may have changed: check again shortly.');
        const s = S();
        if (s && s.refreshRole) await s.refreshRole();
        if (window.Org && window.Org.refresh) await window.Org.refresh().catch(() => {});
        panel.remove();
        apply();
        toast('Your details are saved.');
      } catch (e) {
        if (window.ErrorLog) window.ErrorLog.note(e, 'subcontractor: save my details');
        note.textContent = /fetch|network/i.test(String(e.message || e))
          ? 'Could not reach the server. Try again when you have signal.'
          : (e.message || 'Those details were not saved.');
        save.disabled = false;
      }
    });
    document.body.appendChild(panel);
  }

  // ---------- Where a report is up to, on the job list and the job ----------
  // The business's view of the same thing: whose report it is and what it is
  // waiting on. '' when there is nothing to say.
  function hostReviewLine(report, name) {
    const rs = reviewState(report);
    const who = name || 'the subcontractor';
    if (rs.state === 'waiting') return `Report from ${who} is waiting for you to review and send.`;
    if (rs.state === 'returned') return `Sent back to ${who}. Waiting for them to sign it again.`;
    return '';
  }

  const hostSeesSubJob = (job) => !isSub() && !!(job && job.assignedTo && window.Org
    && window.Org.isSubcontractorEmail && window.Org.isSubcontractorEmail(job.assignedTo));

  async function lineFor(job) {
    const mine = isSub();
    if (!mine && !hostSeesSubJob(job)) return null;
    if (!window.DB) return null;
    const report = await window.DB.getReport(job.id).catch(() => null);
    if (!report) return null;
    const rs = reviewState(report);
    const name = mine ? '' : (window.Org.nameFor ? window.Org.nameFor(job.assignedTo) : job.assignedTo);
    const text = mine ? reviewLine(report) : hostReviewLine(report, name);
    return text ? { text, state: rs.state } : null;
  }

  // One line under a job in the list. Not awaited by the list.
  async function decorateJobItem(li, job) {
    try {
      const line = await lineFor(job);
      if (!line || !li || !li.isConnected) return;
      li.appendChild(el('span', { class: `job-item-review job-item-review-${line.state}`, text: line.text }));
    } catch (e) { /* a missing line is not worth breaking the list for */ }
  }

  // The same line at the top of the job screen.
  async function renderJobNote(job) {
    const old = document.getElementById('sub-job-note');
    if (old) old.remove();
    try {
      const line = await lineFor(job);
      if (!line) return;
      const card = document.querySelector('#view-job .inspection-card');
      if (!card || document.getElementById('sub-job-note')) return;
      card.insertBefore(el('p', { id: 'sub-job-note', class: `sub-job-note sub-job-note-${line.state}`, text: line.text }), card.firstChild);
    } catch (e) { /* as above */ }
  }

  // ---------- Putting it on screen ----------
  // Called whenever who is signed in, or what they are, may have changed.
  function apply() {
    const sub = isSub();
    document.body.classList.toggle('is-sub', sub);
    const settings = document.getElementById('business-details-btn');
    if (settings) settings.textContent = sub ? 'My details' : 'Settings';
    const empty = document.getElementById('job-empty');
    if (empty) {
      if (!empty.dataset.usual) empty.dataset.usual = empty.textContent;
      empty.textContent = sub
        ? `No jobs yet. Jobs ${hostName()} gives you will appear here, or tap "+ New Job" to start one for them.`
        : empty.dataset.usual;
    }
    renderGate();
    renderBanner();
  }

  // Sync tells its listeners after it has worked out the role, which is the
  // moment this needs. A restored session does not fire it, so app.js also
  // calls apply() once it has the session.
  const s0 = S();
  if (s0 && typeof s0.onAuthChange === 'function') s0.onAuthChange(() => apply());
  // The demo has no sign-in to wait for.
  if (DEMO_SUB) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply());
    else setTimeout(apply, 0);
  }

  window.Subcontractor = {
    isSub, isActive, state, hostName,
    apply, openMyDetails,
    blockReason, paperwork,
    cleanDate, todayIso, expiryState, paperworkState,
    reviewState, reviewLine, hostReviewLine, gateText,
    decorateJobItem, renderJobNote,
    _checkAgain: checkAgain, // for the suite
  };
})();
