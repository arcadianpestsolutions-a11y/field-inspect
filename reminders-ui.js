// Tomorrow's reminders — the panel that shows what each client is about to
// be sent, before it is sent.
//
// The sweep has existed for a while and was only reachable by calling the
// Edge Function by hand with a JSON body. That is not a reasonable way to
// find out what your business is saying to your customers, so nobody ever
// looked, and the reminders never went out at all.
//
// Two things are on screen here, and the second one matters as much as the
// first. The messages that WILL go, word for word — a reminder is written
// once and read by every client, so it is worth reading yourself. And the
// clients who will get NOTHING, because the number on file is a landline, a
// typo or missing. Reminders are one-way: nobody replies, nobody confirms,
// so that second list is the only part that needs a human, and an empty
// screen would have hidden it completely.
//
// Split from comms.js for the same reason invoice-ui.js is split from
// invoicing.js: the service has to keep working in test and demo mode where
// this markup does not exist.
(() => {
  'use strict';

  const panel = document.getElementById('reminders-panel');
  const openBtn = document.getElementById('reminders-open');
  if (!panel || !openBtn) return; // markup not present — nothing to wire up

  const closeBtn = document.getElementById('reminders-close');
  const hintEl = document.getElementById('reminders-hint');
  const listEl = document.getElementById('reminders-list');
  const checkBtn = document.getElementById('reminders-check');
  const sendBtn = document.getElementById('reminders-send');

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog
    ? window.Dialog.confirm(msg, opts)
    : Promise.resolve(window.confirm(msg)));

  // What was last previewed. "Send these now" only appears once this holds
  // something, so the live send can never be the first button pressed.
  let previewed = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear() {
    listEl.innerHTML = '';
  }

  // Plain words for the reasons the server gives back. comms.js already has
  // the full sentences for a single send; these are the short version that
  // fits at the end of a row in a list.
  const WHY = {
    'no-phone-on-file': 'no mobile on file',
    'phone-not-valid': 'number looks wrong',
    'landline-not-mobile': 'landline, cannot text',
    'no-email-on-file': 'no email on file',
    'email-not-valid': 'email looks wrong',
    'opted-out': 'asked not to be contacted',
    'nothing-to-send-about': 'no appointment time',
    'job-not-found': 'not synced yet',
  };

  function renderPreview(result) {
    clear();
    const going = result.wouldSend || [];
    const missing = result.needsAPhoneCall || [];

    if (!going.length && !missing.length) {
      hintEl.textContent = result.checked
        ? 'Everyone booked for tomorrow has already had their reminder.'
        : 'Nothing is booked for tomorrow, so there is nothing to send.';
      sendBtn.classList.add('hidden');
      previewed = null;
      return;
    }

    if (going.length) {
      const head = el('p', 'reminders-section-head',
        going.length === 1 ? '1 reminder ready to send' : `${going.length} reminders ready to send`);
      listEl.appendChild(head);

      for (const row of going) {
        const card = el('div', 'reminders-row');
        const top = el('div', 'reminders-row-head');
        top.appendChild(el('span', 'agenda-name', row.name || 'Client'));
        top.appendChild(el('span', 'agenda-meta', row.to || ''));
        card.appendChild(top);
        // The exact words. Not a summary of them.
        card.appendChild(el('p', 'reminders-text', row.text || '(sent by email)'));
        if (row.segments) {
          card.appendChild(el('span', 'agenda-meta',
            row.segments === 1 ? '1 message' : `${row.segments} message parts`));
        }
        listEl.appendChild(card);
      }
    }

    if (missing.length) {
      listEl.appendChild(el('p', 'reminders-section-head',
        missing.length === 1 ? '1 client you will need to ring' : `${missing.length} clients you will need to ring`));
      for (const row of missing) {
        const card = el('div', 'reminders-row reminders-row-warn');
        const top = el('div', 'reminders-row-head');
        top.appendChild(el('span', 'agenda-name', row.name || 'Client'));
        top.appendChild(el('span', 'agenda-meta', row.phone || 'no number'));
        card.appendChild(top);
        card.appendChild(el('span', 'agenda-meta', WHY[row.reason] || row.reason || 'cannot be reached'));
        listEl.appendChild(card);
      }
    }

    const totalParts = going.reduce((sum, r) => sum + (r.segments || 0), 0);
    hintEl.textContent = going.length
      ? (result.channel === 'sms'
        ? `These go out as text messages${totalParts ? ` (${totalParts} parts)` : ''}. Read them first.`
        : 'These go out by email. Read them first.')
      : 'Nothing can be sent automatically — the list below needs a phone call.';

    previewed = going.length ? result : null;
    sendBtn.classList.toggle('hidden', !going.length);
  }

  async function check() {
    if (!window.CommsService) {
      hintEl.textContent = 'Sign in to check reminders.';
      return;
    }
    checkBtn.disabled = true;
    sendBtn.classList.add('hidden');
    hintEl.textContent = 'Checking…';
    clear();
    try {
      const result = await window.CommsService.previewSweep('day_before');
      if (!result.ok) {
        hintEl.textContent = result.message || 'Could not check tomorrow’s reminders.';
        return;
      }
      renderPreview(result);
    } finally {
      checkBtn.disabled = false;
    }
  }

  async function sendNow() {
    if (!previewed) return;
    const count = (previewed.wouldSend || []).length;
    // Names the number, because "send these now" on its own does not tell
    // you how many real people are about to get a text.
    const ok = await askConfirm(
      `${count === 1 ? 'One client' : `${count} clients`} will be sent the message you just read. `
      + 'This cannot be taken back.',
      { title: count === 1 ? 'Send 1 reminder?' : `Send ${count} reminders?`, okLabel: 'Send them' }
    );
    if (!ok) return;

    sendBtn.disabled = true;
    hintEl.textContent = 'Sending…';
    try {
      const result = await window.CommsService.sendSweep('day_before');
      if (!result.ok) {
        hintEl.textContent = result.message || 'Could not send.';
        return;
      }
      const failed = (result.failed || []).length;
      toast(failed
        ? `${result.sent} sent, ${failed} could not be sent`
        : `${result.sent} reminder${result.sent === 1 ? '' : 's'} sent`);
      previewed = null;
      sendBtn.classList.add('hidden');
      // The job-list banner is worked out from jobs on this phone, whose "sent"
      // stamps only catch up at the next sync. Telling it now stops it saying
      // "haven't been sent" to somebody who has just sent them.
      // Only when every one went: if some failed, "haven't been sent" is still true.
      if (!failed && window.ReminderNudge) window.ReminderNudge.dismissToday();
      // Re-read rather than assume: the dedupe stamp has moved, so a second
      // check should now show an empty list, and seeing that is the proof.
      await check();
    } finally {
      sendBtn.disabled = false;
    }
  }

  // ---- Replies -------------------------------------------------------------
  // Texts that came BACK. Reminders are one-way by design, but people reply
  // anyway — "can we move it to 11?", "I'm not home tomorrow" — and for as long
  // as the replies landed in the SMS provider's dashboard, nobody in the
  // business saw them. They land here now, unread first.
  //
  // Everything in this section is guarded: no signal, a table that has not been
  // created yet (migration 032) or test mode all leave the panel exactly as it
  // was, and nothing here may throw into the reminders preview below it.
  const repliesEl = document.getElementById('reminders-replies');
  const phoneTail = (raw) => String(raw || '').replace(/\D/g, '').slice(-9);

  function canReadReplies() {
    return !!(repliesEl && window.supabaseClient && !window.IS_TEST && !window.IS_DEMO);
  }

  async function fetchUnread() {
    if (!canReadReplies()) return [];
    try {
      const { data, error } = await window.supabaseClient.from('sms_inbound')
        .select('id, from_e164, from_raw, body, kind, job_id, received_at')
        .is('read_at', null)
        .order('received_at', { ascending: false })
        .limit(30);
      return error ? [] : (data || []);
    } catch (e) { return []; }
  }

  // Who the number belongs to, from the jobs already on this device — the
  // sender's number is all a text carries, and a name is what a person acts on.
  async function nameFor(msg, jobs) {
    const byId = msg.job_id ? jobs.find((j) => j.id === msg.job_id) : null;
    if (byId && byId.name) return byId.name;
    const tail = phoneTail(msg.from_e164 || msg.from_raw);
    if (tail.length < 9) return '';
    const hit = jobs.find((j) => phoneTail(j.clientPhone) === tail && j.name);
    return hit ? hit.name : '';
  }

  function setBadge(count) {
    openBtn.classList.toggle('has-unread', count > 0);
    openBtn.title = count > 0
      ? `Tomorrow's reminders — ${count} unread ${count === 1 ? 'reply' : 'replies'}`
      : "Tomorrow's reminders";
  }

  async function markRead(id) {
    try {
      await window.supabaseClient.from('sms_inbound').update({ read_at: Date.now() }).eq('id', id);
    } catch (e) { /* the next refresh will show it again, which is the safe way to fail */ }
    await renderReplies();
  }

  async function renderReplies() {
    if (!repliesEl) return;
    repliesEl.innerHTML = '';
    const unread = await fetchUnread();
    setBadge(unread.length);
    if (!unread.length) return;

    let jobs = [];
    try { jobs = await DB.getJobs(); } catch (e) { /* names are a nicety */ }

    repliesEl.appendChild(el('p', 'reminders-section-head',
      unread.length === 1 ? '1 reply to read' : `${unread.length} replies to read`));

    for (const msg of unread) {
      const card = el('div', 'reminders-row');
      const top = el('div', 'reminders-row-head');
      const name = await nameFor(msg, jobs);
      top.appendChild(el('span', 'agenda-name', name || msg.from_raw || 'Unknown number'));
      top.appendChild(el('span', 'agenda-meta', new Date(msg.received_at).toLocaleString('en-AU', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      })));
      card.appendChild(top);
      card.appendChild(el('p', 'reminders-text', msg.body || '(empty message)'));
      if (msg.kind === 'stop') {
        // The one thing worth saying out loud: it has already been acted on.
        card.appendChild(el('p', 'reminders-stop-note',
          'Asked us to stop. No more automated messages will go to this number.'));
      }
      const done = el('button', 'btn btn-outline', 'Mark as read');
      done.type = 'button';
      done.addEventListener('click', () => markRead(msg.id));
      card.appendChild(done);
      repliesEl.appendChild(card);
    }
  }

  function openPanel() {
    // Three panels share this one corner of the scheduler. Opening one has
    // to close the others, or they stack on top of each other.
    const others = ['agent-panel', 'calendar-feed-panel'];
    for (const id of others) {
      const other = document.getElementById(id);
      if (other) other.classList.add('hidden');
    }
    panel.classList.remove('hidden');
    hintEl.textContent = 'See exactly what each client gets before anything is sent.';
    clear();
    sendBtn.classList.add('hidden');
    previewed = null;
    renderReplies();
  }

  // The badge on the bell is the only way anybody finds out a reply arrived
  // without opening the panel, so it is checked on load and every time the app
  // comes back to the foreground — which is when a technician is likely to look.
  // Delayed on load: it needs a signed-in session, and that is not ready yet.
  if (canReadReplies()) {
    setTimeout(() => { renderReplies(); }, 6000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') renderReplies();
    });
  }

  openBtn.addEventListener('click', openPanel);
  if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  checkBtn.addEventListener('click', check);
  sendBtn.addEventListener('click', sendNow);

  // Exposed for the suite, same reasoning as window.SyncMessages: the wording
  // a technician reads is worth asserting on directly.
  window.RemindersUI = { check, renderPreview, renderReplies, WHY };
})();
