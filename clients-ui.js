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

  const el = (id) => document.getElementById(id);
  const listEl = el('clients-list');
  const searchEl = el('clients-search');
  const subtitleEl = el('clients-subtitle');
  const titleEl = el('client-title');
  const clientSubtitleEl = el('client-subtitle');
  const fieldsEl = el('client-fields');
  const propsEl = el('client-properties');
  const jobsEl = el('client-jobs');

  const escapeHtml = window.HtmlSafe.escape;
  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));

  let current = null;
  let values = {};
  let allClients = [];

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

  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

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
    const shown = allClients.filter((c) => matches(c, query));

    subtitleEl.textContent = allClients.length
      ? `${allClients.length} ${allClients.length === 1 ? 'client' : 'clients'}`
      : '';

    listEl.innerHTML = '';
    if (!allClients.length) {
      listEl.innerHTML = '<p class="empty-hint">No clients yet. One is created automatically when you '
        + 'book a job for somebody new, or add one here.</p>';
      return;
    }
    if (!shown.length) {
      listEl.innerHTML = `<p class="empty-hint">Nothing matching “${escapeHtml(query)}”.</p>`;
      return;
    }

    for (const client of shown) {
      const summary = window.Clients.summarise(client, jobs);
      const li = document.createElement('li');
      li.className = 'report-section-item';
      const where = summary.properties.length === 1
        ? summary.properties[0].address
        : `${summary.properties.length} properties`;
      li.innerHTML = `
        <span class="section-icon" style="background:#1f7a4d">👤</span>
        <span class="section-info">
          <span class="section-name">${escapeHtml(window.Clients.labelFor(client))}</span>
          <span class="section-sub">${escapeHtml([
            summary.jobCount ? `${summary.jobCount} ${summary.jobCount === 1 ? 'job' : 'jobs'}` : 'no jobs yet',
            summary.properties.length ? where : '',
          ].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="section-status ${summary.nextDueAt && summary.nextDueAt < Date.now() ? 'status-dot-yellow' : 'status-dot-green'}">›</span>`;
      li.addEventListener('click', () => openClient(client.id));
      listEl.appendChild(li);
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
          <span class="section-sub">${escapeHtml([job.status, fmtDate(job.inspectionEndedAt || job.createdAt)].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="section-status status-dot-green">›</span>`;
      li.addEventListener('click', () => {
        if (window.showJobViewById) window.showJobViewById(job.id);
      });
      jobsEl.appendChild(li);
    }

    show(clientView);
  }

  async function save() {
    current = await DB.saveClient(Object.assign({}, current, {
      name: values.name || '',
      phone: values.phone || '',
      email: values.email || '',
      address: values.address || '',
      notes: values.notes || '',
    }));
    toast('Client saved');
    await openList();
  }

  async function removeClient() {
    const jobs = await DB.getJobsForClient(current.id);
    const ok = await askConfirm(
      jobs.length
        ? `${window.Clients.labelFor(current)} has ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}. `
          + 'The jobs and their reports are kept — they simply stop being grouped under this client.'
        : 'This client has no jobs.',
      { title: 'Delete this client?', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    await DB.deleteClient(current.id);
    current = null;
    toast('Client deleted');
    await openList();
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

  window.ClientsUI = { open: openList, openClient, CLIENT_SECTION };
})();
