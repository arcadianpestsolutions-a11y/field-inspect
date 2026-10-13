// SOP library screens (v122): the list, one procedure, and the editor.
// The rules are in sop-rules.js; the starter drafts in sop-templates.js.
//
//   More > SOP library        what needs attention first (due or overdue for
//                             review, drafts waiting), then approved, then
//                             retired. Add starter SOPs; print the register.
//   One SOP                   the approved text in force, who approved it and
//                             when, next review, who has signed for this
//                             version, every earlier version.
//   Editing                   always a draft. The approved version stays in
//                             force until an admin approves the draft.
//
// Approving and retiring are offered to an admin (or with nobody signed in,
// in demo). The server lets any member write the table; the role check here
// keeps the buttons away from a technician, and the record says who did it.
//
// EXPOSES: window.SopsUI = { open, openSop, renderBody, addStarters }

(() => {
  'use strict';

  const S = window.SopRules;
  const listView = document.getElementById('view-sops');
  if (!S || !listView) return;

  const el = (id) => document.getElementById(id);
  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const escapeHtml = window.HtmlSafe ? window.HtmlSafe.escape : (s) => String(s);
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));
  const askPrompt = (msg, def, opts) => (window.Dialog ? window.Dialog.prompt(msg, def, opts) : Promise.resolve(window.prompt(msg, def)));

  const sopView = el('view-sop');
  const editView = el('view-sop-edit');
  let current = null;
  let unsaved = false;

  function showOnly(view) {
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  // ---------- who is acting ----------
  function signedInUser() {
    return window.Sync && window.Sync.currentUser ? window.Sync.currentUser() : null;
  }
  function actorName() {
    const me = window.Org && window.Org.me ? window.Org.me() : {};
    const user = signedInUser();
    return (me && me.displayName) || (user && user.email) || (window.IS_DEMO ? 'Demo user' : '');
  }
  function canApprove() {
    const user = signedInUser();
    if (!user) return true; // demo, or a phone not signed in: nothing to check against
    return !!(window.Sync.isAdmin && window.Sync.isAdmin());
  }
  async function needName(purpose) {
    const known = actorName();
    if (known) return known;
    const typed = await askPrompt(`Your name, for the record of who ${purpose}.`, '', { title: 'Who is this?', okLabel: 'Continue' });
    return typed ? String(typed).trim().slice(0, 120) : '';
  }

  // ---------- the text ----------
  // "## " heading, "- " bullet, "1. " numbered step, blank line a paragraph.
  function renderBody(text) {
    const out = [];
    let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim()) { close(); continue; }
      let m;
      if ((m = /^##\s+(.*)$/.exec(line))) { close(); out.push(`<h3>${escapeHtml(m[1])}</h3>`); continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
        if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
        out.push(`<li>${escapeHtml(m[1])}</li>`); continue;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
        out.push(`<li>${escapeHtml(m[1])}</li>`); continue;
      }
      close();
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
    close();
    return out.join('');
  }

  const STATE_TEXT = {
    overdue: 'Review overdue', 'due-soon': 'Review due soon', ok: 'Current', draft: 'Draft', retired: 'Retired',
  };

  // ---------- the list ----------
  function rowHtml(s) {
    const st = S.reviewState(s);
    const w = S.working(s);
    const title = s.status === 'approved' ? s.title : w.title;
    let meta;
    if (s.status === 'retired') meta = `Retired ${fmtDate(s.retiredAt)}`;
    else if (s.status === 'draft') meta = 'Draft, not yet approved';
    else meta = `Version ${s.version} · review by ${fmtDate(s.nextReviewAt)}${s.draft ? ' · changes waiting' : ''}`;
    return `<li><button type="button" class="sop-row sop-${escapeHtml(st)}" data-id="${escapeHtml(s.id)}">
      <span class="sop-row-code">${escapeHtml(s.code)}</span>
      <span class="sop-row-title">${escapeHtml(title || 'Untitled')}</span>
      <span class="sop-row-meta"><span class="sop-pill sop-pill-${escapeHtml(st)}">${escapeHtml(STATE_TEXT[st])}</span> ${escapeHtml(meta)}</span>
    </button></li>`;
  }

  async function renderList() {
    const sops = await DB.getSops();
    const q = String(el('sops-search').value || '').trim().toLowerCase();
    const match = (s) => !q || [s.code, s.title, s.category, s.owner, s.draft && s.draft.title]
      .some((v) => String(v || '').toLowerCase().includes(q));
    const shown = sops.filter(match);
    const sum = S.summarise(sops);
    el('sops-subtitle').textContent = sops.length
      ? `${sum.approved} approved${sum.overdue ? ` · ${sum.overdue} overdue` : ''}${sum.drafts ? ` · ${sum.drafts} draft${sum.drafts === 1 ? '' : 's'}` : ''}`
      : 'None yet';
    const attention = shown.filter((s) => S.needsAttention(s));
    const approved = shown.filter((s) => s.status === 'approved' && !S.needsAttention(s));
    const retired = shown.filter((s) => s.status === 'retired');
    const group = (title, items, extra) => (items.length
      ? `<h2 class="business-heading">${escapeHtml(title)}</h2><ul class="sop-list${extra || ''}">${items.map(rowHtml).join('')}</ul>` : '');
    el('sops-lists').innerHTML = (shown.length
      ? group('Needs attention', attention) + group('Approved', approved) + group('Retired', retired, ' sop-list-retired')
      : `<p class="empty-hint">${q ? 'Nothing matches that.' : 'No procedures yet. Add the starter drafts below, or write your own.'}</p>`);
    for (const b of el('sops-lists').querySelectorAll('.sop-row')) b.addEventListener('click', () => openSop(b.dataset.id));
    const missing = (window.SopTemplates || []).filter((t) => !sops.some((s) => s.templateKey === t.key));
    el('sops-starters').classList.toggle('hidden', !missing.length);
    el('sops-starters-btn').textContent = sops.length
      ? `Add ${missing.length} starter draft${missing.length === 1 ? '' : 's'}` : `Add ${missing.length} starter drafts`;
  }

  async function open() {
    showOnly(listView);
    await renderList();
  }

  async function addStarters() {
    const sops = await DB.getSops();
    const missing = (window.SopTemplates || []).filter((t) => !sops.some((s) => s.templateKey === t.key));
    if (!missing.length) return 0;
    const ok = await askConfirm(
      `${missing.length} draft procedures, written from how Scope already works. They are a starting point: `
      + 'read each one, change what does not match how you actually work, then approve it. Nothing counts until it is approved.',
      { title: 'Add starter drafts?', okLabel: 'Add them' },
    );
    if (!ok) return 0;
    const all = sops.slice();
    for (const t of missing) {
      const s = { ...S.newSop({ code: S.nextCode(all), title: t.title, category: t.category, owner: actorName(), body: t.body, actor: actorName() }), templateKey: t.key };
      all.push(s);
      await DB.saveSop(s);
    }
    toast(`${missing.length} starter drafts added`);
    await renderList();
    return missing.length;
  }

  // ---------- one SOP ----------
  async function openSop(id) {
    current = await DB.getSop(id);
    if (!current) { toast('That SOP is no longer here.'); return open(); }
    renderSop();
    showOnly(sopView);
  }

  function renderSop() {
    const s = current;
    const st = S.reviewState(s);
    const w = S.working(s);
    const approvedText = s.status !== 'draft';
    el('sop-code').textContent = s.code;
    el('sop-state').textContent = STATE_TEXT[st];
    el('sop-title').textContent = (approvedText ? s.title : w.title) || 'Untitled';

    const rows = [];
    if (s.status === 'approved' || s.status === 'retired') {
      rows.push(['Version', `${s.version}, approved ${fmtDate(s.approvedAt)}${s.approvedBy ? ` by ${s.approvedBy}` : ''}`]);
      if (s.status === 'approved') rows.push(['Next review', `${fmtDate(s.nextReviewAt)}${st === 'overdue' ? ' (overdue)' : ''}`]);
      if (s.lastReviewedAt && s.lastReviewedAt !== s.approvedAt) rows.push(['Last reviewed', `${fmtDate(s.lastReviewedAt)}${s.lastReviewedBy ? ` by ${s.lastReviewedBy}` : ''}`]);
    } else {
      rows.push(['Version', 'Draft, not yet approved']);
    }
    rows.push(['Owner', (approvedText ? s.owner : w.owner) || 'Not set']);
    rows.push(['Category', (approvedText ? s.category : w.category) || 'Other']);
    rows.push(['Review every', `${(approvedText ? s.reviewIntervalMonths : w.reviewIntervalMonths) || 12} months`]);
    if (s.status === 'retired') rows.push(['Retired', `${fmtDate(s.retiredAt)}${s.retiredReason ? `: ${s.retiredReason}` : ''}`]);
    el('sop-meta').innerHTML = rows.map(([k, v]) => `<div class="row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');

    const pending = s.status === 'approved' && s.draft;
    el('sop-draft-banner').classList.toggle('hidden', !pending);
    if (pending) {
      el('sop-draft-banner').textContent = `Changes are waiting for approval${s.draft.changeNote ? `: ${s.draft.changeNote}` : ''}. `
        + `Version ${s.version} below stays in force until they are approved.`;
    }
    el('sop-body').innerHTML = renderBody(approvedText ? s.body : w.body)
      || '<p class="empty-hint">Nothing written yet. Tap Edit.</p>';

    const admin = canApprove();
    const show = (id, on) => el(id).classList.toggle('hidden', !on);
    show('sop-edit-btn', s.status !== 'retired');
    el('sop-edit-btn').textContent = s.draft ? 'Edit the draft' : (s.status === 'approved' ? 'Revise' : 'Edit');
    show('sop-approve-btn', !!s.draft && s.status !== 'retired' && admin);
    el('sop-approve-btn').textContent = `Approve as version ${(s.version || 0) + 1}`;
    show('sop-discard-btn', !!pending);
    show('sop-reviewed-btn', s.status === 'approved' && !s.draft && admin);
    const me = { name: actorName(), email: (signedInUser() || {}).email || '' };
    const signed = s.status === 'approved' && S.hasSigned(s, me);
    show('sop-sign-btn', s.status === 'approved' && !signed);
    show('sop-print-btn', s.status === 'approved');
    show('sop-retire-btn', s.status === 'approved' && admin);
    show('sop-admin-note', !admin && !!s.draft);

    const signedList = S.signedCurrent(s);
    el('sop-signed-title').textContent = s.status === 'approved'
      ? `Read and signed for version ${s.version} (${signedList.length})` : 'Read and signed';
    el('sop-signed').innerHTML = s.status !== 'approved'
      ? '<li class="empty-hint">Signatures start once a version is approved.</li>'
      : (signedList.length
        ? signedList.map((a) => `<li>${escapeHtml(a.name || a.email)} <span class="sop-when">${escapeHtml(fmtDate(a.at))}</span></li>`).join('')
        : '<li class="empty-hint">Nobody has signed for this version yet.</li>');

    const hist = (s.history || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    el('sop-history').innerHTML = hist.length
      ? hist.map((h) => {
        const what = h.kind === 'approved' ? `Version ${h.version} approved`
          : h.kind === 'reviewed' ? `Reviewed (version ${h.version})` : `Retired (version ${h.version})`;
        const note = h.kind === 'approved' ? h.changeNote : h.note;
        const view = h.kind === 'approved' && h.version !== s.version
          ? ` <button type="button" class="link-btn sop-old" data-hid="${escapeHtml(h.id)}">Read it</button>` : '';
        return `<li><strong>${escapeHtml(what)}</strong> <span class="sop-when">${escapeHtml(fmtDate(h.at))}${h.by ? ` · ${escapeHtml(h.by)}` : ''}</span>`
          + `${note ? `<br><span class="sop-note">${escapeHtml(note)}</span>` : ''}${view}</li>`;
      }).join('')
      : '<li class="empty-hint">Nothing yet.</li>';
    for (const b of el('sop-history').querySelectorAll('.sop-old')) {
      b.addEventListener('click', () => {
        const h = (current.history || []).find((x) => x.id === b.dataset.hid);
        if (h) printSop({ ...current, title: h.title, body: h.body, version: h.version, approvedAt: h.at, approvedBy: h.by }, { superseded: true });
      });
    }
  }

  async function saveCurrent(next, message) {
    current = await DB.saveSop(next);
    renderSop();
    if (message) toast(message);
  }

  async function approveCurrent() {
    const problem = S.approvalProblem(current);
    if (problem) { toast(problem); return; }
    const who = await needName('approved it');
    if (!who) return;
    const v = (current.version || 0) + 1;
    const ok = await askConfirm(
      `${current.code}: ${current.draft.title}\n\nVersion ${v} becomes the procedure everyone works to, approved by ${who} today.`
      + (current.version ? ` Version ${current.version} is kept in the history.` : ''),
      { title: `Approve version ${v}?`, okLabel: 'Approve' },
    );
    if (!ok) return;
    const { sop, problem: p } = S.approve(current, { actor: who });
    if (p) { toast(p); return; }
    await saveCurrent(sop, `Version ${v} approved`);
  }

  async function reviewedCurrent() {
    const who = await needName('reviewed it');
    if (!who) return;
    const note = await askPrompt(
      `Reviewed ${current.code} and nothing needs to change? The next review is set ${current.reviewIntervalMonths || 12} months from today.`,
      'Reviewed. No changes needed.',
      { title: 'Record a review', okLabel: 'Record it' },
    );
    if (note === null || note === undefined) return;
    await saveCurrent(S.markReviewed(current, { actor: who, note }), 'Review recorded');
  }

  async function signCurrent() {
    const user = signedInUser();
    const name = await needName('read it');
    if (!name) return;
    const ok = await askConfirm(`I have read and understood ${current.code} ${current.title}, version ${current.version}.`,
      { title: 'Sign as read?', okLabel: 'Sign' });
    if (!ok) return;
    await saveCurrent(S.acknowledge(current, { name, email: user ? user.email : '' }), 'Signed');
  }

  async function retireCurrent() {
    const who = await needName('retired it');
    if (!who) return;
    const reason = await askPrompt(`${current.code} stops being a procedure anyone works to. It stays in the library, marked retired, with its history.`,
      '', { title: 'Retire this SOP?', okLabel: 'Retire', placeholder: 'Why? e.g. replaced by SOP-009' });
    if (reason === null || reason === undefined) return;
    await saveCurrent(S.retire(current, { actor: who, reason }), 'Retired');
  }

  async function discardCurrent() {
    const ok = await askConfirm(`The waiting changes are thrown away. Version ${current.version} stays as it is.`,
      { title: 'Discard the draft?', okLabel: 'Discard', danger: true });
    if (!ok) return;
    await saveCurrent(S.discardDraft(current), 'Draft discarded');
  }

  // ---------- printing ----------
  const PRINT_STYLE = `body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#10161a;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.5}
    .hd{border-bottom:2px solid #10161a;padding-bottom:8px;margin-bottom:16px}.hd h1{margin:4px 0;font-size:22px}
    .muted{color:#555;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}
    .ft{margin-top:24px;border-top:1px solid #ccc;padding-top:8px;font-size:12px;color:#555}.warn{color:#a00;font-weight:600}
    @media print{.no-print{display:none}}`;

  function openPrint(title, html) {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLE}</style></head><body>
      <p><button class="no-print" onclick="window.print()">Print / Save as PDF</button></p>${html}</body></html>`);
    w.document.close();
  }

  function printSop(s, { superseded } = {}) {
    const biz = window.Org && window.Org.businessName ? window.Org.businessName() : '';
    openPrint(`${s.code} v${s.version}`, `
      <div class="hd"><div class="muted">${escapeHtml(biz)} · Standard operating procedure</div>
        <h1>${escapeHtml(s.code)} ${escapeHtml(s.title)}</h1>
        <div class="muted">Version ${s.version} · approved ${escapeHtml(fmtDate(s.approvedAt))}${s.approvedBy ? ` by ${escapeHtml(s.approvedBy)}` : ''}
        ${s.owner ? ` · owner ${escapeHtml(s.owner)}` : ''}${s.nextReviewAt && !superseded ? ` · next review ${escapeHtml(fmtDate(s.nextReviewAt))}` : ''}</div>
        ${superseded ? '<p class="warn">SUPERSEDED: this version is no longer in force.</p>' : ''}</div>
      ${renderBody(s.body)}
      <div class="ft">Printed ${escapeHtml(fmtDate(Date.now()))}. Printed copies are uncontrolled: the SOP library in Scope holds the current version.</div>`);
  }

  async function printRegister() {
    const sops = await DB.getSops();
    const biz = window.Org && window.Org.businessName ? window.Org.businessName() : '';
    const rows = sops.map((s) => {
      const w = S.working(s);
      const signed = S.signedCurrent(s).map((a) => `${escapeHtml(a.name || a.email)} (${escapeHtml(fmtDate(a.at))})`).join(', ');
      return `<tr><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.status === 'draft' ? w.title : s.title)}</td>
        <td>${escapeHtml(STATE_TEXT[S.reviewState(s)])}</td><td>${s.version || '-'}</td>
        <td>${escapeHtml(fmtDate(s.approvedAt))}${s.approvedBy ? `<br>${escapeHtml(s.approvedBy)}` : ''}</td>
        <td>${escapeHtml(fmtDate(s.nextReviewAt))}</td><td>${escapeHtml(s.owner || w.owner || '')}</td><td>${signed || '-'}</td></tr>`;
    }).join('');
    openPrint('SOP register', `
      <div class="hd"><div class="muted">${escapeHtml(biz)}</div><h1>Register of standard operating procedures</h1>
        <div class="muted">As at ${escapeHtml(fmtDate(Date.now()))} · ${sops.length} procedures</div></div>
      <table><thead><tr><th>Code</th><th>Title</th><th>Status</th><th>Version</th><th>Approved</th><th>Next review</th><th>Owner</th><th>Signed for this version</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8">None</td></tr>'}</tbody></table>`);
  }

  // ---------- editing ----------
  function openEditor() {
    const w = S.working(current);
    el('sop-edit-heading').textContent = `${current.code}${current.status === 'approved' ? ` · revising version ${current.version}` : ''}`;
    el('sop-edit-title').value = w.title || '';
    el('sop-edit-category').innerHTML = S.CATEGORIES.map((c) => `<option${c === w.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    el('sop-edit-owner').value = w.owner || '';
    el('sop-edit-review').value = String(w.reviewIntervalMonths || 12);
    el('sop-edit-body').value = w.body || '';
    el('sop-edit-note').value = current.draft && current.version > 0 ? (current.draft.changeNote || '') : '';
    el('sop-edit-note-row').classList.toggle('hidden', !(current.version > 0));
    showOnly(editView);
  }

  async function saveEditor() {
    if (unsaved && !String(el('sop-edit-title').value).trim()) { toast('Give it a title first.'); return; }
    const next = S.edit(current, {
      title: el('sop-edit-title').value,
      category: el('sop-edit-category').value,
      owner: el('sop-edit-owner').value,
      reviewIntervalMonths: Number(el('sop-edit-review').value),
      body: el('sop-edit-body').value,
      ...(current.version > 0 ? { changeNote: el('sop-edit-note').value } : {}),
    }, { actor: actorName() });
    current = await DB.saveSop(next);
    unsaved = false;
    renderSop();
    showOnly(sopView);
    toast(current.status === 'approved' ? 'Draft saved. Version ' + current.version + ' stays in force until it is approved.' : 'Draft saved');
  }

  async function newSop() {
    const sops = await DB.getSops();
    // Not saved until Save: a cancelled new SOP must not sit in the library
    // forever as "Untitled", since nothing in it can be deleted.
    current = S.newSop({ code: S.nextCode(sops), title: '', owner: actorName(), actor: actorName() });
    unsaved = true;
    openEditor();
  }

  // ---------- wiring ----------
  el('sops-back-btn').addEventListener('click', () => { if (window.showJobListView) window.showJobListView(); });
  el('sops-search').addEventListener('input', renderList);
  el('sops-starters-btn').addEventListener('click', addStarters);
  el('sops-print-btn').addEventListener('click', printRegister);
  el('sop-new-btn').addEventListener('click', newSop);
  el('sop-back-btn').addEventListener('click', open);
  el('sop-edit-btn').addEventListener('click', openEditor);
  el('sop-approve-btn').addEventListener('click', approveCurrent);
  el('sop-discard-btn').addEventListener('click', discardCurrent);
  el('sop-reviewed-btn').addEventListener('click', reviewedCurrent);
  el('sop-sign-btn').addEventListener('click', signCurrent);
  el('sop-print-btn').addEventListener('click', () => printSop(current));
  el('sop-retire-btn').addEventListener('click', retireCurrent);
  // Back from the editor (the arrow, or the phone's own Back). Anything typed
  // and not saved is asked about rather than dropped.
  function editorChanged() {
    const w = S.working(current);
    return el('sop-edit-title').value !== (w.title || '')
      || el('sop-edit-body').value !== (w.body || '')
      || el('sop-edit-owner').value !== (w.owner || '');
  }
  el('sop-edit-back-btn').addEventListener('click', async () => {
    if (editorChanged()) {
      const ok = await askConfirm('What you typed here has not been saved.', { title: 'Leave without saving?', okLabel: 'Leave', danger: true });
      if (!ok) return;
    }
    if (unsaved) { unsaved = false; current = null; open(); return; }
    renderSop();
    showOnly(sopView);
  });
  el('sop-edit-save').addEventListener('click', saveEditor);
  const openBtn = el('open-sops-btn');
  if (openBtn) openBtn.addEventListener('click', open);

  window.SopsUI = { open, openSop, renderBody, addStarters };
})();
