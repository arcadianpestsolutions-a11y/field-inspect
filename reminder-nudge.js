// "Tomorrow's reminders haven't been sent."
//
// WHY THIS EXISTS. The day-before reminders are built, tested and deployed, and
// every one of them goes out only when somebody opens the Reminders panel and
// presses the button. That is deliberate - the panel shows each message word for
// word first, and a reminder that goes to a real client is worth reading - but it
// means that on any day nobody opens the panel, nothing is sent, and nothing says
// so. An automatic schedule would fix that by removing the reading, which is the
// part worth keeping. This fixes it the other way: it notices.
//
// WHAT IT IS NOT. It is not a notification. It appears on the job list when the
// app is opened, so it only helps on a day the app is opened at all. A push
// notification would reach somebody who has not opened it, and that needs a push
// service and a server-side schedule, neither of which exist yet.
//
// IT NEVER ASKS THE SERVER. Everything it needs is already on the phone: which
// jobs are booked tomorrow, and the stamp that says a reminder went out for the
// time the job is currently booked at. So it reads no client data over the
// network and sends nothing. The panel it opens is where the server gets asked,
// and only when somebody presses a button there.
//
// WHEN. Not before mid-afternoon. A banner at 7am on a day with tomorrow's jobs
// already booked would nag for seven hours about something that is not yet due,
// and a nag that is ignored all morning is ignored all afternoon. The server
// comment says the same: late enough that the day's bookings have settled, early
// enough that a client can still ring back.
(() => {
  'use strict';

  if (window.ReminderNudge) return;

  const FROM_HOUR = 14; // local time
  const DISMISS_KEY = 'scope-reminder-nudge-dismissed';
  const BANNER_ID = 'reminder-nudge';

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Tomorrow as the CALENDAR sees it, built from date parts rather than by adding
  // 24 hours. On the day clocks change, "tomorrow" is 23 or 25 hours away, and a
  // job at 8am the morning after would fall on the wrong side of a fixed offset.
  function tomorrowRange(now) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    return [start.getTime(), end.getTime()];
  }

  const hasContact = (job) => !!(String(job.clientPhone || '').trim() || String(job.clientEmail || '').trim());

  // A job that tomorrow's reminder should have gone to and has not.
  //   - booked inside tomorrow
  //   - the client has not asked us to stop
  //   - there is some way to reach them (a landline-only client still counts: they
  //     are the ones who need a phone call, and the panel says so)
  //   - no reminder has gone out for the time it is CURRENTLY booked at. The stamp
  //     holds the booking time it was sent for, so a job moved after its reminder
  //     went out correctly counts again: the client was told the old time.
  function needsReminder(job, range) {
    if (!job || typeof job.scheduledAt !== 'number' || !Number.isFinite(job.scheduledAt)) return false;
    if (job.scheduledAt < range[0] || job.scheduledAt >= range[1]) return false;
    if (job.commsOptOut) return false;
    if (job.status === 'completed') return false;
    if (!hasContact(job)) return false;
    return job.dayBeforeSentForAt !== job.scheduledAt;
  }

  function dueTomorrow(jobs, now) {
    const range = tomorrowRange(now || new Date());
    return (jobs || []).filter((j) => needsReminder(j, range));
  }

  const isTimeToNudge = (now) => (now || new Date()).getHours() >= FROM_HOUR;

  // Per day, not for good. Dismissing it says "I know, not now", and tomorrow the
  // same unsent reminder is a new reason to look.
  function dismissedFor(now) {
    try { return localStorage.getItem(DISMISS_KEY) === dayKey(now || new Date()); } catch (e) { return false; }
  }
  function dismissToday() {
    try { localStorage.setItem(DISMISS_KEY, dayKey(new Date())); } catch (e) { /* private window: it simply comes back */ }
    hideBanner();
  }

  // ---- the banner ----------------------------------------------------------
  // Built here and not in index.html, for the reason every late-added control in
  // this app is: a returning device can pair a fresh script with a stale cached
  // page, and a missing element must degrade to "no banner", never to an error.
  const $ = (id) => document.getElementById(id);
  const visibleEl = (el) => !!el && el.getBoundingClientRect().width > 1 && !el.closest('.hidden');

  function bannerHost() {
    const view = $('view-joblist');
    return view ? view.querySelector('main.content') : null;
  }

  function hideBanner() {
    const el = $(BANNER_ID);
    if (el) el.remove();
  }

  function showBanner(count) {
    const host = bannerHost();
    if (!host) return;
    const text = count === 1
      ? "1 client booked tomorrow hasn't had a reminder yet."
      : `${count} clients booked tomorrow haven't had a reminder yet.`;

    let el = $(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.className = 'card reminder-nudge';
      el.setAttribute('role', 'status');

      const msg = document.createElement('p');
      msg.className = 'reminder-nudge-text';
      el.appendChild(msg);

      const row = document.createElement('div');
      row.className = 'row gap';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn-primary flex1';
      go.textContent = 'Review & send';
      go.addEventListener('click', openReminders);
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'btn btn-secondary flex1';
      later.textContent = 'Not today';
      later.addEventListener('click', dismissToday);
      row.append(go, later);
      el.appendChild(row);

      host.insertBefore(el, host.firstChild);
    }
    el.querySelector('.reminder-nudge-text').textContent = text;
  }

  // Takes somebody to the panel, where each message is shown word for word before
  // anything is sent. Deliberately does NOT press "Check tomorrow" for them: the
  // reading is the point, and it is one more tap they can see themselves make.
  async function openReminders() {
    const sched = $('open-scheduler-btn');
    if (sched) sched.click();
    for (let i = 0; i < 60; i++) {
      const bell = $('reminders-open');
      if (visibleEl(bell)) { bell.click(); return; }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  async function refresh() {
    try {
      const now = new Date();
      if (!isTimeToNudge(now) || dismissedFor(now)) { hideBanner(); return 0; }
      if (!window.DB || typeof window.DB.getJobs !== 'function') { hideBanner(); return 0; }
      const due = dueTomorrow(await window.DB.getJobs(), now);
      if (!due.length) { hideBanner(); return 0; }
      showBanner(due.length);
      return due.length;
    } catch (e) {
      // A nudge that fails is no nudge. It must never be the thing that breaks
      // the job list, and a failure to look is worth a line in the log.
      if (window.ErrorLog) window.ErrorLog.note(e, 'reminder nudge');
      hideBanner();
      return 0;
    }
  }

  window.ReminderNudge = {
    refresh, dismissToday,
    // Exposed for the suite.
    dueTomorrow, needsReminder, tomorrowRange, isTimeToNudge, dismissedFor, FROM_HOUR,
  };

  // Test pages drive refresh() themselves: a banner appearing at 2pm on the job
  // list would change the DOM under every other test.
  if (window.IS_TEST) return;

  function start() {
    // The job list appears after sign-in and sync, which this does not wait for;
    // so it looks again whenever the list is shown, the app comes back to the
    // foreground, and every couple of minutes.
    const view = $('view-joblist');
    if (view) {
      let queued = false;
      new MutationObserver(() => {
        if (queued || view.classList.contains('hidden')) return;
        queued = true;
        setTimeout(() => { queued = false; refresh(); }, 250);
      }).observe(view, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(refresh, 2 * 60 * 1000);
    setTimeout(refresh, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
