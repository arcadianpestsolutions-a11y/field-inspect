// The people who can sign in to this business: who they are, adding one,
// removing one.
//
// ADMIN ONLY, BUT THIS FILE IS NOT WHAT ENFORCES THAT. The button is hidden
// from technicians as a courtesy; the invite-user Edge Function refuses
// anyone who is not an admin of a business, reading the role from the
// database rather than from the request. Everything here that looks like a
// permission check is there so nobody is offered a button that will fail.
//
// Adding someone goes to invite-user, which attaches them to the CALLER's
// business — there is no field on this screen for choosing a business, and
// that is the point.
(() => {
  'use strict';

  const view = document.getElementById('view-team');
  if (!view) return;

  const el = (id) => document.getElementById(id);
  const listEl = el('team-list');
  const subtitleEl = el('team-subtitle');
  const emailEl = el('team-email');
  const nameEl = el('team-name');
  const roleEl = el('team-role');
  const passwordEl = el('team-password');
  const addBtn = el('team-add-btn');
  const errorEl = el('team-error');
  const backBtn = el('team-back-btn');
  const openBtn = el('open-team-btn');
  const moreBtn = el('open-more-btn');

  const escapeHtml = (s) => (window.FormRender ? window.FormRender.escapeHtml(s) : String(s == null ? '' : s));
  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));

  const ROLE_LABEL = { admin: 'Admin', technician: 'Technician' };

  // ---------- pure ----------

  // One person as a row. Name first because that is what people recognise,
  // the address underneath because it is what they sign in with.
  function memberRowHtml(member, meId) {
    const name = (member.display_name || '').trim();
    const isMe = !!meId && member.user_id === meId;
    const primary = name || member.email || 'Unnamed';
    const sub = [name ? member.email : '', ROLE_LABEL[member.role] || member.role, isMe ? 'you' : '']
      .filter(Boolean).join(' · ');
    return `
      <span class="section-icon" style="background:${member.role === 'admin' ? '#7a4d1f' : '#1f7a4d'}">${member.role === 'admin' ? '★' : '👤'}</span>
      <span class="section-info">
        <span class="section-name">${escapeHtml(primary)}</span>
        <span class="section-sub">${escapeHtml(sub)}</span>
      </span>
      ${isMe ? '' : `<button class="link-btn team-remove" data-user-id="${escapeHtml(member.user_id)}">Remove</button>`}`;
  }

  // What to tell the admin after the function answers. Each outcome means
  // something different they have to do next, so each says so.
  function describeResult(result, email) {
    const who = result && result.email ? result.email : email;
    switch (result && result.status) {
      case 'invited': return `Invitation emailed to ${who}.`;
      case 'created': return `${who} can sign in now. Give them the temporary password you chose.`;
      case 'updated': return `${who} was already on the team — their role and name are updated.`;
      default: return `${who} added.`;
    }
  }

  // ---------- server ----------

  // functions.invoke turns every non-2xx into a generic sentence and hands the
  // real answer over on error.context. Reading it is the difference between
  // "that email address cannot be added" and "Edge Function returned a
  // non-2xx status code". Same approach as email.js.
  async function failureFrom(error, fallback) {
    try {
      if (error && error.context && typeof error.context.json === 'function') {
        const body = await error.context.clone().json();
        if (body && body.error) return new Error(String(body.error));
      }
    } catch (e) { /* not JSON — fall through */ }
    return new Error((error && error.message) || fallback);
  }

  async function invoke(body) {
    const client = window.supabaseClient;
    if (!client) throw new Error('Not connected to the server.');
    const { data, error } = await client.functions.invoke('invite-user', { body });
    if (error) throw await failureFrom(error, 'Could not reach the server.');
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // The roster is readable by the signed-in user through the database's own
  // policy (migration 023), which scopes it to their business — so this needs
  // no function, and cannot show another business's people.
  async function loadMembers() {
    const client = window.supabaseClient;
    if (!client) throw new Error('Not connected to the server.');
    const { data, error } = await client
      .from('user_roles').select('user_id, email, role, display_name').order('email');
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------- screen ----------

  function meId() {
    return window.Sync && Sync.currentUserId ? Sync.currentUserId() : null;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function render(members) {
    subtitleEl.textContent = members.length
      ? `${members.length} ${members.length === 1 ? 'person' : 'people'}`
      : '';
    listEl.innerHTML = '';
    if (!members.length) {
      listEl.innerHTML = '<p class="empty-hint">Nobody to show yet.</p>';
      return;
    }
    const me = meId();
    for (const m of members) {
      const li = document.createElement('li');
      li.className = 'report-section-item';
      li.innerHTML = memberRowHtml(m, me);
      const removeBtn = li.querySelector('.team-remove');
      if (removeBtn) removeBtn.addEventListener('click', () => removeMember(m));
      listEl.appendChild(li);
    }
  }

  async function refresh() {
    try {
      render(await loadMembers());
    } catch (err) {
      listEl.innerHTML = `<p class="empty-hint">Could not load the team: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function removeMember(member) {
    const label = member.display_name || member.email || 'this person';
    const ok = await askConfirm(
      `Remove ${label}? They will be signed out of Scope and will no longer see any of this business's jobs, clients or reports.`,
      { okLabel: 'Remove', danger: true },
    );
    if (!ok) return;
    try {
      await invoke({ action: 'remove', userId: member.user_id });
      toast(`${label} removed.`);
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  async function addPerson() {
    errorEl.classList.add('hidden');
    const email = emailEl.value.trim();
    if (!email) { showError('Enter their email address.'); return; }

    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    try {
      const result = await invoke({
        action: 'invite',
        email,
        displayName: nameEl.value.trim(),
        role: roleEl.value,
        temporaryPassword: passwordEl.value || undefined,
      });
      toast(describeResult(result, email));
      emailEl.value = ''; nameEl.value = ''; passwordEl.value = ''; roleEl.value = 'technician';
      await refresh();
    } catch (err) {
      // The server's own sentence — it already says what is wrong with the
      // address, the role or the password.
      showError(err.message);
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = 'Add person';
    }
  }

  function canManageTeam() {
    return !!(window.Sync && Sync.isAdmin && Sync.isAdmin() && meId());
  }

  async function open() {
    if (!canManageTeam()) { toast('Only an admin can manage the team.'); return; }
    errorEl.classList.add('hidden');
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
    await refresh();
  }

  // The More sheet is static markup, so whether Team is offered is decided
  // each time it opens, when the role is known, rather than once at load.
  if (moreBtn && openBtn) {
    moreBtn.addEventListener('click', () => openBtn.classList.toggle('hidden', !canManageTeam()));
  }
  if (openBtn) openBtn.addEventListener('click', open);
  if (backBtn) backBtn.addEventListener('click', () => { if (window.showJobListView) window.showJobListView(); });
  addBtn.addEventListener('click', addPerson);

  window.TeamUI = { open, render, memberRowHtml, describeResult, canManageTeam };
})();
