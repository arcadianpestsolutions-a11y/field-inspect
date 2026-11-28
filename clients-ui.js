// The client list and one client's record.
//
// What a client screen is actually for is answering "what have we done for
// these people" without reading the whole job list. So the record itself is
// four fields and the rest of the screen is derived: their properties, their
// jobs, and when they are next due.
//
// Editing a client here does NOT rewrite their old jobs, and that is the
// point rather than a limitation — see clients.js and migration 029. A
// finalised report is a compliance document; correcting a phone number must
// not change what was signed last year.
(() => {
  'use strict';

  const listView = document.getElementById('view-clients');
  const clientView = document.getElementById('view-client');
  if (!listView || !clientView) return;

  const { el } = window.Common;
  const listEl = el('clients-list');
  const searchEl = el('clients-search');
  const subtitleEl = el('clients-subtitle');
  const titleEl = el('client-title');
  const clientSubtitleEl = el('client-subtitle');
  const fieldsEl = el('client-fields');
  const propsEl = el('client-properties');
  const jobsEl = el('client-jobs');

  const { escapeHtml, toast, askConfirm } = window.Common;

  let current = null;
  let values = {};
  let allClients = [];
  // Offboarded customers (v162) are kept but out of the way: hidden unless asked for.
  let showOffboarded = false;
  const offboarded = (c) => !!(c && c.archivedAt);

  const CLIENT_SECTION = {
    id: 'client',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'email', label: 'Email', type: 'text' },
      {
        id: 'address', label: 'Billing address', type: 'text',
        // Said in the label, because the obvious assumption is that this is
        // where the work happens — and for a strata manager with properties
        // all over Macarthur it emphatically is not.
        placeholder: 'Where to send the invoice — not the job site',
      },
      { id: 'notes', label: 'Notes', type: 'textarea' },
    ],
  };

  const renderer = window.FormRender.create({ values, container: fieldsEl });

  function show(view) {
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  const { fmtDay: fmtDate } = window.Common;

  // ---------- the list ----------
  async function openList() {
    allClients = await DB.getClients();
    renderList();
    show(listView);
  }

  function matches(client, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return [client.name, client.phone, client.email, client.address]
      .some((v) => String(v || '').toLowerCase().includes(q));
  }

  async function renderList() {
    const jobs = await DB.getJobs();
    const query = (searchEl.value || '').trim();
    const active = allClients.filter((c) => !offboarded(c));
    const gone = allClients.length - active.length;
    // Offboarded ones, when shown, sit together at the bottom under their own
    // heading, right where the toggle is (v163: they were mixed in by name,
    // far from the button that revealed them).
    const shown = active.filter((c) => matches(c, query))
      .concat(showOffboarded ? allClients.filter((c) => offboarded(c) && matches(c, query)) : []);

    subtitleEl.textContent = allClients.length
      ? `${active.length} ${active.length === 1 ? 'client' : 'clients'}${gone ? ` · ${gone} offboarded` : ''}`
      : '';

    listEl.innerHTML = '';
    if (!allClients.length) {
      listEl.innerHTML = '<p class="empty-hint">No clients yet. One is created automatically when you '
        + 'book a job for somebody new, or add one here.</p>';
      return;
    }
    const toggle = () => {
      if (!gone) return;
      const t = document.createElement('button');
      t.type = 'button';
      t.id = 'clients-offboarded-toggle';
      t.className = 'link-btn clients-offboarded-toggle';
      t.textContent = showOffboarded ? 'Hide offboarded customers' : `Show offboarded customers (${gone})`;
      t.addEventListener('click', () => { showOffboarded = !showOffboarded; renderList(); });
      listEl.appendChild(t);
    };
    if (!shown.length) {
      listEl.innerHTML = `<p class="empty-hint">Nothing matching “${escapeHtml(query)}”.</p>`;
      toggle();
      return;
    }

    let headed = false;
    for (const client of shown) {
      if (offboarded(client) && !headed) {
        headed = true;
        const h = document.createElement('li');
        h.className = 'clients-offboarded-heading';
        h.textContent = 'Offboarded customers';
        listEl.appendChild(h);
      }
      const summary = window.Clients.summarise(client, jobs);
      const li = document.createElement('li');
      li.className = 'report-section-item';
      const where = summary.properties.length === 1
        ? summary.properties[0].address
        : `${summary.properties.length} properties`;
      if (offboarded(client)) li.classList.add('client-offboarded');
      li.innerHTML = `
        <span class="section-icon" style="background:#1f7a4d">👤</span>
        <span class="section-info">
          <span class="section-name">${escapeHtml(window.Clients.labelFor(client))}</span>
          <span class="section-sub">${escapeHtml([
            summary.jobCount ? `${summary.jobCount} ${summary.jobCount === 1 ? 'job' : 'jobs'}` : 'no jobs yet',
            summary.properties.length ? where : '',
            offboarded(client) ? `Offboarded${client.archivedReason ? ': ' + client.archivedReason : ''}` : '',
          ].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="section-status ${summary.nextDueAt && summary.nextDueAt < Date.now() ? 'status-dot-yellow' : 'status-dot-green'}">›</span>`;
      li.addEventListener('click', () => openClient(client.id));
      listEl.appendChild(li);
    }
    toggle();
  }

  // Offboard / Bring back on the client record (v162). Built here so a stale
  // cached page without the button still opens the record.
  function renderOffboardControls() {
    const bar = clientView.querySelector('.action-bar');
    if (!bar || !current) return;
    let b = document.getElementById('client-offboard-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'client-offboard-btn';
      b.type = 'button';
      b.className = 'btn btn-secondary full client-offboard-btn';
      bar.appendChild(b);
      b.addEventListener('click', async () => {
        if (!current || !window.FollowUpsUI) return;
        const id = current.id;
        const done = offboarded(current) ? await window.FollowUpsUI.bringBack(id) : await window.FollowUpsUI.offboardClient(id);
        if (done) await openClient(id);
      });
    }
    b.textContent = offboarded(current) ? 'Bring back as a customer' : 'Offboard customer';
    let note = document.getElementById('client-offboarded-note');
    if (offboarded(current)) {
      if (!note) {
        note = document.createElement('p');
        note.id = 'client-offboarded-note';
        note.className = 'client-offboarded-note';
        fieldsEl.parentNode.insertBefore(note, fieldsEl);
      }
      note.textContent = `Offboarded ${fmtDate(current.archivedAt)}${current.archivedReason ? ' — ' + current.archivedReason : ''}. `
        + 'Hidden from your client list and Follow-ups, and not sent due reminders.';
    } else if (note) {
      note.remove();
    }
  }

  // ---------- one client ----------
  async function openClient(id) {
    current = await DB.getClient(id);
    if (!current) { toast('That client is no longer here.'); return openList(); }

    values = {
      name: current.name, phone: current.phone, email: current.email,
      address: current.address, notes: current.notes,
    };
    renderer.setValues(values);
    renderer.renderSection(CLIENT_SECTION);

    const jobs = await DB.getJobs();
    const summary = window.Clients.summarise(current, jobs);

    titleEl.textContent = window.Clients.labelFor(current);
    clientSubtitleEl.textContent = summary.jobCount
      ? `${summary.jobCount} ${summary.jobCount === 1 ? 'job' : 'jobs'}`
        + (summary.nextDueAt ? ` · next due ${fmtDate(summary.nextDueAt)}` : '')
      : 'No jobs yet';

    // Properties, derived from their jobs rather than kept as a second list
    // that would need keeping in step. Same reasoning as the station register.
    propsEl.innerHTML = summary.properties.length
      ? summary.properties.map((p) => `
          <li class="report-section-item">
            <span class="section-icon" style="background:#7c3aed">🏠</span>
            <span class="section-info">
              <span class="section-name">${escapeHtml(p.address)}</span>
              <span class="section-sub">${p.jobs} ${p.jobs === 1 ? 'visit' : 'visits'} · last ${escapeHtml(fmtDate(p.lastAt))}</span>
            </span>
          </li>`).join('')
      : '<p class="empty-hint">No addresses yet — they appear as jobs are booked.</p>';

    jobsEl.innerHTML = '';
    if (!summary.jobs.length) {
      jobsEl.innerHTML = '<p class="empty-hint">No jobs for this client yet.</p>';
    }
    for (const job of summary.jobs) {
      const li = document.createElement('li');
      li.className = 'report-section-item';
      li.innerHTML = `
        <span class="section-icon" style="background:${job.jobType === 'pest_treatment' ? '#166534' : '#b45309'}">${job.jobType === 'pest_treatment' ? '🧪' : '🐜'}</span>
        <span class="section-info">
          <span class="section-name">${escapeHtml(job.address || job.name || 'Job')}</span>
          <span class="section-sub">${escapeHtml(historyLine(job))}</span>
        </span>
        <span class="section-status status-dot-green">›</span>`;
      li.addEventListener('click', () => {
        if (window.showJobViewById) window.showJobViewById(job.id);
      });
      jobsEl.appendChild(li);
    }

    renderOffboardControls();
    show(clientView);
  }

  const FIELDS = ['name', 'phone', 'email', 'address', 'notes'];
  const typed = () => Object.fromEntries(FIELDS.map((k) => [k, (values && values[k]) || '']));
  const changed = () => FIELDS.some((k) => String((values && values[k]) || '') !== String(current[k] || ''));

  // What a history row says (v163): what the job was, where it stands, and
  // the date that matters for it. It used to repeat the address and show the
  // day the job was typed in, so a job booked for today read "17 Nov".
  function historyLine(job) {
    const what = job.jobType === 'pest_treatment' ? 'Pest treatment' : 'Termite inspection';
    const status = (DB.JOB_STATUS_LABELS && DB.JOB_STATUS_LABELS[job.status]) || job.status || '';
    let when = '';
    if (job.inspectionEndedAt) when = `done ${fmtDate(job.inspectionEndedAt)}`;
    else if (job.scheduledAt && job.status !== 'completed') when = `booked ${fmtDate(job.scheduledAt)}`;
    else if (job.scheduledAt) when = fmtDate(job.scheduledAt);
    else if (job.createdAt) when = `added ${fmtDate(job.createdAt)}`;
    return [what, status, when].filter(Boolean).join(' · ');
  }

  async function save() {
    const before = Object.assign({}, current);
    current = await DB.saveClient(Object.assign({}, current, typed()));
    const updated = await carryContactToOpenJobs(before, current);
    toast(updated ? `Client saved, and ${updated} upcoming ${updated === 1 ? 'job' : 'jobs'} updated` : 'Client saved');
    await openList();
  }

  // A new phone or email reaches the jobs still to come (v164). The office-
  // admin test changed a number here and the booked job kept the old one, so
  // the booking email and reminders would have gone to the old contact.
  // Finished jobs are left alone on purpose (see clients.js: a report that
  // went out keeps saying what it said). Asks first, because a job can have
  // a different contact on purpose (a tenant, a property manager).
  async function carryContactToOpenJobs(before, after) {
    const phoneChanged = String(before.phone || '') !== String(after.phone || '') && after.phone;
    const emailChanged = String(before.email || '') !== String(after.email || '') && after.email;
    if (!phoneChanged && !emailChanged) return 0;
    const open = (await DB.getJobsForClient(after.id)).filter((j) => j.status !== 'completed'
      && ((phoneChanged && j.clientPhone !== after.phone) || (emailChanged && j.clientEmail !== after.email)));
    if (!open.length) return 0;
    const what = [phoneChanged && 'phone number', emailChanged && 'email'].filter(Boolean).join(' and ');
    const ok = await askConfirm(
      `${open.length === 1 ? 'Their upcoming job still has' : `${open.length} upcoming jobs still have`} the old ${what}. `
      + 'Booking details and reminders go to the contact on the job. Finished jobs and sent reports are not changed.',
      { title: `Use the new ${what} on upcoming jobs?`, okLabel: 'Update them', cancelLabel: 'Leave them' },
    );
    if (!ok) return 0;
    for (const j of open) {
      const patch = {};
      if (phoneChanged) patch.clientPhone = after.phone;
      if (emailChanged) patch.clientEmail = after.email;
      await DB.updateJob(j.id, patch);
    }
    return open.length;
  }

  async function removeClient() {
    if (!(await window.Common.adminOnlyDelete('a client'))) return;
    const jobs = await DB.getJobsForClient(current.id);
    const ok = await askConfirm(
      jobs.length
        ? `${window.Clients.labelFor(current)} has ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}. `
          + 'The jobs and their reports are kept — they simply stop being grouped under this client.'
        : 'This client has no jobs.',
      { title: 'Delete this client?', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    const client = current;
    current = null;
    // Held back for ten seconds with an Undo (undo-delete.js). The jobs are only
    // unlinked from this client when the delete really happens.
    await openList();
    await window.UndoDelete.start({
      kind: 'client',
      ids: [client.id],
      message: `${window.Clients ? window.Clients.labelFor(client) : (client.name || 'Client')} deleted`,
      commit: () => DB.deleteClient(client.id),
      refresh: async () => { if (!listView.classList.contains('hidden')) await openList(); },
    });
  }

  // One at a time: a second tap before the first finishes made a second blank client.
  let creatingClient = false;
  async function newClient() {
    if (creatingClient) return;
    creatingClient = true;
    try {
      const created = await DB.addClient({ name: '' });
      await openClient(created.id);
    } finally {
      creatingClient = false;
    }
  }

  // "+ New client" creates the record at once. Backing out with nothing typed
  // (and no jobs hanging off it) must not leave a blank client in the list.
  async function leaveClient() {
    if (current) {
      const empty = !['name', 'phone', 'email', 'address', 'notes']
        .some((k) => String((values && values[k]) || '').trim() || String(current[k] || '').trim());
      if (empty && !(await DB.getJobsForClient(current.id)).length) {
        await DB.deleteClient(current.id);
        current = null;
      } else if (changed()) {
        // Back keeps what was typed (v157), the way the invoice screen does.
        // It used to drop a corrected phone number without a word.
        current = await DB.saveClient(Object.assign({}, current, typed()));
        toast('Client saved');
      }
    }
    await openList();
  }

  searchEl.addEventListener('input', renderList);
  el('client-save-btn').addEventListener('click', save);
  el('client-delete-btn').addEventListener('click', removeClient);
  el('client-new-btn').addEventListener('click', newClient);
  el('client-back-btn').addEventListener('click', leaveClient);
  el('clients-back-btn').addEventListener('click', () => {
    if (window.showJobListView) window.showJobListView();
  });

  const openBtn = document.getElementById('open-clients-btn');
  if (openBtn) openBtn.addEventListener('click', openList);

  window.ClientsUI = { open: openList, openClient, currentId: () => (current && current.id) || null, CLIENT_SECTION };
})();
