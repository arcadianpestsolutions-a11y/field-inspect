// ---------------------------------------------------------------------------
// tabbar.js - the bottom tab bar: Today, Jobs, Diary, Enquiries, More.
//
// PURPOSE   The main places in the app used to be two emoji icons in the header
//           and a "..." menu. A bar at the bottom puts them under the thumb and
//           always shows where you are.
// EXPOSES   window.TabBar = { tabFor, TOP_VIEWS, update, go }
// DEPENDS   TodayUI (the Today / All jobs choice), window.showJobListView, and the
//           existing header buttons (#open-scheduler-btn, #open-leads-btn,
//           #open-more-btn), which are still the code that opens those screens:
//           the bar presses them rather than duplicating what they do.
// TESTS     tests/run-tests.js - "Tab bar" group.
//
// Shown only on the top-level screens. On a job, a report, an invoice, an
// enquiry and so on it is hidden, because those are places you drill into and
// come back from, and the bar there would only crowd the work. It also steps
// aside while a text box has the keyboard open.
// Built here rather than in index.html so a stale cached page paired with this
// fresh script cannot leave a half-built screen.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // Which tab is lit on each top-level screen. 'joblist' is decided by the
  // Today / All jobs choice, so it is resolved in tabFor().
  const TOP_VIEWS = {
    'view-joblist': 'joblist',
    'view-scheduler': 'diary',
    'view-leads': 'leads',
    'view-clients': 'more',
    'view-swms-list': 'more',
    'view-assets': 'more',
    'view-business': 'more',
    'view-archive': 'more',
  };

  const TABS = [
    { id: 'today', label: 'Today', icon: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 15l2 2 4-4' },
    { id: 'jobs', label: 'Jobs', icon: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
    { id: 'diary', label: 'Diary', icon: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 13h2M14 13h2M8 17h2' },
    { id: 'leads', label: 'Enquiries', icon: 'M4 13l2.5-7h11L20 13M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M4 13h4l1 2h6l1-2h4' },
    { id: 'more', label: 'More', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
  ];

  // Which view is on screen right now, among the top-level ones. Null on a
  // drill-in screen, the login screen, or anything else.
  function currentTopView() {
    const shown = Array.from(document.querySelectorAll('.view')).filter((v) => !v.classList.contains('hidden'));
    if (shown.length !== 1) return null;
    return TOP_VIEWS[shown[0].id] ? shown[0].id : null;
  }

  // Pure: which tab is active for a given top-level view id and home tab.
  function tabFor(viewId, homeTab) {
    const t = TOP_VIEWS[viewId];
    if (!t) return null;
    if (t === 'joblist') return homeTab === 'all' ? 'jobs' : 'today';
    return t;
  }

  function homeTab() {
    return window.TodayUI ? window.TodayUI.getTab() : 'today';
  }

  let bar = null;

  function build() {
    if (bar || !document.body) return;
    bar = document.createElement('nav');
    bar.id = 'tab-bar';
    bar.className = 'tab-bar hidden';
    bar.setAttribute('aria-label', 'Main');
    TABS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `tab-${t.id}`;
      b.className = 'tab-btn';
      b.setAttribute('data-tab', t.id);
      b.setAttribute('aria-label', t.label);
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'tab-icon');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', t.icon);
      svg.appendChild(path);
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = t.label;
      b.appendChild(svg);
      b.appendChild(label);
      if (t.id === 'today') {
        const badge = document.createElement('span');
        badge.id = 'tab-today-badge';
        badge.className = 'tab-badge hidden';
        b.appendChild(badge);
      }
      b.addEventListener('click', () => go(t.id));
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  function press(id) {
    const b = document.getElementById(id);
    if (b) b.click();
  }

  // Go to a tab. The opener buttons it presses are the ones that always opened
  // these screens; they hide whatever else is showing before showing their own.
  function go(tab) {
    if (tab === 'today' || tab === 'jobs') {
      if (window.TodayUI) window.TodayUI.setTab(tab === 'jobs' ? 'all' : 'today');
      // Re-showing the list also closes anything left open on it and scrolls to the top.
      if (window.showJobListView) window.showJobListView();
    } else if (tab === 'diary') {
      if (currentTopView() !== 'view-scheduler') press('open-scheduler-btn');
    } else if (tab === 'leads') {
      if (currentTopView() !== 'view-leads') press('open-leads-btn');
    } else if (tab === 'more') {
      // The sheet lives on the job list, so get there first.
      if (currentTopView() !== 'view-joblist' && window.showJobListView) window.showJobListView();
      press('open-more-btn');
    }
    update();
  }

  function update() {
    build();
    if (!bar) return;
    const viewId = currentTopView();
    // While the More sheet is open, More is where you are.
    const sheetOpen = !!document.querySelector('#more-sheet:not(.hidden)');
    const active = sheetOpen ? 'more' : (viewId ? tabFor(viewId, homeTab()) : null);
    const show = !!viewId;
    bar.classList.toggle('hidden', !show);
    document.body.classList.toggle('has-tabbar', show);
    bar.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.getAttribute('data-tab') === active;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const badge = document.getElementById('tab-today-badge');
    if (badge) {
      const left = window.TodayUI && typeof window.TodayUI.remaining === 'number' ? window.TodayUI.remaining : 0;
      badge.textContent = left > 9 ? '9+' : String(left);
      badge.classList.toggle('hidden', left <= 0);
    }
  }

  // ---------- Keep it in step with the screen ----------
  // Watching class changes on the views catches every route in or out, including
  // ones added later, without each screen having to tell the bar.
  function watch() {
    const observer = new MutationObserver(() => update());
    document.querySelectorAll('.view').forEach((v) => observer.observe(v, { attributes: true, attributeFilter: ['class'] }));
    const sheet = document.getElementById('more-sheet');
    if (sheet) observer.observe(sheet, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('scope-hometab', update);
    document.addEventListener('scope-today-updated', update);
    // Out of the way while typing: with the keyboard up, a bar on top of it
    // eats a quarter of the visible screen.
    const typing = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      && !/^(checkbox|radio|range|button|submit|file)$/.test(el.type || '');
    document.addEventListener('focusin', (e) => { if (typing(e.target)) document.body.classList.add('tabbar-typing'); });
    document.addEventListener('focusout', () => {
      setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('tabbar-typing'); }, 120);
    });
  }

  function start() { build(); watch(); update(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.TabBar = { tabFor, TOP_VIEWS, TABS, update, go };
})();
