// Follow-ups: the customers who are due for their next spray or inspection,
// who has been chased and how, and who has gone quiet for good.
//
// WHAT IS DUE. A property is due when a job carries nextDueAt (set when its
// report is finalised, or by a standing plan) and nothing is booked for it
// yet. A finished job keeps the time it was booked for as history, so
// "booked" means a booking on a job that is not finished — before v162 the
// diary and the Business screen read any booking time as booked, and every
// property booked through the diary dropped off the due lists for good.
//
// WHAT IS RECORDED (job.followUp, migration 046):
//   { log: [{ at, outcome, note }], snoozedUntil, stoppedAt, stoppedReason }
// and on a client, archivedAt / archivedReason for an offboarded customer.
//
// Pure: jobs and clients in, lists out. No DOM, no database, injectable clock.
// EXPOSES: window.FollowUps
(() => {
  'use strict';

  const DAY = 86400000;
  const SOON_DAYS = 30;

  // What a call can end in. `snoozeDays` puts the next try off; `offboard`
  // suggests letting the customer go.
  const OUTCOMES = [
    { key: 'no_answer', label: 'No answer / left a message' },
    { key: 'call_back', label: 'Call back next week', snoozeDays: 7 },
    { key: 'thinking', label: 'Thinking about it', snoozeDays: 14 },
    { key: 'booked', label: 'Booked in' },
    { key: 'not_interested', label: 'Not interested', offboard: true },
    { key: 'moved', label: 'Sold or moved away', offboard: true },
  ];
  const outcome = (key) => OUTCOMES.find((o) => o.key === key) || null;

  const isBooked = (job) => typeof job.scheduledAt === 'number' && job.scheduledAt > 0 && job.status !== 'completed';
  const archived = (client) => !!(client && client.archivedAt);
  const fu = (job) => (job && job.followUp && typeof job.followUp === 'object' ? job.followUp : {});
  const lastActivity = (job) => Math.max(job.inspectionEndedAt || 0, job.scheduledAt || 0, job.createdAt || 0);

  // "12 Smith St" and "12 Smith Street" are one place (same rule as clients.js).
  const placeKey = (addr) => String(addr || '').toLowerCase()
    .replace(/\b(st|street|rd|road|ave|avenue|cres|crescent|pl|place|dr|drive)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');

  // Is there already newer work for this property or customer: a job that is
  // booked or still open, made after this one was done? Then the due date on
  // this one is already being dealt with, even though nobody cleared it (a
  // job made by hand rather than through Book next visit).
  function alreadyInHand(job, jobs) {
    const key = placeKey(job.address);
    const doneAt = job.inspectionEndedAt || job.scheduledAt || job.createdAt || 0;
    return jobs.some((j) => j.id !== job.id && j.status !== 'completed' && (j.createdAt || 0) > doneAt
      && ((key && placeKey(j.address) === key) || (job.clientId && j.clientId === job.clientId)));
  }

  // One entry per property that is due: what, when, and how the chase is going.
  function dueItems(jobs, clients, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const byId = new Map((clients || []).map((c) => [c.id, c]));
    const all = jobs || [];
    const out = [];
    for (const job of all) {
      if (!job.nextDueAt || isBooked(job)) continue;
      const client = job.clientId ? byId.get(job.clientId) || null : null;
      const f = fu(job);
      if (f.stoppedAt || archived(client)) continue;
      if (alreadyInHand(job, all)) continue;
      const days = Math.floor((t - job.nextDueAt) / DAY);
      const log = Array.isArray(f.log) ? f.log : [];
      const last = log.length ? log[log.length - 1] : null;
      const snoozed = typeof f.snoozedUntil === 'number' && f.snoozedUntil > t;
      let level;
      if (snoozed) level = 'snoozed';
      else if (job.nextDueAt <= t) level = 'overdue';
      else if (job.nextDueAt - t <= SOON_DAYS * DAY) level = 'soon';
      else continue;
      out.push({
        job, client, level,
        dueAt: job.nextDueAt,
        daysOverdue: Math.max(0, days),
        daysUntil: Math.max(0, Math.ceil((job.nextDueAt - t) / DAY)),
        what: job.jobType === 'pest_treatment' ? 'Pest treatment' : 'Termite inspection',
        attempts: log.length,
        last,
        snoozedUntil: snoozed ? f.snoozedUntil : null,
        reminderEmailed: job.reminderSentForDueAt === job.nextDueAt,
      });
    }
    // Most overdue first; then soonest due.
    return out.sort((a, b) => a.dueAt - b.dueAt);
  }

  // Customers worth letting go, each with the reason in plain words. Never
  // acted on by itself: it is a list to look at.
  function offboardSuggestions(jobs, clients, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const out = [];
    const items = dueItems(jobs, clients, t);
    for (const client of clients || []) {
      if (archived(client)) continue;
      const theirs = (jobs || []).filter((j) => j.clientId === client.id);
      let reason = '';
      const said = theirs.map((j) => fu(j).log || []).flat().sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
      if (said && outcome(said.outcome) && outcome(said.outcome).offboard) {
        reason = `Last call: ${outcome(said.outcome).label.toLowerCase()}`;
      } else {
        const item = items.find((i) => i.client && i.client.id === client.id && i.level === 'overdue');
        if (item && item.daysOverdue >= 180 && item.attempts >= 3) {
          reason = `${Math.round(item.daysOverdue / 30)} months overdue, ${item.attempts} tries with no booking`;
        } else if (theirs.length && !theirs.some((j) => isBooked(j) || j.status !== 'completed' || (j.nextDueAt && !fu(j).stoppedAt))) {
          const latest = Math.max(...theirs.map(lastActivity));
          if (latest && t - latest >= 730 * DAY) reason = `No work in ${Math.floor((t - latest) / (365 * DAY))} years and nothing due`;
        }
      }
      if (reason) out.push({ client, reason, jobs: theirs.length });
    }
    return out;
  }

  // The headline for the home screen.
  function counts(jobs, clients, now) {
    const items = dueItems(jobs, clients, now);
    return {
      overdue: items.filter((i) => i.level === 'overdue').length,
      soon: items.filter((i) => i.level === 'soon').length,
      snoozed: items.filter((i) => i.level === 'snoozed').length,
    };
  }

  // ---- changes, returned for the caller to save ----
  function logged(job, key, note, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const f = { ...fu(job) };
    const o = outcome(key);
    f.log = (Array.isArray(f.log) ? f.log : []).concat([{ at: t, outcome: key, note: String(note || '').slice(0, 300) || undefined }]).slice(-50);
    if (o && o.snoozeDays) f.snoozedUntil = t + o.snoozeDays * DAY;
    else delete f.snoozedUntil;
    return f;
  }
  function snoozed(job, days, now) {
    const t = typeof now === 'number' ? now : Date.now();
    return { ...fu(job), snoozedUntil: t + days * DAY };
  }
  function stopped(job, reason, now) {
    return { ...fu(job), stoppedAt: typeof now === 'number' ? now : Date.now(), stoppedReason: String(reason || '').slice(0, 200) };
  }
  function resumed(job) {
    const f = { ...fu(job) };
    delete f.stoppedAt; delete f.stoppedReason; delete f.snoozedUntil;
    return f;
  }

  window.FollowUps = {
    OUTCOMES, outcome, isBooked, dueItems, offboardSuggestions, counts,
    logged, snoozed, stopped, resumed, placeKey,
  };
})();
