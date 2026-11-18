// Changing a booking by tapping, not dragging (v163).
//
// The usability test found the only way to move a job or make it longer was
// to drag it in the diary: nothing on screen said so, the handles are thin,
// and the job screen (where people looked first) had no way at all. This
// adds a "Booked" card on the job screen with Change time, and a "How long"
// choice on the New Job form. Dragging in the diary still works.
//
// Asks before landing on another job (Scheduler.confirmNoOverlap), and asks
// before telling the client (BookingNotice), the same as every booking path.
//
// EXPOSES: window.BookingEdit = { render, pickTime, LENGTHS, lengthLabel, addLengthToNewJobForm, readNewJobLength }
(() => {
  'use strict';

  const LENGTHS = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480];
  const lengthLabel = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (!h) return `${m} min`;
    return `${h} hr${h === 1 ? '' : 's'}${m ? ` ${m} min` : ''}`;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtWhen = (ts) => new Date(ts).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function select(id, options, value) {
    const s = el('select', 'booking-edit-select');
    s.id = id;
    for (const [v, label] of options) {
      const o = el('option', '', label);
      o.value = String(v);
      if (String(v) === String(value)) o.selected = true;
      s.appendChild(o);
    }
    return s;
  }

  // ---- the card on the job screen ----
  function render(job, hooks) {
    const host = document.querySelector('#view-job .content');
    const old = document.getElementById('job-booking-card');
    if (old) old.remove();
    if (!host || !job || job.status === 'completed') return;
    const card = el('div', 'card job-booking-card');
    card.id = 'job-booking-card';
    const booked = typeof job.scheduledAt === 'number' && job.scheduledAt > 0;
    const mins = job.scheduledDurationMins || 60;
    const line = el('div', 'job-booking-line', booked
      ? `📅 ${fmtWhen(job.scheduledAt)} – ${fmtTime(job.scheduledAt + mins * 60000)} (${lengthLabel(mins)})`
      : '📅 Not booked yet');
    const b = el('button', 'btn btn-outline', booked ? 'Change time' : 'Book a time');
    b.type = 'button';
    b.id = 'job-booking-change';
    b.addEventListener('click', () => openSheet(job, hooks));
    card.append(line, b);
    const anchor = document.getElementById('job-details-card') || host.firstChild;
    host.insertBefore(card, anchor);
  }

  // The day / start / how-long sheet, shared by Change time on a job and by
  // booking the next visit (v164). onSave(when, mins) resolves true to close
  // the sheet, false to leave it open (a clash the person backed out of).
  function sheet({ title, sub, base, mins: cur, saveLabel, onSave, onClose, extra }) {
    const overlay = el('div', 'tester-feedback booking-edit');
    overlay.setAttribute('role', 'dialog');
    const card = el('div', 'tester-feedback-card');
    card.appendChild(el('h2', '', title));
    if (sub) card.appendChild(el('p', 'tester-feedback-sub', sub));

    const dateLabel = el('label', 'tester-feedback-label', 'Day');
    const date = el('input', 'booking-edit-date');
    date.type = 'date';
    date.id = 'booking-edit-date';
    date.value = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
    dateLabel.appendChild(date);

    const times = [];
    for (let m = 6 * 60; m <= 19 * 60; m += 30) {
      const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
      times.push([m, d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })]);
    }
    const startMins = base.getHours() * 60 + base.getMinutes();
    const nearest = times.reduce((a, t) => (Math.abs(t[0] - startMins) < Math.abs(a[0] - startMins) ? t : a), times[0])[0];
    const timeLabel = el('label', 'tester-feedback-label', 'Start');
    const time = select('booking-edit-time', times, nearest);
    timeLabel.appendChild(time);

    const lens = LENGTHS.includes(cur) ? LENGTHS : LENGTHS.concat([cur]).sort((a, b) => a - b);
    const lenLabel = el('label', 'tester-feedback-label', 'How long');
    const len = select('booking-edit-length', lens.map((m) => [m, lengthLabel(m)]), cur);
    lenLabel.appendChild(len);

    const err = el('p', 'tester-feedback-err');
    const row = el('div', 'row gap');
    const cancel = el('button', 'btn btn-secondary flex1', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.action = 'booking-edit-cancel';
    const save = el('button', 'btn btn-primary flex1', saveLabel || 'Save');
    save.type = 'button';
    save.dataset.action = 'booking-edit-save';
    row.append(cancel, save);
    card.append(dateLabel, timeLabel, lenLabel, err, row);
    overlay.appendChild(card);

    let closed = false;
    const close = (how) => {
      if (closed) return;
      closed = true;
      overlay.remove();
      if (onClose) onClose(how);
    };
    cancel.addEventListener('click', () => close('cancel'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
    save.addEventListener('click', async () => {
      if (!date.value) { err.textContent = 'Pick a day.'; return; }
      const [y, mo, d] = date.value.split('-').map(Number);
      const m = Number(time.value);
      const when = new Date(y, mo - 1, d, Math.floor(m / 60), m % 60, 0, 0).getTime();
      const mins = Number(len.value) || 60;
      if (!Number.isFinite(when)) { err.textContent = 'That day does not look right.'; return; }
      save.disabled = true;
      try {
        if (await onSave(when, mins)) close('saved');
        else save.disabled = false;
      } catch (e) {
        save.disabled = false;
        err.textContent = (window.DB && window.DB.describeSaveFailure) ? window.DB.describeSaveFailure(e, 'The booking') : 'Could not save. Try again.';
        if (window.ErrorLog) window.ErrorLog.note(e, 'booking: save');
      }
    });
    if (extra) extra(card, { close, err });
    document.body.appendChild(overlay);
  }

  const noClash = async (jobId, when, mins) => !(window.Scheduler && window.Scheduler.confirmNoOverlap)
    || window.Scheduler.confirmNoOverlap(jobId, when, mins);

  function openSheet(job, hooks) {
    const base = job.scheduledAt ? new Date(job.scheduledAt) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })();
    sheet({
      title: job.scheduledAt ? 'Change the booking' : 'Book a time',
      sub: job.name || '',
      base,
      mins: job.scheduledDurationMins || 60,
      onSave: async (when, mins) => {
        if (!(await noClash(job.id, when, mins))) return false;
        const moved = when !== job.scheduledAt;
        await DB.updateJob(job.id, { scheduledAt: when, scheduledDurationMins: mins });
        // Close first, so the question about telling the client is not
        // asked over the top of this sheet.
        setTimeout(async () => {
          if (window.Common) window.Common.toast(`Booked ${fmtWhen(when)} for ${lengthLabel(mins)}`);
          // A new time is news for the client; a new length on its own is not.
          if (moved && window.BookingNotice) await window.BookingNotice.offer(await DB.getJob(job.id));
          if (hooks && hooks.onSaved) await hooks.onSaved(await DB.getJob(job.id));
        }, 0);
        return true;
      },
      // Cancel the booking, keep the job (v164). The office-admin test found
      // the only way to cancel was the bin: "Delete this job and all its
      // photos", which loses the client, the history and why it was cancelled.
      extra: !job.scheduledAt ? null : (card, { close, err }) => {
        const drop = el('button', 'link-btn full booking-edit-unbook', 'Cancel this booking (keeps the job)');
        drop.type = 'button';
        drop.dataset.action = 'booking-edit-unbook';
        drop.addEventListener('click', async () => {
          const reason = window.Dialog
            ? await window.Dialog.prompt(
              `Take ${job.name || 'this job'} off the diary? The job, the client and any photos stay. Nothing is sent to the client.`,
              '',
              { title: 'Cancel this booking', okLabel: 'Cancel booking', cancelLabel: 'Keep it', placeholder: 'Why? (optional, e.g. customer rang to cancel)' },
            )
            : (window.confirm('Cancel this booking?') ? '' : null);
          if (reason == null) return;
          try {
            const fresh = await DB.getJob(job.id);
            const stamp = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
            const why = reason.trim();
            const note = `Booking for ${fmtWhen(job.scheduledAt)} cancelled ${stamp}${why ? `: ${why}` : '.'}`;
            const notes = [(fresh && fresh.notes) || '', note].filter(Boolean).join('\n');
            await DB.updateJob(job.id, { scheduledAt: null, notes });
            close('unbooked');
            if (window.Common) window.Common.toast('Booking cancelled. Nothing was sent to the client.');
            if (hooks && hooks.onSaved) await hooks.onSaved(await DB.getJob(job.id));
          } catch (e) {
            err.textContent = 'Could not cancel the booking. Try again.';
            if (window.ErrorLog) window.ErrorLog.note(e, 'booking: cancel');
          }
        });
        card.appendChild(drop);
      },
    });
  }

  // Ask for a day, start and length for a visit that does not exist yet (the
  // next visit, booked from Follow-ups or the job screen). Resolves
  // { when, mins } once it is clear of clashes, or null if they backed out.
  // v164: it used to book tomorrow 9am without asking, which clashed and lost
  // the "book me in next Tuesday" the caller had just asked for.
  function pickTime({ title, sub, when, mins }) {
    return new Promise((resolve) => {
      let picked = null;
      sheet({
        title: title || 'Book a time',
        sub,
        base: new Date(when),
        mins: mins || 60,
        saveLabel: 'Book it',
        onSave: async (w, m) => {
          if (!(await noClash(null, w, m))) return false;
          picked = { when: w, mins: m };
          return true;
        },
        onClose: () => resolve(picked),
      });
    });
  }

  // ---- "How long" on the New Job form ----
  // Built here so a stale cached page without it still makes a job (an hour).
  function addLengthToNewJobForm() {
    if (document.getElementById('job-scheduled-length')) return;
    const timeInput = document.getElementById('job-scheduled-time');
    if (!timeInput || !timeInput.parentElement) return;
    const s = select('job-scheduled-length', LENGTHS.map((m) => [m, lengthLabel(m)]), 60);
    s.setAttribute('aria-label', 'How long');
    s.title = 'How long';
    timeInput.parentElement.appendChild(s);
  }
  function readNewJobLength() {
    const s = document.getElementById('job-scheduled-length');
    const v = s ? Number(s.value) : 60;
    return Number.isFinite(v) && v > 0 ? v : 60;
  }
  function resetNewJobLength() {
    const s = document.getElementById('job-scheduled-length');
    if (s) s.value = '60';
  }

  window.BookingEdit = { render, pickTime, LENGTHS, lengthLabel, addLengthToNewJobForm, readNewJobLength, resetNewJobLength };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLengthToNewJobForm); else addLengthToNewJobForm();
})();
