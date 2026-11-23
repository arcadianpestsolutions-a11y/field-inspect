// ---------------------------------------------------------------------------
// subcontractors-ui.js - the business's side of working with subcontractors.
//
// PURPOSE   A business (the host) writes its own agreement, hands out one
//           sign-up link, approves the people who use it, and removes them
//           when the work ends. Their reports arrive to be reviewed and sent.
//           This is the screen under More > Subcontractors, plus the notice on
//           the job list when somebody or something is waiting.
// EXPOSES   window.SubcontractorsUI = { open, refreshNotice, linkFor,
//           waitingReports, noticeLines, AGREEMENT_HINT }
// DEPENDS   supabaseClient (sub_settings, sub_settings_save, sub_decide and the
//           subcontractors table: migration 048), Subcontractor (date rules,
//           reviewState), Org, DB, Common. Admin only; the database enforces
//           that, this only decides whether to offer the screen.
// TOUCHES   Nothing on the phone.
// TESTS     tests/run-tests.js - "Subcontractors" group.
//
// THE AGREEMENT IS THE BUSINESS'S OWN WORDS. Scope supplies a box and keeps a
// record of who accepted which wording and when. It does not supply wording.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const toast = (msg) => window.Common.toast(msg);

  // ---------- The demo: a made-up list, kept in memory ----------
  // So the screen can be looked at and tried without a real business or a
  // second login. It answers the same calls the server does, changes only its
  // own copy, and forgets everything when the page is closed.
  let demoData = null;
  function demoStore() {
    if (demoData) return demoData;
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const stamp = (n) => new Date(Date.now() + n * 86400000).toISOString();
    const wording = 'SAMPLE ONLY. This is where your own agreement goes.\n\n'
      + '1. The work. You carry out the jobs we assign to you, to the Australian Standards that apply, and record them in Scope.\n\n'
      + '2. Licences and insurance. You hold a current pest management licence and public liability insurance, and tell us before either lapses.\n\n'
      + '3. Our clients. Clients you meet through us are ours. You contact them only about the job you were given.\n\n'
      + '4. Ending it. Either of us can end this arrangement at any time.';
    const person = (o) => Object.assign({
      abn: '', decided_at: null, agreement_text: wording, agreement_version: 1,
    }, o);
    demoData = {
      settings: {
        org_id: 'demo', invite_token: 'd'.repeat(64), invite_enabled: true, agreement_text: wording,
        agreement_version: 1, agreement_updated_at: stamp(-30), require_insurance: true, require_licence_expiry: true,
      },
      rows: [
        person({ id: 'demo-1', status: 'pending', email: 'casey@northsidepest.example', full_name: 'Casey Nguyen', business_name: 'Northside Pest Control',
          abn: '11 222 333 444', phone: '0400 000 002', licence_number: 'DEMO-0003', licence_expiry: day(400), insurer: 'Example Mutual',
          insurance_policy: 'EX-55501', insurance_expiry: day(250), agreement_accepted_at: stamp(-1), agreement_accepted_name: 'Casey Nguyen', applied_at: stamp(-1) }),
        person({ id: 'demo-2', status: 'active', email: 'jordan@leepest.example', full_name: 'Jordan Lee', business_name: 'Lee Pest Services',
          phone: '0400 000 001', licence_number: 'DEMO-0002', licence_expiry: day(200), insurer: 'Example Mutual',
          insurance_policy: 'EX-12345', insurance_expiry: day(20), agreement_accepted_at: stamp(-25), agreement_accepted_name: 'Jordan Lee', applied_at: stamp(-26) }),
      ],
    };
    return demoData;
  }
  function demoClient() {
    const st = demoStore();
    const ok = (data) => ({ data, error: null });
    return {
      rpc: async (name, args) => {
        const a = args || {};
        if (name === 'sub_settings') return ok({ ...st.settings });
        if (name === 'sub_settings_save') {
          const p = a.p || {};
          if ('agreementText' in p && String(p.agreementText).trim() !== st.settings.agreement_text) {
            st.settings.agreement_text = String(p.agreementText).trim();
            st.settings.agreement_version += 1;
            st.settings.agreement_updated_at = new Date().toISOString();
          }
          if ('inviteEnabled' in p) st.settings.invite_enabled = !!p.inviteEnabled;
          if ('requireInsurance' in p) st.settings.require_insurance = !!p.requireInsurance;
          if ('requireLicenceExpiry' in p) st.settings.require_licence_expiry = !!p.requireLicenceExpiry;
          if (p.rotate) st.settings.invite_token = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
          return ok({ ...st.settings });
        }
        if (name === 'sub_decide') {
          const row = st.rows.find((r) => r.id === a.p_id);
          if (!row) return { data: null, error: { message: 'That subcontractor is not on your list.' } };
          row.status = a.p_status;
          row.decided_at = new Date().toISOString();
          return ok({ ...row });
        }
        return { data: null, error: { message: 'Not part of the demo.' } };
      },
      from: () => ({ select: () => ({ order: async () => ok(st.rows.map((r) => ({ ...r }))) }) }),
    };
  }

  const client = () => (window.IS_DEMO ? demoClient() : (window.supabaseClient || null));
  // The demo shows the business's screens, so it shows this one. As a
  // subcontractor (&as=sub) it does not: they never see it.
  const isAdmin = () => {
    if (window.Subcontractor && window.Subcontractor.isSub()) return false;
    if (window.IS_DEMO) return true;
    return !!(window.Sync && window.Sync.isAdmin && window.Sync.isAdmin());
  };

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => { if (c) node.appendChild(c); });
    return node;
  }

  const fmtDay = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  };

  const AGREEMENT_HINT = 'Write your own agreement here, or have a solicitor write it. Scope does not supply one. '
    + 'An agreement usually covers the work and the standard expected, licences and insurance, who the client belongs to '
    + 'and how they may be contacted, confidentiality, payment, and how either side ends the arrangement.';

  // The page a subcontractor opens. Worked out from wherever this copy of the
  // app is being served, so it is right on the live site and on a test copy.
  function linkFor(token, here) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return '';
    try {
      const url = new URL('join.html', here || window.location.href);
      // In the demo the link opens a sample of the sign-up page.
      url.search = `?t=${token}${window.IS_DEMO ? '&demo=1' : ''}`;
      url.hash = '';
      return url.href;
    } catch (e) { return ''; }
  }

  // ---------- What is waiting (pure where it can be) ----------
  // Jobs whose subcontractor has signed and submitted a report nobody at the
  // business has reviewed or sent yet. pairs: [{ job, report }].
  function waitingReports(pairs, isSubEmail) {
    const R = window.Subcontractor;
    if (!R) return [];
    return (pairs || []).filter(({ job, report }) => job && report && job.assignedTo
      && isSubEmail(job.assignedTo) && R.reviewState(report).state === 'waiting').map(({ job }) => job);
  }

  // The sentences for the notice. rows: subcontractor rows from the server.
  function noticeLines(rows, waitingCount, now) {
    const R = window.Subcontractor;
    const lines = [];
    const pending = (rows || []).filter((r) => r.status === 'pending');
    if (pending.length === 1) lines.push({ kind: 'people', text: `${pending[0].full_name || 'Someone'} has applied to work for you as a subcontractor.` });
    else if (pending.length > 1) lines.push({ kind: 'people', text: `${pending.length} people have applied to work for you as subcontractors.` });
    if (waitingCount === 1) lines.push({ kind: 'reports', text: '1 report from a subcontractor is waiting for you to review and send.' });
    else if (waitingCount > 1) lines.push({ kind: 'reports', text: `${waitingCount} reports from subcontractors are waiting for you to review and send.` });
    if (R) {
      for (const r of (rows || []).filter((x) => x.status === 'active')) {
        const p = R.paperworkState({ licenceExpiry: r.licence_expiry, insuranceExpiry: r.insurance_expiry }, now);
        const name = r.full_name || r.email;
        for (const s of p.lapsed) lines.push({ kind: 'people', text: `${name}: ${s} They cannot start or submit a report until it is updated.` });
        for (const s of p.soon) lines.push({ kind: 'people', text: `${name}: ${s}` });
      }
    }
    return lines;
  }

  async function loadRows() {
    const c = client();
    if (!c) return [];
    const { data, error } = await c.from('subcontractors').select('*').order('applied_at', { ascending: false });
    if (error) {
      // A database without migration 048: there are no subcontractors.
      if (/does not exist|could not find the table|schema cache/i.test(error.message || '')) return [];
      throw error;
    }
    return data || [];
  }

  async function localWaiting() {
    if (!window.DB || !window.Org || !window.Org.isSubcontractorEmail) return [];
    const jobs = await window.DB.getJobs();
    const pairs = [];
    for (const job of jobs) {
      if (!job.assignedTo || !window.Org.isSubcontractorEmail(job.assignedTo)) continue;
      pairs.push({ job, report: await window.DB.getReport(job.id).catch(() => null) });
    }
    return waitingReports(pairs, (e) => window.Org.isSubcontractorEmail(e));
  }

  // ---------- The notice on the job list ----------
  let noticeBusy = false;
  async function refreshNotice() {
    const more = document.getElementById('open-subcontractors-btn');
    if (more) more.classList.toggle('hidden', !isAdmin());
    const old = document.getElementById('subs-notice');
    // No notice in the demo: its made-up applicant is for the screen itself.
    if (!isAdmin() || window.IS_DEMO) { if (old) old.remove(); return; }
    if (noticeBusy) return;
    noticeBusy = true;
    try {
      let rows = [];
      try { rows = await loadRows(); } catch (e) { rows = []; }
      const waiting = await localWaiting().catch(() => []);
      const lines = noticeLines(rows, waiting.length);
      const existing = document.getElementById('subs-notice');
      if (existing) existing.remove();
      if (!lines.length) return;
      const host = document.querySelector('#view-joblist main.content');
      if (!host) return;
      const box = el('div', { id: 'subs-notice', class: 'subs-notice', role: 'status' });
      for (const line of lines) {
        const btn = el('button', { type: 'button', class: 'link-btn', text: line.kind === 'reports' ? 'Show them' : 'Open' });
        btn.addEventListener('click', () => { if (line.kind === 'reports') showWaiting(waiting); else open(); });
        box.appendChild(el('p', { class: 'subs-notice-line' }, [el('span', { text: line.text }), btn]));
      }
      host.insertBefore(box, host.firstChild);
    } finally {
      noticeBusy = false;
    }
  }

  function showWaiting(jobs) {
    const old = document.getElementById('subs-waiting-panel');
    if (old) old.remove();
    const card = el('div', { class: 'business-card' }, [
      el('h2', { text: 'Reports to review' }),
      el('p', { class: 'business-hint', text: 'Signed and submitted by a subcontractor. Open one, check it, then send it to the client or send it back.' }),
    ]);
    const panel = el('section', { id: 'subs-waiting-panel', class: 'modal' }, [card]);
    for (const job of jobs) {
      const who = window.Org.nameFor(job.assignedTo);
      const row = el('button', { type: 'button', class: 'btn btn-outline full subs-waiting-row', text: `${job.name || job.address || 'A job'} · ${who}` });
      row.addEventListener('click', () => {
        panel.remove();
        if (window.ReportUI && window.ReportUI.openReview) window.ReportUI.openReview(job.id);
        else if (window.showJobViewById) window.showJobViewById(job.id);
      });
      card.appendChild(row);
    }
    const close = el('button', { type: 'button', class: 'btn btn-secondary full', text: 'Close' });
    close.addEventListener('click', () => panel.remove());
    card.appendChild(close);
    document.body.appendChild(panel);
  }

  // ---------- The Subcontractors screen ----------
  function personCard(row, actions) {
    const R = window.Subcontractor;
    const lic = R ? R.expiryState(row.licence_expiry) : 'none';
    const ins = R ? R.expiryState(row.insurance_expiry) : 'none';
    const flag = (state) => (state === 'lapsed' ? ' (EXPIRED)' : state === 'soon' ? ' (expires soon)' : '');
    const lines = [
      `${row.business_name || ''}${row.abn ? ` · ABN ${row.abn}` : ''}`.trim(),
      `${row.phone || ''}${row.phone && row.email ? ' · ' : ''}${row.email || ''}`,
      `Licence ${row.licence_number || 'not given'}${row.licence_expiry ? `, expires ${fmtDay(row.licence_expiry)}${flag(lic)}` : ''}`,
      (row.insurer || row.insurance_policy || row.insurance_expiry)
        ? `Insurance ${[row.insurer, row.insurance_policy].filter(Boolean).join(', ') || 'details not given'}${row.insurance_expiry ? `, expires ${fmtDay(row.insurance_expiry)}${flag(ins)}` : ''}`
        : 'Insurance: not given',
      row.agreement_accepted_at
        ? `Accepted your agreement (version ${row.agreement_version}) on ${fmtDay(row.agreement_accepted_at)}, signed "${row.agreement_accepted_name || ''}"`
        : '',
    ].filter(Boolean);
    const card = el('div', { class: `subs-person${lic === 'lapsed' || ins === 'lapsed' ? ' subs-person-lapsed' : ''}`, 'data-sub': row.id }, [
      el('strong', { class: 'subs-person-name', text: row.full_name || row.email }),
    ]);
    lines.forEach((t) => card.appendChild(el('span', { class: 'subs-person-line', text: t })));
    if (row.agreement_text) {
      const view = el('button', { type: 'button', class: 'link-btn', text: 'Read what they accepted' });
      view.addEventListener('click', () => showAgreement(row));
      card.appendChild(view);
    }
    const bar = el('div', { class: 'row gap subs-person-actions' });
    actions.forEach((a) => bar.appendChild(a));
    card.appendChild(bar);
    return card;
  }

  function showAgreement(row) {
    const old = document.getElementById('subs-agreement-panel');
    if (old) old.remove();
    const body = el('pre', { class: 'subs-agreement-text', text: row.agreement_text || '' });
    const close = el('button', { type: 'button', class: 'btn btn-secondary full', text: 'Close' });
    const panel = el('section', { id: 'subs-agreement-panel', class: 'modal' }, [
      el('div', { class: 'business-card' }, [
        el('h2', { text: `Agreement accepted by ${row.full_name || row.email}` }),
        el('p', { class: 'business-hint', text: `Version ${row.agreement_version}, accepted ${fmtDay(row.agreement_accepted_at)}, signed "${row.agreement_accepted_name || ''}". This is the wording they saw, kept as it was.` }),
        body,
        close,
      ]),
    ]);
    close.addEventListener('click', () => panel.remove());
    document.body.appendChild(panel);
  }

  async function decide(row, status, question, okLabel, danger) {
    if (!await window.Common.askConfirm(question, { title: okLabel, okLabel, danger: !!danger })) return false;
    const c = client();
    if (!c) { toast('You need to be online to do this.'); return false; }
    const { error } = await c.rpc('sub_decide', { p_id: row.id, p_status: status });
    if (error) {
      if (window.ErrorLog) window.ErrorLog.note(error, 'subcontractors: decide');
      toast(error.message || 'That did not save. Try again.');
      return false;
    }
    return true;
  }

  async function open() {
    if (!isAdmin()) {
      toast('Only the business owner can manage subcontractors.');
      return;
    }
    const c = client();
    if (!c) { toast('You need to be online to manage subcontractors.'); return; }
    const sheet = document.getElementById('more-sheet');
    if (sheet) sheet.classList.add('hidden');

    let settings;
    let rows;
    try {
      const res = await c.rpc('sub_settings');
      if (res.error) throw res.error;
      settings = res.data;
      rows = await loadRows();
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'subcontractors: open');
      toast(/fetch|network/i.test(String(e.message || e))
        ? 'Could not reach the server. Try again when you have signal.'
        : (e.message || 'Subcontractors could not be loaded.'));
      return;
    }
    draw(settings, rows);
  }

  function draw(settings, rows) {
    const existing = document.getElementById('subs-panel');
    if (existing) existing.remove();
    const c = client();
    const businessName = (window.Org && window.Org.businessName()) || 'your business';
    const card = el('div', { class: 'business-card subs-card' });
    const panel = el('section', { id: 'subs-panel', class: 'modal' }, [card]);
    const redraw = async () => {
      try {
        const res = await c.rpc('sub_settings');
        if (res.error) throw res.error;
        draw(res.data, await loadRows());
      } catch (e) { toast(e.message || 'Could not refresh the list.'); }
      if (window.Org && window.Org.refresh) window.Org.refresh().catch(() => {});
      refreshNotice();
    };
    const saveSettings = async (patch, done) => {
      const { error } = await c.rpc('sub_settings_save', { p: patch });
      if (error) {
        if (window.ErrorLog) window.ErrorLog.note(error, 'subcontractors: save settings');
        toast(error.message || 'That did not save. Try again.');
        return;
      }
      if (done) toast(done);
      await redraw();
    };

    card.appendChild(el('h2', { text: 'Subcontractors' }));
    if (window.IS_DEMO) {
      card.appendChild(el('p', { class: 'job-readonly-notice', text: 'Demo: these people and this agreement are made up. Try the buttons; nothing is saved or sent.' }));
    }
    card.appendChild(el('p', {
      class: 'business-hint',
      text: `People who do jobs for ${businessName} under your name. They sign up with your link, accept your agreement, and wait for you to approve them. `
        + 'They see only the jobs you assign to them: never your client list, invoices, figures or anybody else\'s work, and not a client\'s email address. '
        + 'Their reports carry your name and logo, with their own name and licence as the inspector, and come to you to review and send.',
    }));

    // ---- 1. The agreement ----
    card.appendChild(el('h3', { class: 'business-subhead', text: '1. Your agreement' }));
    card.appendChild(el('p', { class: 'business-hint', text: AGREEMENT_HINT }));
    const text = el('textarea', { id: 'subs-agreement', rows: '10', maxlength: '60000', placeholder: 'Your subcontractor agreement' });
    text.value = settings.agreement_text || '';
    card.appendChild(text);
    card.appendChild(el('p', {
      class: 'business-hint',
      id: 'subs-agreement-state',
      text: settings.agreement_version
        ? `Version ${settings.agreement_version}, saved ${fmtDay(settings.agreement_updated_at)}. A change applies to people who sign up from now on; each person's record keeps the wording they accepted.`
        : 'Not written yet. Your sign-up link starts working once an agreement is saved.',
    }));
    const insWrap = el('label', { class: 'business-toggle' });
    const ins = el('input', { type: 'checkbox', id: 'subs-require-insurance' });
    ins.checked = settings.require_insurance !== false;
    insWrap.append(ins, document.createTextNode(' Insurer, policy number and expiry date must be given'));
    const licWrap = el('label', { class: 'business-toggle' });
    const lic = el('input', { type: 'checkbox', id: 'subs-require-licence-expiry' });
    lic.checked = settings.require_licence_expiry !== false;
    licWrap.append(lic, document.createTextNode(' Licence expiry date must be given'));
    card.append(insWrap, licWrap);
    const saveAgreement = el('button', { type: 'button', id: 'subs-agreement-save', class: 'btn btn-primary full', text: 'Save agreement' });
    saveAgreement.addEventListener('click', async () => {
      const wording = text.value.trim();
      if (!wording) { toast('Write the agreement first. A blank one cannot be accepted.'); return; }
      saveAgreement.disabled = true;
      await saveSettings({ agreementText: wording, requireInsurance: ins.checked, requireLicenceExpiry: lic.checked }, 'Agreement saved');
      saveAgreement.disabled = false;
    });
    card.appendChild(saveAgreement);

    // ---- 2. The link ----
    card.appendChild(el('h3', { class: 'business-subhead', text: '2. Your sign-up link' }));
    const hasAgreement = !!String(settings.agreement_text || '').trim();
    if (!hasAgreement) {
      card.appendChild(el('p', { class: 'business-hint', id: 'subs-link-state', text: 'Save your agreement first. The link is given to you once there is something for people to accept.' }));
    } else {
      const url = linkFor(settings.invite_token);
      card.appendChild(el('p', {
        class: 'business-hint',
        id: 'subs-link-state',
        text: settings.invite_enabled
          ? 'Send this link to a subcontractor. Anyone who has it can apply, and nobody gets in until you approve them.'
          : 'The link is switched off. Nobody can apply with it until you turn it back on.',
      }));
      const input = el('input', { type: 'text', id: 'subs-link', readonly: 'readonly', 'aria-label': 'Sign-up link' });
      input.value = url;
      const copy = el('button', { type: 'button', id: 'subs-link-copy', class: 'btn btn-secondary', text: 'Copy' });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { input.select(); toast('Select the link and copy it.'); }
      });
      card.appendChild(el('div', { class: 'calendar-feed-url-row' }, [input, copy]));
      const toggle = el('button', { type: 'button', id: 'subs-link-toggle', class: 'btn btn-outline flex1', text: settings.invite_enabled ? 'Switch the link off' : 'Switch the link on' });
      toggle.addEventListener('click', () => saveSettings({ inviteEnabled: !settings.invite_enabled }, settings.invite_enabled ? 'Link switched off' : 'Link switched on'));
      const rotate = el('button', { type: 'button', id: 'subs-link-rotate', class: 'btn btn-outline flex1', text: 'Make a new link' });
      rotate.addEventListener('click', async () => {
        if (!await window.Common.askConfirm(
          'The old link stops working straight away, for everyone you sent it to. People already approved are not affected.',
          { title: 'Make a new link?', okLabel: 'Make a new link' })) return;
        await saveSettings({ rotate: true }, 'New link made. The old one no longer works.');
      });
      card.appendChild(el('div', { class: 'row gap' }, [toggle, rotate]));
    }

    // ---- 3. The people ----
    const pending = rows.filter((r) => r.status === 'pending');
    const active = rows.filter((r) => r.status === 'active');
    const gone = rows.filter((r) => r.status === 'declined' || r.status === 'removed');
    const mk = (label, id, cls) => el('button', { type: 'button', id, class: cls, text: label });

    card.appendChild(el('h3', { class: 'business-subhead', text: `3. Waiting for your approval (${pending.length})` }));
    if (!pending.length) card.appendChild(el('p', { class: 'business-hint', text: 'Nobody is waiting.' }));
    for (const row of pending) {
      const approve = mk('Approve', `subs-approve-${row.id}`, 'btn btn-primary flex1');
      approve.addEventListener('click', async () => {
        if (await decide(row, 'active',
          `${row.full_name || row.email} will be able to sign in and work on jobs you assign to them. Check their licence and insurance details first.`,
          'Approve')) { toast(`${row.full_name || 'They'} can now work for you. Assign them a job from the job screen.`); await redraw(); }
      });
      const decline = mk('Decline', `subs-decline-${row.id}`, 'btn btn-secondary flex1');
      decline.addEventListener('click', async () => {
        if (await decide(row, 'declined', `${row.full_name || row.email} will see that their application was not approved the next time they sign in. They get no access.`, 'Decline', true)) await redraw();
      });
      card.appendChild(personCard(row, [decline, approve]));
    }

    card.appendChild(el('h3', { class: 'business-subhead', text: `Working for you (${active.length})` }));
    if (!active.length) card.appendChild(el('p', { class: 'business-hint', text: 'Nobody yet.' }));
    for (const row of active) {
      const remove = mk('Remove access', `subs-remove-${row.id}`, 'btn btn-secondary flex1');
      remove.addEventListener('click', async () => {
        if (await decide(row, 'removed',
          `${row.full_name || row.email} will stop seeing your jobs the next time their phone is online, and the jobs come off their phone. `
          + 'Work they have not yet synced will not reach you. Reports they already submitted stay with you.',
          'Remove access', true)) { toast('Access removed'); await redraw(); }
      });
      card.appendChild(personCard(row, [remove]));
    }

    if (gone.length) {
      card.appendChild(el('h3', { class: 'business-subhead', text: `No longer working for you (${gone.length})` }));
      for (const row of gone) {
        const back = mk('Let back in', `subs-restore-${row.id}`, 'btn btn-outline flex1');
        back.addEventListener('click', async () => {
          if (await decide(row, 'active', `${row.full_name || row.email} will be able to work on jobs you assign to them again.`, 'Let back in')) await redraw();
        });
        card.appendChild(personCard(row, [back]));
      }
    }

    const close = el('button', { type: 'button', id: 'subs-close', class: 'btn btn-secondary full', text: 'Close' });
    close.addEventListener('click', () => panel.remove());
    card.appendChild(close);
    document.body.appendChild(panel);
  }

  // The More item is in index.html; guarded for a stale cached page.
  const moreBtn = document.getElementById('open-subcontractors-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => { open(); });
    // Nothing signs in to the demo, so nothing else would reveal the item.
    if (window.IS_DEMO) moreBtn.classList.toggle('hidden', !isAdmin());
  }

  window.SubcontractorsUI = { open, refreshNotice, linkFor, waitingReports, noticeLines, AGREEMENT_HINT };
})();
