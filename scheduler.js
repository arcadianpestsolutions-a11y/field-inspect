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

  const el = (id) => document.getElementById(id);
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

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));

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

      cell.addEventListener('click', () => { selected = date; renderGrid(); renderDay(); });
      gridEl.appendChild(cell);
    }
  }

  // ---------- day timeslot grid ----------
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

    // Which hours a job occupies, so a 2-hour job greys out the hour after it
    // instead of looking like that hour is free.
    const occupiedBy = new Map();
    for (const job of list) {
      const start = new Date(job.scheduledAt);
      const startHour = start.getHours();
      const spans = Math.max(1, Math.ceil(durationOf(job) / 60));
      for (let i = 0; i < spans; i++) {
        const h = startHour + i;
        if (!occupiedBy.has(h)) occupiedBy.set(h, { job, isStart: i === 0 });
      }
    }

    // Anything booked outside working hours still has to be visible.
    const outOfHours = list.filter((j) => {
      const h = new Date(j.scheduledAt).getHours();
      return h < DAY_START_HOUR || h >= DAY_END_HOUR;
    });

    for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour++) {
      const row = document.createElement('div');
      row.className = 'slot-row';

      const label = document.createElement('span');
      label.className = 'slot-hour';
      label.textContent = fmtHour(hour);
      row.appendChild(label);

      const entry = occupiedBy.get(hour);
      if (entry && entry.isStart) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-job';
        const name = document.createElement('span');
        name.className = 'slot-job-name';
        name.textContent = `${typeIcon(entry.job)} ${entry.job.name}`;
        btn.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'slot-job-meta';
        meta.textContent = [fmtTime(entry.job.scheduledAt), `${durationOf(entry.job)} min`, entry.job.address]
          .filter(Boolean).join(' · ');
        btn.appendChild(meta);
        btn.addEventListener('click', () => {
          if (window.showJobViewById) window.showJobViewById(entry.job.id);
        });
        row.appendChild(btn);
      } else if (entry) {
        const cont = document.createElement('span');
        cont.className = 'slot-continued';
        cont.textContent = `↳ ${entry.job.name} continues`;
        row.appendChild(cont);
      } else {
        const free = document.createElement('button');
        free.type = 'button';
        free.className = 'slot-free';
        free.textContent = '+ Book this slot';
        free.addEventListener('click', () => openPicker(hour));
        row.appendChild(free);
      }

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

  function openPicker(hour) {
    pendingSlotHour = hour;
    pickerTitle.textContent = `Book ${fmtHour(hour)}, ${fmtDayLabel(selected)}`;
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
      btn.addEventListener('click', () => bookInto(job, hour));
      pickerList.appendChild(btn);
    }
    pickerModal.classList.remove('hidden');
  }

  function closePicker() {
    pickerModal.classList.add('hidden');
    pendingSlotHour = null;
  }

  async function bookInto(job, hour) {
    const when = new Date(selected);
    when.setHours(hour, 0, 0, 0);
    const mins = parseInt(pickerDuration.value, 10) || 60;
    await DB.updateJob(job.id, { scheduledAt: when.getTime(), scheduledDurationMins: mins });
    closePicker();
    toast(`${job.name} booked ${fmtDayLabel(selected)} at ${fmtHour(hour)} (${mins} min)`);
    await refresh();
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
        meta.textContent = days < 0 ? `Overdue by ${Math.abs(days)} days`
          : days === 0 ? 'Due today' : `Due in ${days} days`;
        if (days <= 0) meta.classList.add('backlog-overdue');
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

  async function bookIntoFirstFreeSlot(job) {
    const taken = new Set();
    for (const j of jobsOn(selected)) {
      const h = new Date(j.scheduledAt).getHours();
      for (let i = 0; i < Math.ceil(durationOf(j) / 60); i++) taken.add(h + i);
    }
    let hour = BOOK_DEFAULT_START_HOUR;
    while (taken.has(hour) && hour < DAY_END_HOUR - 1) hour++;
    const when = new Date(selected);
    when.setHours(hour, 0, 0, 0);
    await DB.updateJob(job.id, { scheduledAt: when.getTime(), scheduledDurationMins: durationOf(job) });
    toast(`${job.name} booked ${fmtDayLabel(selected)} at ${fmtHour(hour)}`);
    await refresh();
  }

  async function refresh() {
    jobs = await DB.getJobs();
    renderGrid();
    renderDay();
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
  };
})();
