// Follow-ups screen: who is due, who is overdue, what happened last time they
// were rung, and who to let go. Plus the line on the home screen that says
// how many are waiting, and offboarding (also used by the client record).
//
// Built here rather than in index.html, like every late addition, so a stale
// cached page paired with this script degrades to "no follow-ups button"
// rather than an error. All client text goes in with textContent.
//
// Nothing here sends anything. Call and Text open the phone's own dialler and
// messages app with the number (and a suggested message) filled in; the
// technician presses send.
//
// EXPOSES: window.FollowUpsUI = { open, refreshBanner, offboardClient, bringBack, counts }
(() => {
  'use strict';

  const F = window.FollowUps;
  if (!F) { console.warn('[followups-ui] followups.js not loaded'); return; }
  const { toast, askConfirm } = window.Common;
  const DAY = 86400000;

  let tab = 'overdue';
  let view = null;

  const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = (ts) => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, cls, onClick, id) {
    const b = el('button', `btn ${cls || 'btn-secondary'}`, text);
    b.type = 'button';
    if (id) b.dataset.action = id;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- the screen ----------
  function build() {
    if (view) return view;
    view = document.getElementById('view-followups');
    if (view) return view;
    view = el('section', 'view hidden');
    view.id = 'view-followups';
    const top = el('header', 'topbar');
    const back = el('button', 'icon-btn', '←');
    back.id = 'followups-back-btn';
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', () => { if (window.showJobListView) window.showJobListView(); });
    const title = el('div', 'topbar-title');
    title.append(el('h1', '', 'Follow-ups'), Object.assign(el('span', 'subtitle'), { id: 'followups-subtitle' }));
    top.append(back, title);
    const main = el('main', 'content');
    const tabs = el('div', 'followups-tabs');
    tabs.id = 'followups-tabs';
    tabs.setAttribute('role', 'tablist');
    const list = el('div', 'followups-list');
    list.id = 'followups-list';
    main.append(tabs, list);
    view.append(top, main);
    document.body.appendChild(view);
    return view;
  }

  async function load() {
    const [jobs, clients] = await Promise.all([DB.getJobs(), DB.getClients()]);
    return { jobs, clients };
  }

  async function open(which) {
    build();
    if (which) tab = which;
    await render();
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  async function render() {
    const { jobs, clients } = await load();
    const now = Date.now();
    const items = F.dueItems(jobs, clients, now);
    const suggest = F.offboardSuggestions(jobs, clients, now);
    const groups = {
      overdue: items.filter((i) => i.level === 'overdue'),
      soon: items.filter((i) => i.level === 'soon'),
      snoozed: items.filter((i) => i.level === 'snoozed'),
      cleanup: suggest,
    };
    const TABS = [
      ['overdue', 'Overdue'], ['soon', 'Due in 30 days'], ['snoozed', 'Snoozed'], ['cleanup', 'Clean up'],
    ];
    const sub = document.getElementById('followups-subtitle');
    if (sub) sub.textContent = groups.overdue.length ? `${plural(groups.overdue.length, 'customer')} overdue` : 'Nobody overdue';

    const tabsEl = document.getElementById('followups-tabs');
    tabsEl.textContent = '';
    for (const [key, label] of TABS) {
      const b = el('button', `status-filter-chip${tab === key ? ' active' : ''}${key === 'overdue' && groups.overdue.length ? ' followups-chip-bad' : ''}`, `${label} (${groups[key].length})`);
      b.type = 'button';
      b.dataset.tab = key;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === key));
      b.addEventListener('click', () => { tab = key; render(); });
      tabsEl.appendChild(b);
    }

    const list = document.getElementById('followups-list');
    list.textContent = '';
    const shown = groups[tab] || [];
    if (!shown.length) {
      list.appendChild(el('p', 'empty-hint', {
        overdue: 'Nobody is overdue. Customers appear here the day their next service falls due.',
        soon: 'Nobody falls due in the next 30 days.',
        snoozed: 'Nobody is snoozed.',
        cleanup: 'Nobody looks inactive. Customers show here after "not interested", "moved away", months of no reply, or two years with no work.',
      }[tab]));
      return;
    }
    if (tab === 'cleanup') {
      list.appendChild(el('p', 'followups-hint', 'These customers look finished with. Offboarding hides them from your client list and follow-ups and stops their reminders. Their jobs and reports are kept, and you can bring them back any time.'));
      for (const s of shown) list.appendChild(cleanupCard(s));
      return;
    }
    for (const item of shown) list.appendChild(card(item));
  }

  function nameOf(item) {
    return (item.client && window.Clients ? window.Clients.labelFor(item.client) : '') || item.job.name || item.job.address || 'Customer';
  }
  const phoneOf = (item) => String((item.client && item.client.phone) || item.job.clientPhone || '').trim();

  function card(item) {
    const { job } = item;
    const c = el('div', `followup-card followup-${item.level}`);
    const head = el('div', 'followup-head');
    head.append(el('span', 'followup-name', nameOf(item)));
    const when = item.level === 'overdue'
      ? (item.daysOverdue === 0 ? 'due today' : `${plural(item.daysOverdue, 'day')} overdue`)
      : item.level === 'soon' ? `due in ${plural(item.daysUntil, 'day')}`
        : `snoozed until ${fmtShort(item.snoozedUntil)}`;
    head.append(el('span', `followup-when followup-when-${item.level}`, when));
    c.appendChild(head);
    if (job.address) c.appendChild(el('div', 'followup-address', job.address));
    c.appendChild(el('div', 'followup-what', `${item.what} · due ${fmtDay(item.dueAt)}`));

    const chase = item.last
      ? `${plural(item.attempts, 'try', 'tries')} · last ${fmtShort(item.last.at)}: ${(F.outcome(item.last.outcome) || { label: item.last.outcome }).label}${item.last.note ? ' (' + item.last.note + ')' : ''}`
      : 'Not contacted yet';
    c.appendChild(el('div', 'followup-chase', chase));
    if (item.reminderEmailed) c.appendChild(el('div', 'followup-tag', 'Reminder email already sent'));

    const row1 = el('div', 'followup-actions');
    const phone = phoneOf(item);
    const tel = window.JobDetails && window.JobDetails.telHref ? window.JobDetails.telHref(phone) : (phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '');
    if (tel) {
      const a = el('a', 'btn btn-primary', 'Call');
      a.href = tel;
      a.dataset.action = 'followup-call';
      row1.appendChild(a);
      const t = el('a', 'btn btn-secondary', 'Text');
      t.href = `sms:${phone.replace(/[^0-9+]/g, '')}?&body=${encodeURIComponent(suggestedText(item))}`;
      t.dataset.action = 'followup-text';
      row1.appendChild(t);
    } else {
      row1.appendChild(el('span', 'followup-nophone', 'No phone number on file'));
    }
    row1.appendChild(btn('Book', 'btn-outline', () => book(item), 'followup-book'));
    c.appendChild(row1);

    const row2 = el('div', 'followup-actions followup-actions-small');
    row2.appendChild(btn('Log a call', 'btn-secondary', () => logCall(item, c), 'followup-log'));
    if (item.level === 'snoozed') row2.appendChild(btn('Unsnooze', 'btn-secondary', () => unsnooze(item), 'followup-unsnooze'));
    else row2.appendChild(btn('Snooze', 'btn-secondary', () => snooze(item, c), 'followup-snooze'));
    row2.appendChild(btn('Offboard', 'btn-secondary followup-offboard', () => offboardFromItem(item), 'followup-offboard'));
    c.appendChild(row2);
    return c;
  }

  function suggestedText(item) {
    const org = window.Org ? window.Org.get() : {};
    const biz = (window.Org && window.Org.businessName()) || 'us';
    const first = String(nameOf(item)).split(/\s+/)[0];
    const what = item.what.toLowerCase();
    return `Hi ${first}, it's ${biz}. Your ${what}${item.job.address ? ' at ' + item.job.address : ''} is ${item.level === 'overdue' ? 'now due' : 'coming up'}. `
      + `Would you like us to book a time? Just reply here${org.phone ? ' or call ' + org.phone : ''}.`;
  }

  async function book(item) {
    if (!window.rebookJob) { if (window.showJobViewById) window.showJobViewById(item.job.id); return; }
    // Logged only once it is really booked: a clash can be cancelled.
    const next = await window.rebookJob(item.job.id);
    if (!next) return;
    const fresh = await DB.getJob(item.job.id);
    if (fresh) await DB.updateJob(fresh.id, { followUp: F.logged(fresh, 'booked', '') });
  }

  function chooser(cardEl, title, options, onPick) {
    const old = cardEl.querySelector('.followup-chooser');
    if (old) { old.remove(); return; }
    const box = el('div', 'followup-chooser');
    box.appendChild(el('p', 'followup-chooser-title', title));
    const note = el('input', 'followup-note');
    note.type = 'text';
    note.maxLength = 300;
    note.placeholder = 'Note (optional)';
    if (options[0] && options[0].withNote) box.appendChild(note);
    for (const o of options) {
      const b = btn(o.label, 'btn-secondary', () => { box.remove(); onPick(o, note.value.trim()); }, o.key);
      box.appendChild(b);
    }
    box.appendChild(btn('Cancel', 'btn-secondary followup-cancel', () => box.remove(), 'followup-cancel'));
    cardEl.appendChild(box);
  }

  function logCall(item, cardEl) {
    const opts = F.OUTCOMES.map((o, i) => Object.assign({}, o, { withNote: i === 0 }));
    chooser(cardEl, 'How did it go?', opts, async (o, note) => {
      const fresh = await DB.getJob(item.job.id);
      if (!fresh) return;
      await DB.updateJob(fresh.id, { followUp: F.logged(fresh, o.key, note) });
      if (o.key === 'booked') { await window.rebookJob(fresh.id); return; }
      if (o.offboard) {
        await render();
        await offboardFromItem(Object.assign({}, item, { job: await DB.getJob(fresh.id) }), o.label);
        return;
      }
      toast(o.snoozeDays ? `Logged. It comes back in ${plural(o.snoozeDays, 'day')}.` : 'Logged.');
      await render();
      refreshBanner();
    });
  }

  function snooze(item, cardEl) {
    chooser(cardEl, 'Put it off for', [
      { key: 'snooze-7', label: '1 week', days: 7 },
      { key: 'snooze-14', label: '2 weeks', days: 14 },
      { key: 'snooze-30', label: '1 month', days: 30 },
      { key: 'snooze-90', label: '3 months', days: 90 },
    ], async (o) => {
      const fresh = await DB.getJob(item.job.id);
      await DB.updateJob(fresh.id, { followUp: F.snoozed(fresh, o.days) });
      toast(`Snoozed until ${fmtShort(Date.now() + o.days * DAY)}.`);
      await render();
      refreshBanner();
    });
  }

  async function unsnooze(item) {
    const fresh = await DB.getJob(item.job.id);
    const f = Object.assign({}, fresh.followUp || {});
    delete f.snoozedUntil;
    await DB.updateJob(fresh.id, { followUp: f });
    await render();
    refreshBanner();
  }

  // ---------- offboarding ----------
  async function offboardFromItem(item, reason) {
    if (item.client) return offboardClient(item.client.id, reason);
    // A job with no client record: only this property's chase stops.
    const ok = await askConfirm(
      `${nameOf(item)} will stop showing in Follow-ups and will not be sent due reminders. The job and its report are kept. `
      + 'You can start chasing again from the job.',
      { title: 'Stop following up?', okLabel: 'Stop following up' });
    if (!ok) return;
    const fresh = await DB.getJob(item.job.id);
    await DB.updateJob(fresh.id, { followUp: F.stopped(fresh, reason || 'Stopped by hand') });
    toast('No longer followed up.');
    await afterChange();
  }

  async function offboardClient(clientId, reason) {
    const client = await DB.getClient(clientId);
    if (!client) return false;
    const label = window.Clients ? window.Clients.labelFor(client) : (client.name || 'This customer');
    const why = reason || await pickReason(label);
    if (!why) return false;
    const ok = reason ? await askConfirm(
      `${label} will be hidden from your client list and Follow-ups, and will not be sent due reminders. `
      + 'Their jobs and reports are kept, and you can bring them back from Clients any time.',
      { title: `Offboard ${label}?`, okLabel: 'Offboard' }) : true;
    if (!ok) return false;
    const now = Date.now();
    await DB.saveClient(Object.assign({}, client, { archivedAt: now, archivedReason: why }));
    for (const job of await DB.getJobsForClient(clientId)) {
      if (job.nextDueAt && !(job.followUp && job.followUp.stoppedAt)) {
        await DB.updateJob(job.id, { followUp: F.stopped(job, 'Customer offboarded', now) });
      }
    }
    toast(`${label} offboarded.`);
    await afterChange();
    return true;
  }

  // The reason, asked as a short list with "Other" for anything else.
  function pickReason(label) {
    return new Promise((resolve) => {
      const overlay = el('div', 'tester-feedback');
      overlay.setAttribute('role', 'dialog');
      const box = el('div', 'tester-feedback-card');
      box.appendChild(el('h2', '', `Offboard ${label}?`));
      box.appendChild(el('p', 'tester-feedback-sub', 'They are hidden from your client list and Follow-ups and are not sent due reminders. Their jobs and reports are kept, and you can bring them back from Clients any time.'));
      box.appendChild(el('p', 'tester-feedback-label', 'Why?'));
      const done = (v) => { overlay.remove(); resolve(v); };
      for (const r of ['Not interested', 'Sold or moved away', 'No reply for months', 'Went with another company', 'Other']) {
        const b = btn(r, 'btn-secondary full followup-reason', () => done(r), 'offboard-reason');
        box.appendChild(b);
      }
      box.appendChild(btn('Cancel', 'btn-secondary full followup-cancel', () => done(''), 'offboard-cancel'));
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  async function bringBack(clientId) {
    const client = await DB.getClient(clientId);
    if (!client) return false;
    const next = Object.assign({}, client);
    next.archivedAt = null;
    next.archivedReason = '';
    await DB.saveClient(next);
    for (const job of await DB.getJobsForClient(clientId)) {
      if (job.followUp && job.followUp.stoppedReason === 'Customer offboarded') {
        await DB.updateJob(job.id, { followUp: F.resumed(job) });
      }
    }
    toast(`${window.Clients ? window.Clients.labelFor(next) : 'Customer'} is back on your books.`);
    await afterChange();
    return true;
  }

  function cleanupCard(s) {
    const c = el('div', 'followup-card followup-cleanup');
    const head = el('div', 'followup-head');
    head.append(el('span', 'followup-name', window.Clients ? window.Clients.labelFor(s.client) : (s.client.name || 'Customer')));
    head.append(el('span', 'followup-when', plural(s.jobs, 'job')));
    c.appendChild(head);
    c.appendChild(el('div', 'followup-chase', s.reason));
    const row = el('div', 'followup-actions');
    row.appendChild(btn('Offboard', 'btn-primary', () => offboardClient(s.client.id), 'cleanup-offboard'));
    row.appendChild(btn('Open client', 'btn-secondary', () => { if (window.ClientsUI) window.ClientsUI.openClient(s.client.id); }, 'cleanup-open'));
    c.appendChild(row);
    return c;
  }

  async function afterChange() {
    if (view && !view.classList.contains('hidden')) await render();
    refreshBanner();
  }

  // ---------- More menu + home screen line ----------
  function addMoreItem() {
    if (document.getElementById('open-followups-btn')) return;
    const panel = document.querySelector('#more-sheet .more-sheet-panel');
    if (!panel) return;
    const b = el('button', 'more-item');
    b.id = 'open-followups-btn';
    b.innerHTML = '<span>📞</span> Follow-ups <span class="followups-badge hidden" id="followups-more-badge"></span>';
    b.addEventListener('click', () => open('overdue'));
    panel.insertBefore(b, panel.firstChild);
  }

  async function counts() {
    const { jobs, clients } = await load();
    return F.counts(jobs, clients, Date.now());
  }

  async function refreshBanner() {
    try {
      const host = document.querySelector('#view-joblist main.content');
      if (!host || !window.DB) return;
      const n = await counts();
      const badge = document.getElementById('followups-more-badge');
      if (badge) { badge.textContent = String(n.overdue); badge.classList.toggle('hidden', !n.overdue); }
      let bar = document.getElementById('followups-banner');
      if (!n.overdue && !n.soon) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = el('div', 'card followups-banner');
        bar.id = 'followups-banner';
        bar.setAttribute('role', 'status');
        const text = el('div', 'followups-banner-text');
        text.id = 'followups-banner-text';
        const go = btn('Follow up', 'btn-primary', () => open(bar.dataset.tab || 'overdue'), 'followups-banner-open');
        go.id = 'followups-banner-btn';
        bar.append(text, go);
        host.insertBefore(bar, host.firstChild);
      }
      bar.dataset.tab = n.overdue ? 'overdue' : 'soon';
      bar.classList.toggle('followups-banner-bad', n.overdue > 0);
      const parts = [];
      if (n.overdue) parts.push(`${plural(n.overdue, 'customer')} overdue for their service`);
      if (n.soon) parts.push(`${n.soon} due in the next 30 days`);
      document.getElementById('followups-banner-text').textContent = `📞 ${parts.join(' · ')}`;
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'follow-ups banner');
    }
  }

  function start() {
    build();
    addMoreItem();
    const list = document.getElementById('view-joblist');
    if (list) {
      let queued = false;
      new MutationObserver(() => {
        if (queued || list.classList.contains('hidden')) return;
        queued = true;
        setTimeout(() => { queued = false; refreshBanner(); }, 300);
      }).observe(list, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBanner(); });
    setTimeout(refreshBanner, 1500);
  }

  window.FollowUpsUI = { open, render, refreshBanner, offboardClient, bringBack, counts };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
