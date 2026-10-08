// ---------------------------------------------------------------------------
// today.js - works out what "today" looks like for the technician.
//
// PURPOSE   The first thing a person driving between properties needs is today's
//           jobs, in order, with where to be next and how long the drive is.
//           This turns the job list into exactly that. Pure logic: no DOM, no
//           database, injectable clock, so it is tested directly.
// EXPOSES   window.Today = { build, timeLabel, durationLabel, startOfDay, addDays }
// DEPENDS   window.Availability.travelMinutesBetween (optional: without it the
//           travel figures are simply left out, never guessed).
// TESTS     tests/run-tests.js - "Today" group.
//
// Dates: every day boundary is made with the Date constructor, never by adding
// 86,400,000 ms. NSW moves its clocks in October and April, so a day is
// sometimes 23 or 25 hours long, and a millisecond-stepped loop drifts an hour.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const DEFAULT_MINS = 60;
  // A job that has not been started this long after its time is "running late".
  const LATE_AFTER_MINS = 5;
  // Missed appointments older than this are history, not today's worry.
  const OVERDUE_DAYS = 14;
  const OVERDUE_SHOWN = 5;

  const startOfDay = (ts) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const addDays = (ts, n) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  };

  const isBooked = (job) => !!job && typeof job.scheduledAt === 'number' && job.scheduledAt > 0;
  const durationOf = (job) => (job.scheduledDurationMins > 0 ? job.scheduledDurationMins : DEFAULT_MINS);

  // "8am", "2:30pm" - the same shape the job list already uses.
  function timeLabel(ts) {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    return `${h % 12 === 0 ? 12 : h % 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
  }

  // 45 -> "45 min", 60 -> "1h", 70 -> "1h 10m".
  function durationLabel(mins) {
    const m = Math.max(0, Math.round(mins || 0));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function travelBetween(a, b, config) {
    if (!window.Availability || !window.Availability.travelMinutesBetween) return null;
    const mins = window.Availability.travelMinutesBetween(a, b, config);
    return typeof mins === 'number' ? mins : null;
  }

  // jobs: every job. now: epoch ms. opts.config: travel configuration, if any.
  function build(jobs, now, opts) {
    const config = opts && opts.config;
    const all = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
    const dayStart = startOfDay(now);
    const tomorrowStart = addDays(dayStart, 1);
    const dayAfterStart = addDays(dayStart, 2);
    const oldestOverdue = addDays(dayStart, -OVERDUE_DAYS);
    const byTime = (a, b) => (a.scheduledAt - b.scheduledAt) || String(a.name || '').localeCompare(String(b.name || ''));
    const booked = all.filter(isBooked);

    // ---- today, in order, with the drive between consecutive jobs ----
    const todayJobs = booked
      .filter((j) => j.scheduledAt >= dayStart && j.scheduledAt < tomorrowStart)
      .sort(byTime);

    let travelTotal = 0;
    let travelKnown = false;
    const items = todayJobs.map((job, i) => {
      const startAt = job.scheduledAt;
      const endAt = startAt + durationOf(job) * 60000;
      const done = job.status === 'completed';
      const active = job.status === 'in_progress';
      const lateBy = !done && !active && (job.status || 'new') === 'new'
        ? Math.round((now - startAt) / 60000) : 0;

      let travelMins = null;
      let gapMins = null;
      let tight = false;
      let overlaps = false;
      if (i > 0) {
        const prev = todayJobs[i - 1];
        const prevEnd = prev.scheduledAt + durationOf(prev) * 60000;
        gapMins = Math.round((startAt - prevEnd) / 60000);
        travelMins = travelBetween(prev, job, config);
        overlaps = gapMins < 0;
        tight = !overlaps && travelMins !== null && gapMins < travelMins;
        if (travelMins !== null) { travelTotal += travelMins; travelKnown = true; }
      }
      return {
        job,
        startAt,
        endAt,
        durationMins: durationOf(job),
        done,
        active,
        lateByMins: lateBy > LATE_AFTER_MINS ? lateBy : 0,
        travelMins,
        gapMins,
        tight,
        overlaps,
      };
    });

    // The one to look at now: whatever is under way, else the first not finished.
    const nextItem = items.find((it) => it.active)
      || items.find((it) => !it.done && it.endAt > now)
      || null;

    // ---- still owed from earlier days ----
    const overdueAll = booked
      .filter((j) => j.scheduledAt < dayStart && j.scheduledAt >= oldestOverdue && j.status !== 'completed')
      .sort((a, b) => b.scheduledAt - a.scheduledAt);

    // ---- tomorrow ----
    const tomorrowJobs = booked
      .filter((j) => j.scheduledAt >= tomorrowStart && j.scheduledAt < dayAfterStart && j.status !== 'completed')
      .sort(byTime);

    const unbooked = all.filter((j) => !isBooked(j) && (j.status || 'new') === 'new').length;

    return {
      dayStart,
      items,
      next: nextItem,
      overdue: overdueAll.slice(0, OVERDUE_SHOWN),
      overdueMore: Math.max(0, overdueAll.length - OVERDUE_SHOWN),
      tomorrow: tomorrowJobs,
      unbooked,
      summary: {
        count: items.length,
        doneCount: items.filter((it) => it.done).length,
        firstAt: items.length ? items[0].startAt : null,
        lastEndAt: items.length ? Math.max(...items.map((it) => it.endAt)) : null,
        travelMins: travelKnown ? travelTotal : null,
      },
    };
  }

  window.Today = { build, timeLabel, durationLabel, startOfDay, addDays, LATE_AFTER_MINS, OVERDUE_DAYS };
})();
