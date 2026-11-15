// Scheduler — a month diary that shows how loaded each day is, expanding into
// an hour-by-hour timeslot grid for the day you tap.
//
// Two things it has to answer without being read carefully:
//   1. Looking at the month: how busy is each day? Not "are there jobs" but
//      "how many, and how many hours", because three 30-minute treatments and
//      three 4-hour inspections are very different days.
//   2. Looking at a day: where are the actual gaps? A list of bookings does
//      not show you free time; a slot grid does.
//
// The distinction underneath all of it: a job can be DUE (nextDueAt, set when
// a report is finalised) without being BOOKED (scheduledAt, set here). Work
// that is due but unbooked is the stuff that gets forgotten, so it sits in a
// backlog on the same screen rather than in a separate view.
(() => {
  'use strict';

  const view = document.getElementById('view-scheduler');
  if (!view) { console.warn('[scheduler] view missing from the page'); return; }

  // A pest-control working day. Slots are hourly because that is how jobs are
  // actually quoted and booked; CAPACITY is the point past which a day is
  // called full, used only to colour the load bar.
  const DAY_START_HOUR = 7;
  const DAY_END_HOUR = 18;
  const CAPACITY_MINS = 8 * 60;
  // The grid starts at 7am so an early start can be booked deliberately, but
  // one-tap Book should not put a client at 7am just because the day is
  // empty — it searches from a civilised first appointment instead.
  const BOOK_DEFAULT_START_HOUR = 8;
  const DURATION_OPTIONS = [30, 60, 90, 120, 180, 240];

  const { el } = window.Common;
  const backBtn = el('scheduler-back-btn');
  const titleEl = el('scheduler-month-label');
  const prevBtn = el('scheduler-prev');
  const nextBtn = el('scheduler-next');
  const todayBtn = el('scheduler-today');
  const gridEl = el('scheduler-grid');
  const dayTitleEl = el('scheduler-day-title');
  const dayLoadEl = el('scheduler-day-load');
  const slotsEl = el('scheduler-slots');
  const backlogEl = el('scheduler-backlog');
  const backlogCountEl = el('scheduler-backlog-count');
  const pickerModal = el('slot-picker-modal');
  const pickerTitle = el('slot-picker-title');
  const pickerList = el('slot-picker-list');
  const pickerDuration = el('slot-picker-duration');
  const pickerCancel = el('slot-picker-cancel');

  // Shared helpers (common.js). The in-app confirm matters here: it is the
  // only thing standing between a technician and a double-booking they never saw.
  const { toast, askConfirm } = window.Common;

  // All calendar maths is on local calendar days. Going through UTC here would
  // shift every booking by the timezone offset.
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const sameDay = (a, b) => dayKey(a) === dayKey(b);

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  let cursor = startOfDay(new Date());
  let selected = startOfDay(new Date());
  let jobs = [];
  let pendingSlotHour = null; // which slot the picker is booking into

  const durationOf = (job) => job.scheduledDurationMins || 60;

  // ---------- Travel between jobs ----------
  // The scheduler has always known WHEN jobs are and nothing about WHERE,
  // so booking 9am at Camden and 10am at Oakdale looked perfectly fine. The
  // driving between them is the cost that never appeared anywhere: unpaid,
  // every day, and invisible until the second client is rung to say you are
  // running late.
  //
  // This is an estimate and is presented as one. Straight-line distance
  // scaled for the fact roads do not go in straight lines, at an average
  // door-to-door speed for suburban Macarthur running — which is well below
  // any speed limit because it includes lights, roundabouts, finding the
  // place, and parking. Rounded to five minutes so it never reads as more
  // precise than it is.
  //
  // A real routing API would be more accurate and would also mean another
  // key, another bill, another thing that fails with no signal in a subfloor.
  // Worth doing only if these estimates turn out to be wrong in practice.
  // The estimate itself now lives in availability.js, so the diary, the
  // booking assistant and (later) a client picking their own slot all work
  // from the same numbers instead of three copies that drifted apart.
  //
  // This is the internal view of the working day: the full 7am–6pm grid, no
  // lead time, and hourly steps because that is what the grid draws. The
  // public-facing defaults in availability.js are deliberately narrower.
  const AVAIL_HOURS = { 0: [DAY_START_HOUR, DAY_END_HOUR], 1: [DAY_START_HOUR, DAY_END_HOUR],
    2: [DAY_START_HOUR, DAY_END_HOUR], 3: [DAY_START_HOUR, DAY_END_HOUR],
    4: [DAY_START_HOUR, DAY_END_HOUR], 5: [DAY_START_HOUR, DAY_END_HOUR],
    6: [DAY_START_HOUR, DAY_END_HOUR] };
  const AVAIL_CONFIG = { hours: AVAIL_HOURS, slotStepMins: 60, minLeadMins: 0 };

  function hasCoords(job) {
    return !!job && typeof job.addressLat === 'number' && typeof job.addressLng === 'number';
  }

  function travelMinutesBetween(fromJob, toJob) {
    if (!window.Availability) return null;
    return window.Availability.travelMinutesBetween(fromJob, toJob, window.Availability.configFrom(AVAIL_CONFIG));
  }

  // The job immediately before this one on the same day, by start time.
  function previousJobBefore(dayJobs, job) {
    return dayJobs
      .filter((j) => j.id !== job.id && j.scheduledAt < job.scheduledAt)
      .sort((a, b) => b.scheduledAt - a.scheduledAt)[0] || null;
  }

  function fmtTravel(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
  }

  function fmtHour(h) {
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const m = d.getMinutes();
    return m === 0 ? fmtHour(d.getHours())
      : `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${String(m).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`;
  }

  // "4.5 hrs" reads faster than "270 min" when you are sizing up a day.
  function fmtHours(mins) {
    const h = mins / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hr${h === 1 ? '' : 's'}`;
  }

  function fmtDayLabel(d) {
    const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  }

  const typeIcon = (job) => (job.jobType === 'pest_treatment' ? '🧪' : '🐜');

  function jobsOn(date) {
    return jobs
      .filter((j) => j.scheduledAt && sameDay(new Date(j.scheduledAt), date))
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  function loadFor(date) {
    const list = jobsOn(date);
    return { count: list.length, minutes: list.reduce((sum, j) => sum + durationOf(j), 0) };
  }

  // ---------- month grid ----------
  function renderGrid() {
    titleEl.textContent = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    gridEl.innerHTML = '';

    for (const d of DOW) {
      const h = document.createElement('div');
      h.className = 'cal-dow';
      h.textContent = d;
      gridEl.appendChild(h);
    }

    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const leading = (first.getDay() + 6) % 7; // Monday-first, how a work diary reads
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

    for (let i = 0; i < leading; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-cell cal-blank';
      gridEl.appendChild(blank);
    }

    const today = startOfDay(new Date());
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      const { count, minutes } = loadFor(date);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      if (sameDay(date, today)) cell.classList.add('cal-today');
      if (sameDay(date, selected)) cell.classList.add('cal-selected');
      if (count) cell.setAttribute('aria-label',
        `${day} ${MONTHS[cursor.getMonth()]}: ${count} job${count === 1 ? '' : 's'}, ${fmtHours(minutes)}`);

      const num = document.createElement('span');
      num.className = 'cal-daynum';
      num.textContent = day;
      cell.appendChild(num);

      if (count) {
        const load = document.createElement('span');
        load.className = 'cal-load';
        load.textContent = `${count}·${Math.round(minutes / 60 * 10) / 10}h`;
        cell.appendChild(load);

        // The bar is the at-a-glance signal: length is how full, colour is
        // whether the day is comfortable, tight, or overbooked.
        const bar = document.createElement('span');
        bar.className = 'cal-bar';
        const fill = document.createElement('span');
        const pct = Math.min(100, Math.round((minutes / CAPACITY_MINS) * 100));
        fill.style.width = pct + '%';
        fill.className = 'cal-bar-fill' +
          (minutes > CAPACITY_MINS ? ' cal-bar-over' : minutes >= CAPACITY_MINS * 0.75 ? ' cal-bar-tight' : '');
        bar.appendChild(fill);
        cell.appendChild(bar);
      }

      cell.addEventListener('click', () => { selected = date; renderGrid(); renderDay(); renderTidyButton(); });
      gridEl.appendChild(cell);
    }
  }

  // ---------- day timeslot grid ----------
  // Half-hour rows (v150). A slot is named by its minutes from midnight:
  // 9:30am is 570.
  const SLOT_MINS = 30;
  const minsOfDay = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };
  const slotFloor = (mins) => Math.floor(mins / SLOT_MINS) * SLOT_MINS;
  const fmtSlot = (mins) => fmtTime(new Date(selected).setHours(0, mins, 0, 0));

  function renderDay() {
    const list = jobsOn(selected);
    const { count, minutes } = loadFor(selected);

    dayTitleEl.textContent = fmtDayLabel(selected);
    dayLoadEl.textContent = count
      ? `${count} job${count === 1 ? '' : 's'} · ${fmtHours(minutes)} of ${fmtHours(CAPACITY_MINS)}`
      : 'Nothing booked';
    dayLoadEl.className = 'day-load' +
      (minutes > CAPACITY_MINS ? ' day-load-over' : minutes >= CAPACITY_MINS * 0.75 ? ' day-load-tight' : '');

    slotsEl.innerHTML = '';

    // Which half hours a job occupies, so a 2-hour job fills the rows after
    // it instead of looking like that time is free.
    const occupiedBy = new Map();
    for (const job of list) {
      const start = minsOfDay(job.scheduledAt);
      const first = slotFloor(start);
      const spans = Math.max(1, Math.ceil((start - first + durationOf(job)) / SLOT_MINS));
      for (let i = 0; i < spans; i++) {
        const m = first + i * SLOT_MINS;
        if (!occupiedBy.has(m)) occupiedBy.set(m, { job, isStart: i === 0 });
      }
    }

    // Anything booked outside working hours still has to be visible.
    const outOfHours = list.filter((j) => {
      const h = new Date(j.scheduledAt).getHours();
      return h < DAY_START_HOUR || h >= DAY_END_HOUR;
    });

    for (let slot = DAY_START_HOUR * 60; slot < DAY_END_HOUR * 60; slot += SLOT_MINS) {
      const onHour = slot % 60 === 0;
      const row = document.createElement('div');
      row.className = 'slot-row' + (onHour ? '' : ' slot-row-half');
      row.dataset.slot = String(slot);

      const label = document.createElement('span');
      label.className = 'slot-hour' + (onHour ? '' : ' slot-hour-half');
      label.textContent = onHour ? fmtHour(slot / 60) : ':30';
      row.appendChild(label);

      const entry = occupiedBy.get(slot);
      const next = occupiedBy.get(slot + SLOT_MINS);
      // The job's last half hour on the grid: its bottom edge can be dragged.
      const isLastRow = entry && (!next || next.job.id !== entry.job.id || next.isStart);
      if (entry && entry.isStart) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-job';
        btn.dataset.job = entry.job.id;
        const name = document.createElement('span');
        name.className = 'slot-job-name';
        name.textContent = `${typeIcon(entry.job)} ${entry.job.name}`;
        btn.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'slot-job-meta';
        // Same rule as the job list: a technician name is only worth a
        // technician's attention once there's more than one to distinguish.
        const technicians = new Set(jobs.map((j) => j.assignedTo).filter(Boolean));
        const who = technicians.size >= 2 && entry.job.assignedTo
          ? (window.technicianDisplayName ? window.technicianDisplayName(entry.job.assignedTo) : entry.job.assignedTo)
          : null;
        // "Not sent": the client has not been told about this time yet
        // (booking-notice.js). Read here so a day shows who still needs it.
        const unsent = window.BookingNotice && window.BookingNotice.needsSending(entry.job) ? '✉ client not told yet' : null;
        meta.textContent = [fmtTime(entry.job.scheduledAt), `${durationOf(entry.job)} min`, unsent, entry.job.address, who]
          .filter(Boolean).join(' · ');
        btn.appendChild(meta);
        btn.addEventListener('click', () => {
          // The click that ends a drag is not a tap on the job.
          if (suppressClickUntil > Date.now()) return;
          if (window.showJobViewById) window.showJobViewById(entry.job.id);
        });
        makeMovable(btn, entry.job);
        row.appendChild(btn);

        // The drive to get here from the previous job, and whether the day
        // actually allows for it. Shown on the arriving job rather than the
        // leaving one because that is the appointment that gets missed.
        const previous = previousJobBefore(list, entry.job);
        const travel = travelMinutesBetween(previous, entry.job);
        if (travel !== null) {
          const gap = Math.round(
            (entry.job.scheduledAt - (previous.scheduledAt + durationOf(previous) * 60000)) / 60000
          );
          const tooTight = gap < travel;
          const note = document.createElement('span');
          note.className = 'slot-travel' + (tooTight ? ' slot-travel-tight' : '');
          note.textContent = tooTight
            ? `⚠ ~${fmtTravel(travel)} drive from ${previous.name}, but only ${fmtTravel(Math.max(0, gap))} between them`
            : `🚗 ~${fmtTravel(travel)} drive from ${previous.name}`;
          // Inside the job block, not beside it: .slot-row is a flex row, so
          // a sibling would sit alongside the job and squeeze it. .slot-job
          // is already a column, so this stacks under the address where it
          // reads as belonging to this arrival.
          btn.appendChild(note);
        }
        row.appendChild(edgeHandle(entry.job, 'start'));
      } else if (entry) {
        const cont = document.createElement('span');
        cont.className = 'slot-continued';
        cont.dataset.job = entry.job.id;
        // Said once an hour: a long job is not a column of the same sentence.
        cont.textContent = onHour ? `↳ ${entry.job.name} continues` : '';
        row.appendChild(cont);
      } else {
        const free = document.createElement('button');
        free.type = 'button';
        free.className = 'slot-free';
        free.textContent = onHour ? '+ Book this slot' : `+ ${fmtSlot(slot)}`;
        free.addEventListener('click', () => openPicker(slot));
        row.appendChild(free);
      }

      if (isLastRow) row.appendChild(edgeHandle(entry.job, 'end'));
      slotsEl.appendChild(row);
    }

    for (const job of outOfHours) {
      const row = document.createElement('div');
      row.className = 'slot-row';
      const label = document.createElement('span');
      label.className = 'slot-hour slot-hour-odd';
      label.textContent = fmtTime(job.scheduledAt);
      row.appendChild(label);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-job';
      btn.innerHTML = '';
      const name = document.createElement('span');
      name.className = 'slot-job-name';
      name.textContent = `${typeIcon(job)} ${job.name}`;
      btn.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'slot-job-meta';
      meta.textContent = `Outside working hours · ${durationOf(job)} min`;
      btn.appendChild(meta);
      btn.addEventListener('click', () => window.showJobViewById && window.showJobViewById(job.id));
      row.appendChild(btn);
      slotsEl.appendChild(row);
    }
  }

  // ---------- dragging a job (v149, v150) ----------
  // Three drags, all in half-hour steps:
  //   the bar along the bottom edge   later or earlier finish
  //   the bar along the top edge      earlier or later start, same finish
  //   press and hold the job itself   move it to another time, same length
  // Each one ends in reschedule(), which asks before landing on another job.
  let suppressClickUntil = 0;

  // The job now runs from startMins to endMins (minutes from midnight) on the
  // day it is already on. Returns what was saved, or null if nothing changed.
  async function reschedule(job, startMins, endMins) {
    const open = DAY_START_HOUR * 60;
    const close = DAY_END_HOUR * 60;
    const oldStart = minsOfDay(job.scheduledAt);
    const oldEnd = oldStart + durationOf(job);
    // Inside working hours, unless the job already ran outside them.
    let from = Math.max(Math.min(open, oldStart), startMins);
    let to = Math.min(Math.max(close, oldEnd), endMins);
    // Never shorter than one half hour: the edge that was dragged gives way.
    if (to - from < SLOT_MINS) { if (from !== oldStart) from = to - SLOT_MINS; else to = from + SLOT_MINS; }
    const mins = to - from;
    const moved = from !== oldStart;
    if (!moved && mins === durationOf(job)) return null;
    const when = new Date(job.scheduledAt);
    when.setHours(0, from, 0, 0);
    const scheduledAt = when.getTime();
    // Shorter and in the same place cannot land on anything new.
    if ((moved || mins > durationOf(job)) && !(await confirmNoOverlap(job.id, scheduledAt, mins))) return null;
    await DB.updateJob(job.id, { scheduledAt, scheduledDurationMins: mins });
    toast(`${job.name}: ${fmtTime(scheduledAt)} to ${fmtSlot(to)} (${fmtHours(mins)})`);
    await refresh();
    // A new start time is news for the client; a new length is not.
    if (moved) offerBookingNotice(job.id);
    return { scheduledAt, mins };
  }

  // Kept for v149 callers: the job now ends at endHour o'clock.
  async function resizeJob(job, endHour) {
    const saved = await reschedule(job, minsOfDay(job.scheduledAt), endHour * 60);
    return saved ? saved.mins : null;
  }

  function slotUnder(x, y) {
    const under = document.elementFromPoint(x, y);
    const row = under && under.closest ? under.closest('.slot-row[data-slot]') : null;
    return row ? Number(row.dataset.slot) : null;
  }

  function paintPreview(from, to) {
    slotsEl.querySelectorAll('.slot-row[data-slot]').forEach((r) => {
      const m = Number(r.dataset.slot);
      const on = from !== null && m >= slotFloor(from) && m < to;
      r.classList.toggle('slot-drag-preview', on);
      r.classList.toggle('slot-drag-first', on && m === slotFloor(from));
      r.classList.toggle('slot-drag-last', on && m + SLOT_MINS >= to);
    });
  }

  // One drag in progress: where the job would run if dropped now.
  function beginDrag(job, mode, grabSlot) {
    const s0 = minsOfDay(job.scheduledAt);
    const e0 = s0 + durationOf(job);
    const grabOffset = mode === 'move' && grabSlot !== null ? grabSlot - slotFloor(s0) : 0;
    const drag = { from: s0, to: e0 };
    slotsEl.classList.add('slot-dragging');
    paintPreview(drag.from, drag.to);
    return {
      move(x, y) {
        const slot = slotUnder(x, y);
        if (slot === null) return;
        if (mode === 'end') { drag.from = s0; drag.to = Math.max(slotFloor(s0) + SLOT_MINS, slot + SLOT_MINS); }
        else if (mode === 'start') { drag.to = e0; drag.from = Math.min(e0 - SLOT_MINS, slot); }
        else {
          const len = e0 - s0;
          const first = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60 - len, slot - grabOffset));
          drag.from = first; drag.to = first + len;
        }
        paintPreview(drag.from, drag.to);
      },
      async end(commit) {
        slotsEl.classList.remove('slot-dragging');
        paintPreview(null, 0);
        if (commit) await reschedule(job, drag.from, drag.to);
      },
    };
  }

  // The bar along the top ('start') or bottom ('end') edge of a job.
  function edgeHandle(job, edge) {
    const handle = document.createElement('div');
    handle.className = 'slot-resize slot-resize-' + edge;
    handle.dataset.resize = job.id;
    handle.dataset.edge = edge;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', edge === 'end'
      ? `Drag to change when ${job.name} finishes`
      : `Drag to change when ${job.name} starts`);
    handle.title = edge === 'end' ? 'Drag to finish later or earlier' : 'Drag to start earlier or later';
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older browsers still get the events */ }
      drag = beginDrag(job, edge, null);
    });
    handle.addEventListener('pointermove', (e) => { if (drag) drag.move(e.clientX, e.clientY); });
    const finish = (commit) => { const d = drag; drag = null; if (d) d.end(commit); };
    // Where it was let go counts, even if no move event arrived on the way.
    handle.addEventListener('pointerup', (e) => { if (drag) drag.move(e.clientX, e.clientY); finish(true); });
    handle.addEventListener('pointercancel', () => finish(false));
    // The handle sits on the job: a drag must not also open the job.
    handle.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    return handle;
  }

  // Press and hold the job, then drag it to another time. A mouse starts as
  // soon as it moves; a finger has to rest first (HOLD_MS), so that a swipe
  // still scrolls the day.
  const HOLD_MS = 350;
  const SLOP_PX = 6;
  function makeMovable(btn, job) {
    let press = null;
    let drag = null;
    const start = () => {
      if (!press) return;
      press.active = true;
      try { btn.setPointerCapture(press.id); } catch (err) { /* still works without capture */ }
      btn.classList.add('slot-job-lifted');
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* a nicety */ } }
      drag = beginDrag(job, 'move', slotUnder(press.x, press.y));
    };
    const clear = (commit) => {
      if (press && press.timer) clearTimeout(press.timer);
      const d = drag;
      const wasActive = press && press.active;
      press = null;
      drag = null;
      btn.classList.remove('slot-job-lifted');
      if (wasActive) suppressClickUntil = Date.now() + 400;
      if (d) d.end(commit);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button) return; // left button or a finger only
      if (e.target.closest && e.target.closest('.slot-resize')) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false, timer: null };
      // A mouse that moves fast is off the job before its first move event:
      // keep the events coming here from the moment it is pressed.
      if (e.pointerType === 'mouse') { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* still works for a slow drag */ } }
      if (e.pointerType !== 'mouse') press.timer = setTimeout(start, HOLD_MS);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!press) return;
      if (!press.active) {
        const far = Math.abs(e.clientX - press.x) > SLOP_PX || Math.abs(e.clientY - press.y) > SLOP_PX;
        if (!far) return;
        if (e.pointerType === 'mouse') start(); else { clear(false); return; } // a swipe: let it scroll
      }
      if (drag) drag.move(e.clientX, e.clientY);
    });
    btn.addEventListener('pointerup', (e) => {
      // A mouse let go somewhere else without a move event in between.
      if (press && !press.active && e.pointerType === 'mouse'
        && (Math.abs(e.clientX - press.x) > SLOP_PX || Math.abs(e.clientY - press.y) > SLOP_PX)) start();
      if (drag) drag.move(e.clientX, e.clientY);
      clear(true);
    });
    btn.addEventListener('pointercancel', () => clear(false));
    // Once a finger has lifted the job, the page must not scroll under it.
    btn.addEventListener('touchmove', (e) => { if (press && press.active) e.preventDefault(); }, { passive: false });
    btn.addEventListener('contextmenu', (e) => { if (press) e.preventDefault(); });
  }

  // Ask whether the client should be told (booking-notice.js). Never awaited
  // by the booking itself: the job is booked whatever is answered.
  function offerBookingNotice(jobId) {
    if (!window.BookingNotice) return;
    DB.getJob(jobId).then((fresh) => {
      if (!fresh) return null;
      return window.BookingNotice.offer(fresh).then(() => refresh());
    }).catch((err) => { if (window.ErrorLog) window.ErrorLog.note(err, 'diary: ask to send booking'); });
  }

  // ---------- booking into a specific slot ----------
  function unbookedJobs() {
    const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return jobs.filter((j) => {
      if (j.scheduledAt) return false;
      if (j.status === 'completed' && !j.nextDueAt) return false;
      if (j.nextDueAt) return j.nextDueAt <= soon;
      return j.status !== 'completed';
    }).sort((a, b) => (a.nextDueAt || a.createdAt) - (b.nextDueAt || b.createdAt));
  }

  function openPicker(slot) {
    pendingSlotHour = slot;
    pickerTitle.textContent = `Book ${fmtSlot(slot)}, ${fmtDayLabel(selected)}`;
    pickerDuration.value = '60';
    pickerList.innerHTML = '';

    const candidates = unbookedJobs();
    if (!candidates.length) {
      pickerList.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty-hint',
        textContent: 'No unbooked jobs. Create one from the job list first.',
      }));
    }
    for (const job of candidates) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-row';
      const name = document.createElement('span');
      name.className = 'agenda-name';
      name.textContent = `${typeIcon(job)} ${job.name}`;
      btn.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'agenda-meta';
      meta.textContent = job.address || (job.nextDueAt ? 'Due for re-inspection' : 'Not booked yet');
      btn.appendChild(meta);
      btn.addEventListener('click', () => bookInto(job, slot));
      pickerList.appendChild(btn);
    }
    pickerModal.classList.remove('hidden');
  }

  function closePicker() {
    pickerModal.classList.add('hidden');
    pendingSlotHour = null;
  }

  async function bookInto(job, slot) {
    const when = new Date(selected);
    when.setHours(0, slot, 0, 0);
    const mins = parseInt(pickerDuration.value, 10) || 60;
    // The grid only ever shows the tapped hour as free — it says nothing
    // about whether the chosen duration runs into the hour after, which is
    // exactly how a 2pm slot with a 3-hour job silently landed on top of a
    // 3pm booking before this existed.
    if (!(await confirmNoOverlap(job.id, when.getTime(), mins))) return;
    await DB.updateJob(job.id, { scheduledAt: when.getTime(), scheduledDurationMins: mins });
    closePicker();
    toast(`${job.name} booked ${fmtDayLabel(selected)} at ${fmtSlot(slot)} (${mins} min)`);
    await refresh();
    offerBookingNotice(job.id);
  }

  // ---------- backlog ----------
  function renderBacklog() {
    backlogEl.innerHTML = '';
    const items = unbookedJobs();
    const now = Date.now();

    backlogCountEl.textContent = items.length ? String(items.length) : '';
    backlogCountEl.classList.toggle('hidden', !items.length);

    if (!items.length) {
      backlogEl.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty-hint',
        textContent: 'Nothing waiting to be booked.',
      }));
      return;
    }

    for (const job of items) {
      const row = document.createElement('div');
      row.className = 'backlog-row';

      const body = document.createElement('span');
      body.className = 'agenda-body';
      const name = document.createElement('span');
      name.className = 'agenda-name';
      name.textContent = `${typeIcon(job)} ${job.name}`;
      body.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'agenda-meta';
      if (job.nextDueAt) {
        const days = Math.round((job.nextDueAt - now) / 86400000);
        // A 12-month termite job that already got its 9-month reminder
        // email and is now past its due date anyway has had the automatic
        // path exhausted — this is what send-client-message's due_reminder
        // sweep reports back as `stillDue`: the email didn't get it
        // rebooked, so it stops being a due-date line and becomes a task
        // for a human to chase directly, which reads differently to a
        // technician than "just" overdue.
        const emailedForThisDueDate = job.reminderSentForDueAt === job.nextDueAt;
        if (days <= 0 && emailedForThisDueDate) {
          meta.textContent = `📞 Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} — call to rebook`;
          meta.classList.add('backlog-overdue', 'backlog-needs-call');
        } else {
          meta.textContent = days < 0 ? `Overdue by ${Math.abs(days)} days`
            : days === 0 ? 'Due today' : `Due in ${days} days`;
          if (days <= 0) meta.classList.add('backlog-overdue');
        }
      } else {
        meta.textContent = job.address || 'Not booked yet';
      }
      body.appendChild(meta);
      row.appendChild(body);

      const bookBtn = document.createElement('button');
      bookBtn.type = 'button';
      bookBtn.className = 'btn btn-outline backlog-book';
      bookBtn.textContent = 'Book';
      // Drops it into the first free slot on the selected day, so the common
      // case is one tap; a specific time is chosen from the slot grid instead.
      bookBtn.addEventListener('click', () => bookIntoFirstFreeSlot(job));
      row.appendChild(bookBtn);

      backlogEl.appendChild(row);
    }
  }

  // One-tap Book. This used to walk whole hours from 8am looking for one that
  // was not the START of another job — which meant a job long enough to run
  // into a later booking sailed through the search, and a drive across the
  // region was not considered at all. Both mistakes were then caught (or
  // waved through) by the confirm dialog afterwards, which is the wrong place
  // to discover them: the tap is supposed to pick a time that works.
  //
  // Now it asks availability.js for the first slot that genuinely fits — the
  // job's real duration, the day's existing bookings, and the drive to and
  // from its neighbours. The confirm below stays as the safety net, and on a
  // day with nothing workable it says so instead of booking a bad time.
  async function bookIntoFirstFreeSlot(job) {
    const dayStart = new Date(selected).setHours(0, 0, 0, 0);
    const dayEnd = new Date(selected).setHours(23, 59, 59, 999);
    const mins = durationOf(job);

    let slot = null;
    if (window.Availability) {
      slot = window.Availability.nextFreeSlot({
        jobs,
        durationMins: mins,
        at: job,
        excludeJobId: job.id,
        from: dayStart,
        to: dayEnd,
        // The technician picked this day by tapping it. If the day has already
        // been, they are back-filling work that is done, so the clock is read
        // as that morning rather than every hour being refused for having
        // passed. On today, the clock is now, so gone hours are not offered.
        now: dayEnd < Date.now() ? dayStart : Date.now(),
        policy: 'advisory',
        config: Object.assign({}, AVAIL_CONFIG, {
          // The grid opens at 7 so an early start can be chosen deliberately;
          // one tap should not put a client in at 7 just because it is empty.
          hours: Object.keys(AVAIL_HOURS).reduce((acc, k) => {
            acc[k] = [BOOK_DEFAULT_START_HOUR, DAY_END_HOUR];
            return acc;
          }, {}),
        }),
      });
    }

    if (!slot) {
      toast(`No room on ${fmtDayLabel(selected)} for a ${fmtHours(mins)} job — pick a time from the grid or try another day`);
      return;
    }

    if (!(await confirmNoOverlap(job.id, slot.startAt, mins))) return;
    await DB.updateJob(job.id, { scheduledAt: slot.startAt, scheduledDurationMins: mins });
    toast(`${job.name} booked ${fmtDayLabel(selected)} at ${fmtTime(slot.startAt)}`);
    await refresh();
    offerBookingNotice(job.id);
  }

  // Shared by every booking path in this file. Returns true if it's clear to
  // book, or if the technician confirmed the clash anyway — a hard block
  // would be wrong here, since a genuine double-up (two technicians, or a
  // quick 10-minute drop-in alongside a long job) is a real thing that
  // happens; the point is that nobody books over another job without seeing
  // it first.
  async function confirmNoOverlap(jobId, scheduledAt, durationMins) {
    const clashes = await DB.getOverlappingJobs(scheduledAt, durationMins, jobId);
    if (clashes.length) {
      const names = clashes.map((j) => `${j.name} at ${fmtTime(j.scheduledAt)}`).join(', ');
      return askConfirm(
        `This clashes with ${clashes.length === 1 ? 'a job already booked' : `${clashes.length} jobs already booked`}: `
        + `${names}.\n\nBook it anyway?`,
        { title: 'Already booked at that time', okLabel: 'Book anyway' }
      );
    }
    // Nothing overlaps, but the day still has to be physically possible.
    // Two jobs half an hour apart on the clock and forty minutes apart on
    // the road is not a clash by any check this file had before — it is
    // simply a promise that cannot be kept, discovered on the drive.
    return confirmEnoughTravelTime(jobId, scheduledAt, durationMins);
  }

  async function confirmEnoughTravelTime(jobId, scheduledAt, durationMins) {
    // Every path out of here that is not a genuine warning returns true.
    // This is an advisory built on an estimate; it must never be the reason
    // a real booking cannot be made. The rebooking flow calls in with a null
    // jobId because the follow-up job does not exist yet, and an unguarded
    // DB.getJob(null) throwing here took the whole rebooking down with it.
    if (!jobId) return true;
    let candidate = null;
    try {
      candidate = await DB.getJob(jobId);
    } catch (e) {
      return true;
    }
    if (!hasCoords(candidate)) return true; // no coordinates, nothing to estimate

    const sameDayJobs = (await DB.getJobs()).filter((j) =>
      j.id !== jobId && j.scheduledAt && sameDay(j.scheduledAt, scheduledAt));

    const endsAt = scheduledAt + durationMins * 60000;
    const problems = [];
    for (const other of sameDayJobs) {
      const travel = travelMinutesBetween(other, candidate);
      if (travel === null) continue;
      const otherEnds = other.scheduledAt + durationOf(other) * 60000;
      // Whichever side of the candidate this job sits, the gap between them
      // has to cover the drive.
      const gapMins = other.scheduledAt >= endsAt
        ? Math.round((other.scheduledAt - endsAt) / 60000)
        : Math.round((scheduledAt - otherEnds) / 60000);
      if (gapMins >= 0 && gapMins < travel) {
        problems.push(`${other.name} at ${fmtTime(other.scheduledAt)} — about ${fmtTravel(travel)} away, `
          + `with ${fmtTravel(Math.max(0, gapMins))} between them`);
      }
    }
    if (!problems.length) return true;

    return askConfirm(
      `${problems.join('\n')}\n\nThese are estimates from the addresses, not live traffic.`,
      { title: 'Not enough time to get there', okLabel: 'Book anyway' }
    );
  }

  // ---------- a better order for the day ----------
  // Shows up only when there is genuinely something to save, because a button
  // that says "this is already the best order" every day is a button nobody
  // reads. routing.js does the arithmetic; everything here is about making
  // the trade-off visible before anything moves.
  const tidyBtn = el('scheduler-tidy');

  function renderTidyButton() {
    if (!tidyBtn) return;
    if (!window.Routing) { tidyBtn.classList.add('hidden'); return; }
    const result = window.Routing.optimiseDay({ jobs: jobsOn(selected), config: AVAIL_CONFIG });
    const worthIt = result.ok && !result.sameOrder && result.savingMins >= 10;
    tidyBtn.classList.toggle('hidden', !worthIt);
    if (worthIt) {
      tidyBtn.textContent = `Better order for this day — saves ${fmtTravel(result.savingMins)} driving`;
    }
  }

  async function proposeTidy() {
    const result = window.Routing.optimiseDay({ jobs: jobsOn(selected), config: AVAIL_CONFIG });
    if (!result.ok) {
      toast(window.Routing.REASONS[result.reason] || 'This day cannot be reordered.');
      return;
    }

    const lines = result.moves.map((m) =>
      `${m.toldClient ? '📞 ' : ''}${m.name}: ${fmtTime(m.fromAt)} → ${fmtTime(m.toAt)}`);

    // The phone calls are the cost of the saving, so they are stated as
    // plainly as the saving is. A technician who moves three clients without
    // noticing they had all been sent a time has been failed by this dialog,
    // not helped by it.
    let body = `${lines.join('\n')}\n\n`
      + `${fmtTravel(result.savingMins)} less driving. `
      + `Finishes ${fmtTravel(result.finishesEarlierMins)} earlier.`;
    if (result.alreadyToldCount) {
      body += `\n\n📞 ${result.alreadyToldCount === 1
        ? 'One of these clients has already been told their time'
        : `${result.alreadyToldCount} of these clients have already been told their time`}`
        + ' — you will need to ring them.';
    }

    const ok = await askConfirm(body, {
      title: 'Move these jobs?',
      okLabel: result.alreadyToldCount ? 'Move them anyway' : 'Use this order',
      danger: !!result.alreadyToldCount,
    });
    if (!ok) return;

    for (const m of result.moves) {
      await DB.updateJob(m.jobId, { scheduledAt: m.toAt });
    }
    toast(`Day reordered — ${fmtTravel(result.savingMins)} less driving`);
    await refresh();
  }

  if (tidyBtn) tidyBtn.addEventListener('click', proposeTidy);

  async function refresh() {
    jobs = await DB.getJobs();
    renderGrid();
    renderDay();
    renderTidyButton();
    renderBacklog();
  }

  prevBtn.addEventListener('click', () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    renderGrid();
  });
  nextBtn.addEventListener('click', () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    renderGrid();
  });
  todayBtn.addEventListener('click', () => {
    cursor = startOfDay(new Date());
    selected = startOfDay(new Date());
    renderGrid();
    renderDay();
    renderTidyButton();
  });
  backBtn.addEventListener('click', () => {
    view.classList.add('hidden');
    if (window.showJobListView) window.showJobListView();
  });
  pickerCancel.addEventListener('click', closePicker);
  pickerModal.addEventListener('click', (e) => { if (e.target === pickerModal) closePicker(); });

  window.Scheduler = {
    async open() {
      cursor = startOfDay(new Date());
      selected = startOfDay(new Date());
      await refresh();
      if (window.hideAllAppViews) window.hideAllAppViews();
      view.classList.remove('hidden');
    },
    refresh,
    // Exposed so every other booking path (the AI assistant, auto-rebook)
    // asks the same question with the same wording, instead of each writing
    // its own half of a conflict check.
    confirmNoOverlap,
    // Exposed for the suite: what the three drags end up doing.
    resizeJob,
    reschedule,
    // Exposed so the estimate itself can be tested against known distances,
    // rather than only through the booking flow that consumes it.
    travelMinutesBetween,
  };
})();
