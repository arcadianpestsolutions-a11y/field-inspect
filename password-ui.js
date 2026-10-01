// Choosing a password, for somebody who arrived from an emailed link.
//
// An invitation or a reset link signs the person in, but with no password of
// their own. Without this screen the app carried on as though everything were
// fine, and the next time they opened it — a new phone, a cleared browser, a
// logout — they could not get back in. This is the step that makes an
// emailed invitation a complete way of adding somebody.
//
// The password is set through Supabase's own updateUser on the session the
// link created; nothing here sees or stores it beyond passing it on.
(() => {
  'use strict';

  const view = document.getElementById('view-password');
  if (!view) return;

  const el = (id) => document.getElementById(id);
  const newEl = el('password-new');
  const confirmEl = el('password-confirm');
  const saveBtn = el('password-save-btn');
  const errorEl = el('password-error');

  // Matches what the invite-user function asks of a temporary password. A
  // password protects an account that can read every client's details, so the
  // floor is not the six characters Supabase would accept.
  const MIN_LENGTH = 10;

  // Returns { ok: true } or { ok: false, error } in words to show as they are.
  function validate(password, confirmation) {
    if (!password) return { ok: false, error: 'Choose a password.' };
    if (password.length < MIN_LENGTH) {
      return { ok: false, error: `Use at least ${MIN_LENGTH} characters.` };
    }
    if (password !== confirmation) return { ok: false, error: 'The two passwords do not match.' };
    return { ok: true };
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  // Shown over whatever else is on screen. Left alone if already showing, so a
  // token refresh in the background does not wipe a half-typed password.
  function show() {
    if (!view.classList.contains('hidden')) return;
    if (window.hideAllAppViews) window.hideAllAppViews();
    newEl.value = '';
    confirmEl.value = '';
    errorEl.classList.add('hidden');
    view.classList.remove('hidden');
  }

  async function save() {
    errorEl.classList.add('hidden');
    const checked = validate(newEl.value, confirmEl.value);
    if (!checked.ok) { showError(checked.error); return; }
    if (!window.Sync || !Sync.setPassword) { showError('Not connected to the server.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await Sync.setPassword(newEl.value);
      newEl.value = '';
      confirmEl.value = '';
      view.classList.add('hidden');
      if (window.showJobListView) window.showJobListView();
      if (window.appToast) window.appToast('Password saved.');
    } catch (err) {
      showError((err && err.message) || 'Could not save the password.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save password';
    }
  }

  saveBtn.addEventListener('click', save);
  confirmEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });

  window.PasswordUI = { show, validate, MIN_LENGTH };
})();
