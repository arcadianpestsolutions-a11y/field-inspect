// What clients asked the client page assistant for, waiting to be actioned.
//
// The assistant (portal-chat, migration 037) answers what it can from the
// client's own page. Everything a person has to do — ring someone back, book
// or move a visit, answer something it could not, take a complaint, follow up
// a referral — becomes a row in portal_requests, and this shows them. They
// live beside text-message replies under the bell in the Diary, because both
// are "a client said something and is waiting on us".
//
// A REFERRAL IS NOT ENTERED FOR YOU. The assistant collects the name and
// number; "Add as enquiry" makes the enquiry and the pending register entry,
// from here, by a person. No Edge Function writes the register (migration 035)
// and a model-filled form should not either without somebody looking at it.
//
// Every message the assistant sent is readable from each request ("Show the
// conversation"), because a business is answerable for what its assistant
// said in its name.
//
// EXPOSES: window.PortalInbox { render, renderRequests, KIND_LABELS }
(() => {
  'use strict';

  const { toast } = window.Common;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Same words as _shared/portal-chat.js KIND_LABELS (the suite checks).
  const KIND_LABELS = {
    callback: 'Asked for a call back',
    booking: 'Wants to book',
    reschedule: 'Wants to change a booking',
    question: 'Question for the team',
    complaint: 'Complaint',
    other: 'Message for the team',
    referral: 'Referred someone',
    unanswered: 'Assistant could not answer',
  };

  const canRead = () => !!(window.supabaseClient && !window.IS_TEST && !window.IS_DEMO);

  const when = (ts) => new Date(ts).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });

  // The real data source. Replaced by the suite, which has no server.
  const source = {
    async open() {
      if (!canRead()) return [];
      try {
        const { data, error } = await window.supabaseClient.from('portal_requests')
          .select('id, job_id, kind, summary, details, preferred_time, contact, referred, created_at')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(30);
        // A table that is not there yet (migration 037 not run) is "nothing
        // waiting", not an error on somebody's screen.
        return error ? [] : (data || []);
      } catch (e) { return []; }
    },
    async conversation(jobId) {
      if (!canRead()) return [];
      const { data, error } = await window.supabaseClient.from('portal_messages')
        .select('role, body, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true })
        .limit(60);
      if (error) throw error;
      return data || [];
    },
    async markDone(id, extra) {
      const uid = window.Sync && window.Sync.currentUserId ? window.Sync.currentUserId() : null;
      const now = Date.now();
      const { data, error } = await window.supabaseClient.from('portal_requests')
        .update({ status: 'done', done_at: now, done_by: uid, updated_at: now, ...(extra || {}) })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      // Refused by row-level security looks like success with nothing updated.
      if (Array.isArray(data) && data.length === 0) throw new Error('Not saved. Are you signed in to this business?');
    },
  };

  // Makes the enquiry, and the pending register entry when the job belongs
  // to a client record. Returns the lead.
  async function addAsEnquiry(req, job) {
    const r = req.referred || {};
    const who = (job && job.name) || 'a client';
    const lead = await DB.addLead({
      name: r.name || '',
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      source: 'Referral',
      notes: [`Referred by ${who} through the client page assistant.`, r.notes].filter(Boolean).join(' '),
    });
    if (job && job.clientId && window.ReferralsUI && window.ReferralsUI.recordForLead) {
      try { await window.ReferralsUI.recordForLead(lead, job.clientId); } catch (e) {
        if (window.ErrorLog) window.ErrorLog.note(e, 'portal inbox: referral register');
      }
    }
    return lead;
  }

  function line(label, value) {
    if (!value) return null;
    const p = el('p', 'reminders-text');
    p.appendChild(el('strong', '', `${label}: `));
    p.appendChild(document.createTextNode(value));
    return p;
  }

  // Draws the open requests into `container`. `deps` lets the suite supply
  // jobs and a fake source; the app passes nothing.
  async function renderRequests(container, requests, deps) {
    const d = deps || {};
    const src = d.source || source;
    const onChange = d.onChange || (() => render());
    container.innerHTML = '';
    if (!requests.length) return 0;

    let jobs = d.jobs;
    if (!jobs) { try { jobs = await DB.getJobs(); } catch (e) { jobs = []; } }

    container.appendChild(el('p', 'reminders-section-head',
      requests.length === 1 ? '1 request from the client page' : `${requests.length} requests from the client page`));

    for (const req of requests) {
      const job = jobs.find((j) => j.id === req.job_id) || null;
      const card = el('div', 'reminders-row portal-request');
      card.dataset.id = req.id;
      const top = el('div', 'reminders-row-head');
      top.appendChild(el('span', 'agenda-name', (job && job.name) || 'A client'));
      top.appendChild(el('span', 'agenda-meta', when(req.created_at)));
      card.appendChild(top);
      card.appendChild(el('p', 'reminders-stop-note', KIND_LABELS[req.kind] || KIND_LABELS.other));
      card.appendChild(el('p', 'reminders-text', req.summary || ''));
      if (req.details && req.details !== req.summary) card.appendChild(el('p', 'reminders-text', req.details));
      for (const node of [line('When', req.preferred_time), line('Contact', req.contact)]) if (node) card.appendChild(node);
      if (req.kind === 'referral' && req.referred) {
        const r = req.referred;
        for (const node of [line('Name', r.name), line('Phone', r.phone), line('Email', r.email), line('Where', r.address)]) {
          if (node) card.appendChild(node);
        }
      }

      const convo = el('div', 'portal-chat-log hidden');
      const actions = el('div', 'portal-request-actions');
      const btn = (text, cls, fn) => {
        const b = el('button', `btn ${cls}`, text);
        b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try { await fn(); } catch (e) {
            if (window.ErrorLog) window.ErrorLog.note(e, 'portal inbox');
            toast(e.message || 'That did not work. Try again.');
          }
          b.disabled = false;
        });
        actions.appendChild(b);
        return b;
      };

      if (req.kind === 'referral') {
        btn('Add as enquiry', 'btn-primary', async () => {
          const lead = await addAsEnquiry(req, job);
          await src.markDone(req.id, { lead_id: lead.id });
          toast(`${lead.name || 'The referral'} added to Enquiries`);
          await onChange();
          if (!d.source && window.LeadsUI && window.LeadsUI.openLead) {
            const panel = document.getElementById('reminders-panel');
            if (panel) panel.classList.add('hidden');
            window.LeadsUI.openLead(lead.id);
          }
        });
      }
      if (job && !d.source) {
        btn('Open job', 'btn-outline', async () => {
          const panel = document.getElementById('reminders-panel');
          if (panel) panel.classList.add('hidden');
          await window.showJobViewById(job.id);
        });
      }
      const show = btn('Show the conversation', 'btn-outline', async () => {
        if (!convo.classList.contains('hidden')) { convo.classList.add('hidden'); show.textContent = 'Show the conversation'; return; }
        const msgs = await src.conversation(req.job_id);
        convo.innerHTML = '';
        for (const m of msgs) {
          // textContent: what the client and the model wrote is shown, never run.
          const b = el('div', `portal-bubble ${m.role === 'client' ? 'client' : 'assistant'}`, m.body || '');
          b.title = when(m.created_at);
          convo.appendChild(b);
        }
        if (!msgs.length) convo.appendChild(el('p', 'reminders-text', 'No messages kept for this job.'));
        convo.classList.remove('hidden');
        show.textContent = 'Hide the conversation';
      });
      btn('Mark done', 'btn-secondary', async () => {
        await src.markDone(req.id);
        await onChange();
      });

      card.appendChild(actions);
      card.appendChild(convo);
      container.appendChild(card);
    }
    return requests.length;
  }

  // Draws into the reminders panel and returns how many are open, for the
  // bell's badge.
  async function render() {
    const container = document.getElementById('reminders-portal');
    if (!container) return 0;
    const open = await source.open();
    return renderRequests(container, open);
  }

  window.PortalInbox = { render, renderRequests, KIND_LABELS, _source: source };
})();
