// ---------------------------------------------------------------------------
// today-ui.js - the Today screen: today's jobs in order, what is next, where to
// drive, and what is still owed from earlier days.
//
// PURPOSE   Screen 1 for a technician in the field. The "All jobs" list answers
//           "what jobs exist?"; this answers "where do I need to be, and when?"
// EXPOSES   window.TodayUI = { render, setTab, getTab, tab names }
// DEPENDS   Today (today.js), DB, JobDetails (Call / Directions links, optional),
//           window.showJobViewById, window.Availability (travel, optional).
// TOUCHES   Reads jobs through DB.getJobs. Writes nothing except one
//           localStorage key remembering which tab was last open.
// TESTS     tests/run-tests.js - "Today" group.
//
// The panel and the Today / All jobs switch are built here rather than in
// index.html, so a stale cached page paired with this fresh script cannot leave
// the screen half-built. All text goes in with textContent.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const TAB_KEY = 'scope-home-tab';
  const TABS = { TODAY: 'today', ALL: 'all' };

  // The test suite's existing list tests look for job rows on the job list, so
  // under ?test=1 the list opens on All jobs unless a test asks for Today.
  const defaultTab = () => (window.IS_TEST ? TABS.ALL : TABS.TODAY);

  function getTab() {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === TABS.TODAY || saved === TABS.ALL) return saved;
    } catch (e) { /* storage blocked: fall through to the default */ }
    return defaultTab();
  }

  function setTab(tab) {
    const next = tab === TABS.ALL ? TABS.ALL : TABS.TODAY;
    try { localStorage.setItem(TAB_KEY, next); } catch (e) { /* not essential */ }
    apply();
    if (next === TABS.TODAY) render();
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function view() { return document.getElementById('view-joblist'); }

  // ---------- Structure: the switch and the panel, built once ----------
  function install() {
    const v = view();
    if (!v) return false;
    if (document.getElementById('today-panel')) return true;
    const content = v.querySelector('.content');
    if (!content) return false;

    const tabs = el('div', { id: 'home-tabs', class: 'home-tabs', role: 'tablist', 'aria-label': 'Home screen' }, [
      el('button', { type: 'button', id: 'home-tab-today', class: 'home-tab', role: 'tab', text: 'Today' }),
      el('button', { type: 'button', id: 'home-tab-all', class: 'home-tab', role: 'tab', text: 'All jobs' }),
    ]);
    tabs.querySelector('#home-tab-today').addEventListener('click', () => setTab(TABS.TODAY));
    tabs.querySelector('#home-tab-all').addEventListener('click', () => setTab(TABS.ALL));

    const panel = el('div', { id: 'today-panel', class: 'today-panel' });
    content.insertBefore(tabs, content.firstChild);
    const form = content.querySelector('#job-form');
    if (form && form.nextSibling) content.insertBefore(panel, form.nextSibling); else content.appendChild(panel);
    apply();
    return true;
  }

  function apply() {
    const v = view();
    if (!v) return;
    const tab = getTab();
    v.classList.toggle('home-today', tab === TABS.TODAY);
    const t = document.getElementById('home-tab-today');
    const a = document.getElementById('home-tab-all');
    if (t && a) {
      t.classList.toggle('active', tab === TABS.TODAY);
      a.classList.toggle('active', tab === TABS.ALL);
      t.setAttribute('aria-selected', String(tab === TABS.TODAY));
      a.setAttribute('aria-selected', String(tab === TABS.ALL));
    }
    // Tells the bottom tab bar which of its two list tabs to light.
    document.dispatchEvent(new Event('scope-hometab'));
  }

  // ---------- Rendering ----------
  const STATUS_WORD = { new: 'New', in_progress: 'In progress', review: 'Report review', completed: 'Done' };

  function openJob(job) {
    if (window.showJobViewById) window.showJobViewById(job.id);
  }

  function actionLabel(job) {
    switch (job.status) {
      case 'in_progress': return 'Continue';
      case 'review': return 'Report';
      case 'completed': return 'View';
      default: return 'Start';
    }
  }

  function linkButton(text, href, label) {
    const a = el('a', { class: 'today-btn', href, text, 'aria-label': label });
    if (/^https?:/.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    return a;
  }

  function jobCard(item, isNext) {
    const { job } = item;
    const T = window.Today;
    const card = el('div', { class: `today-item${isNext ? ' today-next' : ''}${item.done ? ' today-done' : ''}` });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', () => openJob(job));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJob(job); } });

    const timeCol = el('div', { class: 'today-time' }, [
      el('span', { class: 'today-start', text: T.timeLabel(item.startAt) }),
      el('span', { class: 'today-len', text: T.durationLabel(item.durationMins) }),
    ]);

    const head = el('div', { class: 'today-head' }, [
      el('span', { class: 'today-name', text: job.name || job.address || 'Unnamed job' }),
      el('span', { class: `status-badge small status-${window.HtmlSafe ? window.HtmlSafe.token(job.status, 'new') : 'new'}`, text: STATUS_WORD[job.status] || 'New' }),
    ]);
    const body = el('div', { class: 'today-body' }, [head]);
    if (isNext) body.insertBefore(el('span', { class: 'today-flag', text: item.active ? 'In progress now' : 'Next up' }), head);
    if (job.address) body.appendChild(el('span', { class: 'today-address', text: job.address }));

    // What the day looks like around this job, in plain words.
    const notes = [];
    if (item.overlaps) notes.push({ text: `Clashes with the job before it (${T.durationLabel(-item.gapMins)} overlap)`, level: 'warn' });
    else if (item.tight) notes.push({ text: `Tight: ${T.durationLabel(item.travelMins)} drive, only ${T.durationLabel(item.gapMins)} between jobs`, level: 'warn' });
    else if (item.travelMins !== null) notes.push({ text: `${T.durationLabel(item.travelMins)} drive from the job before`, level: '' });
    if (item.lateByMins) notes.push({ text: `Not started, ${T.durationLabel(item.lateByMins)} past its time`, level: 'late' });
    notes.forEach((n) => body.appendChild(el('span', { class: `today-note${n.level ? ' today-note-' + n.level : ''}`, text: n.text })));

    const actions = el('div', { class: 'today-actions' });
    const open = el('button', { type: 'button', class: 'today-btn today-btn-primary', text: actionLabel(job) });
    open.addEventListener('click', (e) => { e.stopPropagation(); openJob(job); });
    actions.appendChild(open);
    if (window.JobDetails) {
      const tel = window.JobDetails.telHref(job.clientPhone);
      if (tel) actions.appendChild(linkButton('Call', tel, `Call ${job.name || 'the client'}`));
      const dir = window.JobDetails.directionsUrl(job);
      if (dir) actions.appendChild(linkButton('Directions', dir, `Directions to ${job.address || job.name || 'the job'}`));
      // A link inside a tappable card must not also open the job.
      actions.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
    }
    body.appendChild(actions);

    card.appendChild(timeCol);
    card.appendChild(body);
    return card;
  }

  function dayLabel(ts) {
    return new Date(ts).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function summaryText(model) {
    const T = window.Today;
    const s = model.summary;
    if (!s.count) return 'Nothing booked today';
    const parts = [`${s.count} job${s.count === 1 ? '' : 's'}`];
    if (s.doneCount) parts.push(`${s.doneCount} done`);
    parts.push(`${T.timeLabel(s.firstAt)} to ${T.timeLabel(s.lastEndAt)}`);
    if (s.travelMins) parts.push(`about ${T.durationLabel(s.travelMins)} driving`);
    return parts.join(' · ');
  }

  function section(title) {
    return el('h2', { class: 'today-section-title', text: title });
  }

  function overdueRow(job) {
    const when = new Date(job.scheduledAt);
    const label = `${when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, ${window.Today.timeLabel(job.scheduledAt)}`;
    const row = el('div', { class: 'today-owed' }, [
      el('span', { class: 'today-owed-name', text: job.name || job.address || 'Unnamed job' }),
      el('span', { class: 'today-owed-when', text: `Was ${label} · ${STATUS_WORD[job.status] || 'New'}` }),
    ]);
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.addEventListener('click', () => openJob(job));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJob(job); } });
    return row;
  }

  function goAll(statusFilter) {
    setTab(TABS.ALL);
    const chip = document.querySelector(`.status-filter-chip[data-status="${statusFilter || 'all'}"]`);
    if (chip) chip.click();
  }

  function buildPanel(model, now) {
    const T = window.Today;
    const frag = document.createDocumentFragment();

    frag.appendChild(el('div', { class: 'today-header' }, [
      el('h2', { class: 'today-date', text: dayLabel(now) }),
      el('p', { class: 'today-summary', id: 'today-summary', text: summaryText(model) }),
    ]));

    if (model.items.length) {
      model.items.forEach((item) => frag.appendChild(jobCard(item, model.next === item)));
    } else {
      const empty = el('div', { class: 'today-empty card' }, [
        el('p', { text: 'Nothing is booked for today.' }),
      ]);
      const row = el('div', { class: 'row gap' });
      const add = el('button', { type: 'button', id: 'today-new-job', class: 'btn btn-primary flex1', text: '+ New job' });
      add.addEventListener('click', () => { const b = document.getElementById('new-job-btn'); if (b) b.click(); });
      const sched = el('button', { type: 'button', id: 'today-open-scheduler', class: 'btn btn-secondary flex1', text: 'Open diary' });
      sched.addEventListener('click', () => { const b = document.getElementById('open-scheduler-btn'); if (b) b.click(); });
      row.appendChild(add); row.appendChild(sched);
      empty.appendChild(row);
      frag.appendChild(empty);
    }

    if (model.overdue.length) {
      frag.appendChild(section('Still owed from earlier days'));
      model.overdue.forEach((job) => frag.appendChild(overdueRow(job)));
      if (model.overdueMore) frag.appendChild(el('p', { class: 'today-more', text: `and ${model.overdueMore} more in All jobs` }));
    }

    // Tomorrow, in one line, because that is when the reminders are for.
    const tm = model.tomorrow;
    const tomorrowLine = el('div', { class: 'today-tomorrow' });
    tomorrowLine.appendChild(el('span', {
      class: 'today-tomorrow-text',
      text: tm.length
        ? `Tomorrow: ${tm.length} job${tm.length === 1 ? '' : 's'}, first at ${T.timeLabel(tm[0].scheduledAt)}`
        : 'Nothing booked for tomorrow',
    }));
    const diary = el('button', { type: 'button', id: 'today-tomorrow-diary', class: 'link-btn', text: 'Diary' });
    diary.addEventListener('click', () => { const b = document.getElementById('open-scheduler-btn'); if (b) b.click(); });
    tomorrowLine.appendChild(diary);
    frag.appendChild(tomorrowLine);

    if (model.unbooked) {
      const u = el('button', {
        type: 'button', id: 'today-unbooked', class: 'link-btn today-unbooked',
        text: `${model.unbooked} new job${model.unbooked === 1 ? ' has' : 's have'} no time booked yet`,
      });
      u.addEventListener('click', () => goAll('new'));
      frag.appendChild(u);
    }
    return frag;
  }

  let rendering = false;
  let again = false;
  let pendingJobs;
  async function render(jobsOverride) {
    if (!install()) return;
    apply();
    if (getTab() !== TABS.TODAY) return;
    // A call that arrives mid-render is not dropped: the latest one wins and runs
    // as soon as the current one finishes.
    if (rendering) { again = true; pendingJobs = jobsOverride; return; }
    rendering = true;
    try {
      const jobs = Array.isArray(jobsOverride) ? jobsOverride : await window.DB.getJobs();
      const now = Date.now();
      const model = window.Today.build(jobs, now);
      // Jobs left to do today, for the badge on the Today tab.
      window.TodayUI.remaining = model.items.filter((it) => !it.done).length;
      document.dispatchEvent(new Event('scope-today-updated'));
      const panel = document.getElementById('today-panel');
      if (!panel) return;
      panel.textContent = '';
      panel.appendChild(buildPanel(model, now));
    } catch (err) {
      if (window.ErrorLog) window.ErrorLog.note(err, 'today: render');
      const panel = document.getElementById('today-panel');
      if (panel) {
        panel.textContent = '';
        panel.appendChild(el('p', { class: 'today-empty card', text: 'Could not build today. Your jobs are safe; open All jobs.' }));
      }
    } finally {
      rendering = false;
      if (again) { again = false; const next = pendingJobs; pendingJobs = undefined; render(next); }
    }
  }

  // While the screen is open, keep "next up" and "past its time" current.
  setInterval(() => {
    const panel = document.getElementById('today-panel');
    if (panel && panel.offsetParent !== null && !document.hidden) render();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    const panel = document.getElementById('today-panel');
    if (!document.hidden && panel && panel.offsetParent !== null) render();
  });

  window.TodayUI = { render, setTab, getTab, install, TABS, remaining: 0 };
})();
