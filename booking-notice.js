// Booking notice (v149) — "Send client booking details?"
//
// WHY THIS EXISTS
// A booking used to email the client the moment a new job was saved with a
// time, and a job booked from the diary emailed nobody at all. Tal's rule
// (16 Nov 2026): never email a client straight away, because part of the job
// may have been entered wrongly, and never let the email be forgotten either.
//
// So every booking asks one question with three answers:
//   Yes, send it          the confirmation goes now
//   Not yet               nothing goes; the job keeps saying so until it does
//   Let me change details opens the job's details to fix first
//
// "Not forgotten" does not depend on the question being answered. A job with
// a time ahead whose confirmation has not gone for THAT time (the server
// stamps confirmationSentForAt with the appointment it wrote about) shows a
// reminder on the job and a mark in the diary, however it came to be booked:
// the diary, the assistant, a rebooking, or a changed time.
//
// This file sends nothing. Sending is app.js confirmBookingByEmail, which
// hands a job id to the server (comms.js); the server holds the address and
// decides whether the client may be emailed at all.
//
// EXPOSES: window.BookingNotice = { needsSending, summaryLines, ask, offer,
//          renderReminder }
(() => {
  'use strict';

  const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function hasEmail(job) {
    return !!(job && EMAIL_SHAPE.test(String(job.clientEmail || '').trim()));
  }

  // Whether this job has an appointment ahead that the client has not been
  // sent. A client who turned automated messages off is never chased.
  function needsSending(job, now) {
    if (!job || !job.scheduledAt) return false;
    if (job.status === 'completed' || job.commsOptOut) return false;
    if (job.scheduledAt <= (typeof now === 'number' ? now : Date.now())) return false;
    return job.confirmationSentForAt !== job.scheduledAt;
  }

  function fmtWhen(ts) {
    const d = new Date(ts);
    const day = d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    return `${day} at ${time}`;
  }

  // What the technician checks before saying yes: exactly the facts the
  // client is about to be told, and where they are going.
  function summaryLines(job) {
    return [
      ['Client', job.name || 'No name'],
      ['Email', hasEmail(job) ? String(job.clientEmail).trim() : 'No email address on this job'],
      ['When', job.scheduledAt ? fmtWhen(job.scheduledAt) : 'No time booked'],
      ['Where', job.address || 'No address on this job'],
    ];
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // The question. Resolves 'send', 'later' or 'edit'. Own DOM, like
  // dialog.js, so it works whichever index.html the device has cached.
  function ask(job) {
    return new Promise((resolve) => {
      const overlay = el('div', 'modal app-dialog booking-notice');
      const card = el('div', 'app-dialog-card');
      overlay.appendChild(card);
      const canSend = hasEmail(job);
      card.appendChild(el('h2', 'app-dialog-title', canSend ? 'Send client booking details?' : 'No email address for this client'));
      card.appendChild(el('p', 'app-dialog-message', canSend
        ? 'Check these are right first. This is what the client will be told.'
        : 'The booking is saved, but there is nowhere to send the details. Add the client’s email, or leave it for now.'));
      const list = el('dl', 'booking-notice-facts');
      for (const [label, value] of summaryLines(job)) {
        list.appendChild(el('dt', null, label));
        list.appendChild(el('dd', null, value));
      }
      card.appendChild(list);

      const row = el('div', 'booking-notice-actions');
      const done = (choice) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(choice);
      };
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done('later'); } }
      const add = (label, cls, choice) => {
        const b = el('button', cls, label);
        b.type = 'button';
        b.dataset.choice = choice;
        b.addEventListener('click', () => done(choice));
        row.appendChild(b);
        return b;
      };
      let first;
      if (canSend) {
        // The safe answer is the big one, first and focused (v163): in the
        // usability test a thumb-slip after dragging a booking would have
        // emailed the client. Sending is one deliberate tap away, and the
        // job keeps reminding until it is done, so nothing is forgotten.
        first = add('Not yet', 'btn btn-primary full', 'later');
        add('Let me change the details', 'btn btn-outline full', 'edit');
        add('Yes, send it to the client', 'btn btn-outline full booking-send', 'send');
      } else {
        first = add('Add the email', 'btn btn-primary full', 'edit');
        add('Not now', 'btn btn-outline full', 'later');
      }
      card.appendChild(row);
      // Tapping outside is "not yet": the safe answer, and it leaves the reminder.
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done('later'); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      try { first.focus(); } catch (e) { /* focus is a nicety */ }
    });
  }

  function say(text) {
    if (window.Common && window.Common.toast) window.Common.toast(text);
  }

  // Ask, then do what was answered. `deps` exists so the suite can watch
  // what would be sent without anything being able to reach a client.
  async function offer(job, opts) {
    const o = opts || {};
    if (!job || !job.scheduledAt) return 'none';
    if (job.commsOptOut) return 'none';
    // Back-filling a day that has been: nobody needs telling.
    if (job.scheduledAt <= Date.now()) return 'none';
    // The suite books hundreds of jobs; only a test that hands in its own
    // `send` is asking to see the question.
    if (window.IS_TEST && !o.send) return 'none';
    const send = o.send || window.confirmBookingByEmail;
    const openJob = o.openJob || window.showJobViewById;
    const choice = await ask(job);
    if (choice === 'send') {
      if (typeof send !== 'function') { say('Not sent: this copy of Scope cannot send email.'); return choice; }
      await send(job, { agreement: !!o.agreement });
    } else if (choice === 'edit') {
      if (typeof openJob === 'function') await openJob(job.id);
      const editBtn = document.getElementById('job-details-edit-btn');
      if (editBtn) editBtn.click();
      say('Nothing sent. Fix the details, then tap “Send booking details” on the job.');
    } else {
      say('Nothing sent to the client. The job will keep reminding you until it is.');
    }
    return choice;
  }

  // The reminder on the job screen: there until the confirmation has gone
  // for the time now booked.
  function renderReminder(job, opts) {
    const o = opts || {};
    const existing = document.getElementById('booking-notice-row');
    if (existing) existing.remove();
    if (!needsSending(job, o.now)) return null;
    const anchor = o.anchor || document.getElementById('job-comms-row') || document.getElementById('job-subtitle');
    if (!anchor || !anchor.parentNode) return null;
    const row = el('div', 'booking-notice-row');
    row.id = 'booking-notice-row';
    row.appendChild(el('span', 'booking-notice-text', hasEmail(job)
      ? 'Booking details have not been sent to the client.'
      : 'Booking details not sent: no client email on this job.'));
    const b = el('button', 'btn btn-outline booking-notice-send', hasEmail(job) ? 'Send booking details' : 'Add the email');
    b.type = 'button';
    b.disabled = o.canEdit === false;
    b.addEventListener('click', async () => {
      await offer(job, o);
      if (typeof o.after === 'function') o.after();
    });
    row.appendChild(b);
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
    return row;
  }

  window.BookingNotice = { needsSending, summaryLines, ask, offer, renderReminder };
})();
