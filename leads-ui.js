// The lead board, and the list of people to ring.
//
// The board is second. What opens first is "these need chasing today",
// because a pipeline is only worth keeping if it tells somebody what to do
// next — a board nobody acts on is a board nobody updates, and an out-of-date
// pipeline is worse than none because it gets believed.
//
// The arithmetic is pipeline.js. The fields are drawn by form-render.js, the
// same renderer the reports and the safety statements use.
(() => {
  'use strict';

  const boardView = document.getElementById('view-leads');
  const leadView = document.getElementById('view-lead');
  if (!boardView || !leadView) return;

  const el = (id) => document.getElementById(id);
  const boardEl = el('leads-board');
  const dueEl = el('leads-due');
  const subtitleEl = el('leads-subtitle');
  const titleEl = el('lead-title');
  const leadSubtitleEl = el('lead-subtitle');
  const fieldsEl = el('lead-fields');
  const stagesEl = el('lead-stages');
  const dueBannerEl = el('lead-due-banner');

  const escapeHtml = (s) => (window.FormRender ? window.FormRender.escapeHtml(s) : String(s == null ? '' : s));
  const money = (cents) => (window.Invoicing ? window.Invoicing.formatMoney(cents) : `$${((cents || 0) / 100).toFixed(2)}`);
  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));

  let current = null;
  let values = {};

  // The enquiry itself, as a schema so the shared renderer draws it. Short on
  // purpose: this is filled in with a phone against one ear.
  const LEAD_SECTION = {
    id: 'lead',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'email', label: 'Email', type: 'text' },
      { id: 'address', label: 'Address', type: 'text' },
      {
        id: 'jobType', label: 'What they want', type: 'select',
        options: ['termite', 'pest_treatment'],
      },
      {
        id: 'source', label: 'How they found you', type: 'select',
        // Knowing which of these works is the only way to decide whether to
        // keep paying for it.
        options: ['Google', 'Facebook', 'Referral', 'Repeat client', 'Sign or vehicle', 'Walk-up', 'Other'],
      },
      { id: 'quotedText', label: 'Quoted amount', type: 'text', placeholder: 'e.g. 450' },
      { id: 'notes', label: 'Notes', type: 'textarea' },
    ],
  };

  const renderer = window.FormRender.create({ values, container: fieldsEl });

  function show(view) {
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  const stageLabel = (key) => {
    const s = window.Pipeline.STAGES.find((x) => x.key === key);
    return s ? s.label : key;
  };

  // ---------- the board ----------
  async function openBoard() {
    const leads = await DB.getLeads();
    const summary = window.Pipeline.summarise({ leads });

    subtitleEl.textContent = summary.openCount
      ? `${summary.openCount} open · ${money(summary.forecastCents)} forecast`
      : 'Nothing open';

    // The chase list first, and only when there is one.
    dueEl.classList.toggle('hidden', !summary.due.length);
    if (summary.due.length) {
      dueEl.innerHTML = `
        <h2 class="leads-due-title">${summary.due.length === 1 ? '1 to chase' : `${summary.due.length} to chase`}</h2>
        <ul class="leads-due-list">
          ${summary.due.slice(0, 8).map((d) => `
            <li class="leads-due-item${d.urgency === 'high' ? ' leads-due-high' : ''}" data-lead="${escapeHtml(d.lead.id)}">
              <span class="leads-due-name">${escapeHtml(d.lead.name || 'Enquiry')}</span>
              <span class="leads-due-why">${escapeHtml(d.text)}</span>
            </li>`).join('')}
        </ul>`;
      for (const item of dueEl.querySelectorAll('.leads-due-item')) {
        item.addEventListener('click', () => openLead(item.dataset.lead));
      }
    }

    boardEl.innerHTML = '';
    for (const stage of window.Pipeline.STAGES) {
      const bucket = summary.byStage[stage.key];
      // Won and lost only appear once there is something in them — an empty
      // "Lost" column on a new board is a discouraging thing to ship somebody.
      if (!bucket.leads.length && !stage.open) continue;

      const group = document.createElement('div');
      group.className = 'lead-column';
      group.innerHTML = `
        <h2 class="business-heading">${escapeHtml(stage.label)}
          <span class="lead-count">${bucket.leads.length}</span>
          ${bucket.valueCents ? `<span class="lead-value">${escapeHtml(money(bucket.valueCents))}</span>` : ''}
        </h2>`;

      if (!bucket.leads.length) {
        group.insertAdjacentHTML('beforeend', `<p class="empty-hint lead-empty">${escapeHtml(stage.hint)}</p>`);
      }
      for (const lead of bucket.leads) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'lead-card';
        card.innerHTML = `
          <span class="lead-card-name">${escapeHtml(lead.name || 'Enquiry')}</span>
          <span class="lead-card-meta">${escapeHtml([lead.address, lead.source].filter(Boolean).join(' · ') || 'No details yet')}</span>
          ${lead.quotedCents ? `<span class="lead-card-value">${escapeHtml(money(lead.quotedCents))}</span>` : ''}`;
        card.addEventListener('click', () => openLead(lead.id));
        group.appendChild(card);
      }
      boardEl.appendChild(group);
    }

    if (!leads.length) {
      boardEl.innerHTML = '<p class="empty-hint">No enquiries yet. Add one when the phone rings — '
        + 'it is the ones that never get written down that never get called back.</p>';
    }
    show(boardView);
  }

  // ---------- one lead ----------
  async function openLead(id) {
    current = await DB.getLead(id);
    if (!current) { toast('That enquiry is no longer here.'); return openBoard(); }

    values = {
      name: current.name, phone: current.phone, email: current.email,
      address: current.address, jobType: current.jobType, source: current.source,
      quotedText: current.quotedCents != null ? (current.quotedCents / 100).toFixed(2) : '',
      notes: current.notes,
    };
    renderer.setValues(values);
    renderer.renderSection(LEAD_SECTION);

    titleEl.textContent = current.name || 'Enquiry';
    leadSubtitleEl.textContent = stageLabel(current.stage);

    const due = window.Pipeline.followUpFor(current, {});
    dueBannerEl.classList.toggle('hidden', !due);
    if (due) {
      dueBannerEl.className = `card leads-due${due.urgency === 'high' ? ' leads-due-high' : ''}`;
      dueBannerEl.textContent = due.text;
    }

    renderStages();
    el('lead-convert-btn').classList.toggle('hidden', !window.Pipeline.isOpen(current.stage));
    show(leadView);
  }

  function renderStages() {
    stagesEl.innerHTML = '';
    for (const stage of window.Pipeline.STAGES) {
      if (stage.key === 'won') continue; // won happens through the convert button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stage-btn' + (current.stage === stage.key ? ' active' : '');
      btn.textContent = stage.label;
      btn.addEventListener('click', () => setStage(stage.key));
      stagesEl.appendChild(btn);
    }
  }

  // Saving the fields and the stage together, because they are edited
  // together and two save buttons on one screen is one too many.
  async function persist(extra) {
    const cents = Math.round(parseFloat(String(values.quotedText || '').replace(/[^0-9.]/g, '')) * 100);
    current = await DB.saveLead(Object.assign({}, current, {
      name: values.name || '',
      phone: values.phone || '',
      email: values.email || '',
      address: values.address || '',
      jobType: values.jobType || 'termite',
      source: values.source || '',
      notes: values.notes || '',
      quotedCents: Number.isFinite(cents) ? cents : null,
    }, extra || {}));
    return current;
  }

  async function setStage(stage) {
    if (current.stage === stage) return;
    const extra = { stage, stageChangedAt: Date.now() };
    // Moving it forward counts as having done something, which is what the
    // follow-up clock measures. Without this, quoting somebody would leave
    // them reading as "spoken to three weeks ago" forever.
    if (stage === 'contacted') extra.lastContactedAt = Date.now();
    if (stage === 'lost') {
      const why = await (window.Dialog && window.Dialog.prompt
        ? window.Dialog.prompt('Why did this one go?', '', { title: 'Lost', okLabel: 'Save' })
        : Promise.resolve(''));
      if (why === null) return;
      extra.lostReason = why || '';
    }
    await persist(extra);
    renderStages();
    leadSubtitleEl.textContent = stageLabel(current.stage);
    el('lead-convert-btn').classList.toggle('hidden', !window.Pipeline.isOpen(current.stage));
    dueBannerEl.classList.add('hidden');
    toast(`Moved to ${stageLabel(stage)}`);
  }

  async function convert() {
    const ok = await askConfirm(
      `${current.name || 'This enquiry'} becomes a job, and the enquiry is kept against it.`,
      { title: 'Book it as a job?', okLabel: 'Create the job' }
    );
    if (!ok) return;
    await persist({});
    const job = await DB.addJob(window.Pipeline.jobFromLead(current));
    await DB.saveLead(Object.assign({}, current, {
      stage: 'won', stageChangedAt: Date.now(), convertedJobId: job.id,
    }));
    toast('Job created — book it a time in the scheduler');
    if (window.showJobViewById) await window.showJobViewById(job.id);
  }

  // ---------- actions ----------
  // tel: and sms: are the phone's own apps. Marking the lead contacted here
  // is a guess — the app cannot know whether they answered — but a guess that
  // is almost always right beats making somebody tap twice for the same act.
  async function callThem() {
    if (!values.phone) { toast('No phone number on this enquiry.'); return; }
    await persist({ lastContactedAt: Date.now() });
    window.location.href = `tel:${String(values.phone).replace(/[^0-9+]/g, '')}`;
  }

  async function textThem() {
    if (!values.phone) { toast('No phone number on this enquiry.'); return; }
    await persist({
      lastFollowUpAt: Date.now(),
      followUpCount: (current.followUpCount || 0) + 1,
    });
    window.location.href = `sms:${String(values.phone).replace(/[^0-9+]/g, '')}`;
  }

  async function snooze() {
    await persist({ snoozedUntil: Date.now() + 7 * 86400000 });
    toast('Back on the list in a week');
    dueBannerEl.classList.add('hidden');
  }

  async function newLead() {
    const lead = await DB.addLead({ name: '' });
    await openLead(lead.id);
  }

  async function removeLead() {
    const ok = await askConfirm(
      `${current.name || 'This enquiry'} will be deleted. If it became a job, the job stays.`,
      { title: 'Delete this enquiry?', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    await DB.deleteLead(current.id);
    current = null;
    toast('Enquiry deleted');
    await openBoard();
  }

  el('lead-new-btn').addEventListener('click', newLead);
  el('lead-delete-btn').addEventListener('click', removeLead);
  el('lead-convert-btn').addEventListener('click', convert);
  el('lead-call-btn').addEventListener('click', callThem);
  el('lead-text-btn').addEventListener('click', textThem);
  el('lead-snooze-btn').addEventListener('click', snooze);
  el('leads-back-btn').addEventListener('click', () => {
    if (window.showJobListView) window.showJobListView();
  });
  // Back saves. The fields here are a name and a phone number taken down
  // mid-call; losing them to a back button would be indefensible.
  el('lead-back-btn').addEventListener('click', async () => {
    if (current) await persist({});
    await openBoard();
  });

  const openBtn = document.getElementById('open-leads-btn');
  if (openBtn) openBtn.addEventListener('click', openBoard);

  window.LeadsUI = { open: openBoard, openLead, LEAD_SECTION };
})();
