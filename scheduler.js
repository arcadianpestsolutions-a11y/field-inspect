// Scheduler — a month diary over booked jobs, plus the backlog of work that
// is due or unbooked.
//
// The distinction this module exists to make: a job can be DUE (nextDueAt, set
// when a report is finalized) without being BOOKED (scheduledAt, set here).
// Everything already in the app tracked the first and none of the second, so
// forward work lived in someone's head. A diary that only shows confirmed
// bookings hides exactly the jobs you still have to do something about, so the
// backlog sits underneath the month rather than in a separate screen.
(() => {
  'use strict';

  const view = document.getElementById('view-scheduler');
  if (!view) { console.warn('[scheduler] view missing from the page'); return; }

  const el = (id) => document.getElementById(id);
  const backBtn = el('scheduler-back-btn');
  const titleEl = el('scheduler-month-label');
  const prevBtn = el('scheduler-prev');
  const nextBtn = el('scheduler-next');
  const todayBtn = el('scheduler-today');
  const gridEl = el('scheduler-grid');
  const agendaTitleEl = el('scheduler-agenda-title');
  const agendaEl = el('scheduler-agenda');
  const backlogEl = el('scheduler-backlog');
  const backlogCountEl = el('scheduler-backlog-count');

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));

  // Calendar maths works on local calendar days. Using UTC or toISOString here
  // would shift every booking by the timezone offset — the same class of bug
  // that was dating inspections a day early.
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const sameDay = (a, b) => dayKey(a) === dayKey(b);

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  let cursor = startOfDay(new Date());   // which month is shown
  let selected = startOfDay(new Date()); // which day the agenda shows
  let jobs = [];

  function fmtTime(ts) {
    const d = new Date(ts);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === '00' ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
  }

  function fmtDayLabel(d) {
    const today = startOfDay(new Date());
    const diff = Math.round((startOfDay(d) - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  }

  const typeIcon = (job) => (job.jobType === 'pest_treatment' ? '🧪' : '🐜');

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
    // Weeks run Monday-first, which is how a work diary reads.
    const leading = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

    const byDay = new Map();
    for (const job of jobs) {
      if (!job.scheduledAt) continue;
      const k = dayKey(job.scheduledAt);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(job);
    }

    for (let i = 0; i < leading; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-cell cal-blank';
      gridEl.appendChild(blank);
    }

    const today = startOfDay(new Date());
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      if (sameDay(date, today)) cell.classList.add('cal-today');
      if (sameDay(date, selected)) cell.classList.add('cal-selected');

      const num = document.createElement('span');
      num.className = 'cal-daynum';
      num.textContent = day;
      cell.appendChild(num);

      const dayJobs = byDay.get(dayKey(date)) || [];
      if (dayJobs.length) {
        const dots = document.createElement('span');
        dots.className = 'cal-dots';
        // Cap the dots so a busy day stays readable; the count carries the rest.
        dayJobs.slice(0, 3).forEach((j) => {
          const dot = document.createElement('span');
          dot.className = 'cal-dot' + (j.status === 'completed' ? ' cal-dot-done' : '');
          dot.title = j.name;
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
        if (dayJobs.length > 3) {
          const more = document.createElement('span');
          more.className = 'cal-more';
          more.textContent = `+${dayJobs.length - 3}`;
          cell.appendChild(more);
        }
      }

      cell.addEventListener('click', () => { selected = date; renderGrid(); renderAgenda(); });
      gridEl.appendChild(cell);
    }
  }

  // ---------- day agenda ----------
  function renderAgenda() {
    agendaTitleEl.textContent = fmtDayLabel(selected);
    agendaEl.innerHTML = '';

    const dayJobs = jobs
      .filter((j) => j.scheduledAt && sameDay(new Date(j.scheduledAt), selected))
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    if (!dayJobs.length) {
      agendaEl.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty-hint',
        textContent: 'Nothing booked for this day.',
      }));
      return;
    }

    for (const job of dayJobs) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'agenda-row';

      const time = document.createElement('span');
      time.className = 'agenda-time';
      time.textContent = fmtTime(job.scheduledAt);
      row.appendChild(time);

      const body = document.createElement('span');
      body.className = 'agenda-body';
      const name = document.createElement('span');
      name.className = 'agenda-name';
      name.textContent = `${typeIcon(job)} ${job.name}`;
      body.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'agenda-meta';
      meta.textContent = [job.address, `${job.scheduledDurationMins || 60} min`]
        .filter(Boolean).join(' · ');
      body.appendChild(meta);
      row.appendChild(body);

      const badge = document.createElement('span');
      badge.className = `status-badge status-${job.status || 'new'} small`;
      badge.textContent = DB.JOB_STATUS_LABELS[job.status] || 'New';
      row.appendChild(badge);

      row.addEventListener('click', () => {
        if (window.showJobViewById) window.showJobViewById(job.id);
      });
      agendaEl.appendChild(row);
    }
  }

  // ---------- backlog ----------
  // Two kinds of job need attention but are not in the diary: properties that
  // have come due for re-inspection, and jobs created but never booked. Both
  // are invisible on a calendar that only draws bookings, which is precisely
  // how work gets forgotten.
  function renderBacklog() {
    backlogEl.innerHTML = '';
    const now = Date.now();
    const soon = now + 30 * 24 * 60 * 60 * 1000;

    const items = jobs.filter((j) => {
      if (j.scheduledAt) return false;
      if (j.status === 'completed' && !j.nextDueAt) return false;
      if (j.nextDueAt) return j.nextDueAt <= soon;
      return j.status !== 'completed';
    }).sort((a, b) => (a.nextDueAt || a.createdAt) - (b.nextDueAt || b.createdAt));

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
        meta.textContent = 'Not booked yet';
      }
      body.appendChild(meta);
      row.appendChild(body);

      const bookBtn = document.createElement('button');
      bookBtn.type = 'button';
      bookBtn.className = 'btn btn-outline backlog-book';
      bookBtn.textContent = 'Book';
      bookBtn.addEventListener('click', () => bookJob(job));
      row.appendChild(bookBtn);

      backlogEl.appendChild(row);
    }
  }

  // Books onto the day currently selected in the grid, defaulting to 9am —
  // the technician picks the day by tapping it, which is fewer taps than a
  // date picker and keeps the diary as the thing being manipulated.
  async function bookJob(job) {
    const when = new Date(selected);
    when.setHours(9, 0, 0, 0);
    // If that slot is taken, step forward an hour until it is free.
    const taken = new Set(jobs.filter((j) => j.scheduledAt && sameDay(new Date(j.scheduledAt), selected))
      .map((j) => new Date(j.scheduledAt).getHours()));
    while (taken.has(when.getHours()) && when.getHours() < 17) when.setHours(when.getHours() + 1);

    await DB.updateJob(job.id, { scheduledAt: when.getTime() });
    toast(`${job.name} booked for ${fmtDayLabel(selected)} at ${fmtTime(when.getTime())}`);
    await refresh();
  }

  async function refresh() {
    jobs = await DB.getJobs();
    renderGrid();
    renderAgenda();
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
    renderAgenda();
  });
  backBtn.addEventListener('click', () => {
    view.classList.add('hidden');
    if (window.showJobListView) window.showJobListView();
  });

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
