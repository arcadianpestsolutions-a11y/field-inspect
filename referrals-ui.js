// The referral register (v121): the screen under More, and the bookkeeping
// that keeps each referral's status true. The rules are in referrals.js.
//
//   evaluate()          pending -> earned once the referred person has paid;
//                       earned -> pending if that payment is taken back.
//   afterSync()         asks Xero what has been paid (at most every half
//                       hour), then evaluates. Called by sync.js.
//   availableFor(inv)   earned credits owed to the client this invoice is for.
//   applyTo(inv)        puts them on the invoice as credit lines -> credited.
//   reconcileInvoice()  a credit line removed from an invoice goes back to
//                       earned, so the $50 is never lost and never paid twice.
//   recordForLead()     an enquiry marked "Referral" with who referred them.
//
// EXPOSES: window.ReferralsUI

(() => {
  'use strict';

  const R = window.Referrals;
  if (!R) { console.warn('[referrals-ui] referrals.js not loaded'); return; }

  const el = (id) => document.getElementById(id);
  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));
  const escapeHtml = window.HtmlSafe ? window.HtmlSafe.escape : (s) => String(s);
  const money = (c) => (window.Invoicing ? window.Invoicing.formatMoney(c) : `$${(c / 100).toFixed(2)}`);
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const askConfirm = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));
  const askPrompt = (msg, def, opts) => (window.Dialog ? window.Dialog.prompt(msg, def, opts) : Promise.resolve(window.prompt(msg, def)));

  // ---------- keeping statuses true ----------
  async function evaluate() {
    const [refs, jobs, leads, invoices] = await Promise.all([
      DB.getReferrals(), DB.getJobs(), DB.getLeads(), DB.getAllInvoices(),
    ]);
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const newlyEarned = [];
    for (const ref of refs) {
      if (ref.status === 'pending') {
        const inv = R.earningInvoice(ref, { jobs, leads, invoices });
        if (!inv) continue;
        const job = jobs.find((j) => j.id === inv.jobId);
        const saved = await DB.saveReferral({
          ...ref,
          status: 'earned',
          earnedAt: inv.paidAt || Date.now(),
          earnedInvoiceId: inv.id,
          referredJobId: ref.referredJobId || (job ? job.id : null),
        });
        newlyEarned.push(saved);
      } else if (ref.status === 'earned' && ref.earnedInvoiceId) {
        // The payment that earned it was taken back (marked unpaid by hand).
        const inv = byId.get(ref.earnedInvoiceId);
        if (inv && !R.isPaid(inv) && !R.earningInvoice({ ...ref, status: 'pending' }, { jobs, leads, invoices })) {
          await DB.saveReferral({ ...ref, status: 'pending', earnedAt: null, earnedInvoiceId: null });
        }
      }
    }
    return { newlyEarned };
  }

  const XERO_CHECK_KEY = 'scope-xero-status-checked-at';
  const XERO_CHECK_EVERY = 30 * 60 * 1000;

  async function afterSync() {
    if (window.IS_DEMO || window.IS_TEST) return;
    let last = 0;
    try { last = Number(localStorage.getItem(XERO_CHECK_KEY)) || 0; } catch (e) { /* private mode */ }
    if (window.Xero && window.Xero.refreshStatuses && Date.now() - last > XERO_CHECK_EVERY) {
      try {
        await window.Xero.refreshStatuses();
        try { localStorage.setItem(XERO_CHECK_KEY, String(Date.now())); } catch (e) { /* private mode */ }
      } catch (e) {
        console.warn('[referrals] could not ask Xero what is paid:', e.message || e);
      }
    }
    const { newlyEarned } = await evaluate();
    if (newlyEarned.length === 1) {
      const r = newlyEarned[0];
      toast(`${r.referrerName || 'A client'} earned a $50 referral credit: ${r.referredName || 'the person they referred'} has paid.`);
    } else if (newlyEarned.length > 1) {
      toast(`${newlyEarned.length} referral credits earned. They go on each referrer's next invoice.`);
    }
  }

  // ---------- credits on invoices ----------
  async function availableFor(invoice) {
    if (!invoice || !invoice.jobId) return [];
    const job = await DB.getJob(invoice.jobId);
    if (!job || !job.clientId) return [];
    const on = R.creditedOn(invoice);
    return (await DB.getReferrals())
      .filter((r) => r.status === 'earned' && r.referrerClientId === job.clientId && !on.has(r.id));
  }

  async function applyTo(invoice) {
    const refs = await availableFor(invoice);
    if (!refs.length) return [];
    const gstRegistered = invoice.gstRegistered !== false;
    const now = Date.now();
    for (const ref of refs) {
      invoice.lineItems.push(R.creditLine(ref, { gstRegistered, uid: DB.uid }));
      await DB.saveReferral({ ...ref, status: 'credited', creditedInvoiceId: invoice.id, creditedAt: now });
    }
    return refs;
  }

  async function reconcileInvoice(invoice) {
    if (!invoice) return;
    const on = R.creditedOn(invoice);
    for (const ref of await DB.getReferrals()) {
      if (ref.status === 'credited' && ref.creditedInvoiceId === invoice.id && !on.has(ref.id)) {
        await DB.saveReferral({ ...ref, status: 'earned', creditedInvoiceId: null, creditedAt: null });
      } else if (on.has(ref.id) && ref.status === 'earned') {
        await DB.saveReferral({ ...ref, status: 'credited', creditedInvoiceId: invoice.id, creditedAt: Date.now() });
      }
    }
  }

  // ---------- from an enquiry ----------
  // The enquiry says "Referral" and names who. One referral per enquiry: the
  // existing one is updated if the referrer is changed while it is pending.
  async function recordForLead(lead, referrerClientId) {
    if (!lead || !referrerClientId) return null;
    const referrer = await DB.getClient(referrerClientId);
    if (!referrer) return null;
    const refs = await DB.getReferrals();
    const existing = refs.find((r) => r.referredLeadId === lead.id && r.status !== 'void');
    if (existing) {
      if (existing.referrerClientId === referrerClientId || existing.status !== 'pending') return existing;
      return DB.saveReferral({ ...existing, referrerClientId, referrerName: referrer.name || '' });
    }
    return DB.addReferral({
      referrerClientId,
      referrerName: referrer.name || '',
      referredLeadId: lead.id,
      referredJobId: lead.convertedJobId || null,
      referredName: lead.name || '',
    });
  }

  async function onLeadConverted(lead, job) {
    const ref = (await DB.getReferrals()).find((r) => r.referredLeadId === lead.id && r.status !== 'void');
    if (ref && !ref.referredJobId) await DB.saveReferral({ ...ref, referredJobId: job.id });
  }

  // ---------- the screen ----------
  const view = el('view-referrals');
  const listEl = el('referrals-list');
  const summaryEl = el('referrals-summary');
  const subtitleEl = el('referrals-subtitle');
  const formEl = el('referral-form');
  const referrerSel = el('referral-referrer');
  const referredSel = el('referral-referred');
  const notesInput = el('referral-notes');
  const formErr = el('referral-form-err');

  function showView() {
    if (window.hideAllAppViews) window.hideAllAppViews();
    view.classList.remove('hidden');
  }

  function rowHtml(r, invoicesById) {
    let detail = R.label(r.status);
    if (r.status === 'earned') detail = `$${(r.amountCents / 100).toFixed(0)} owed. It goes on ${r.referrerName || 'their'}${r.referrerName ? '’s' : ''} next invoice.`;
    if (r.status === 'credited') {
      const inv = invoicesById.get(r.creditedInvoiceId);
      detail = `Credited ${money(r.amountCents)}${inv ? ` on ${inv.number}` : ''}${r.creditedAt ? `, ${fmtDate(r.creditedAt)}` : ''}.`;
    }
    if (r.status === 'void') detail = `Cancelled${r.voidReason ? `: ${r.voidReason}` : ''}.`;
    const canVoid = r.status === 'pending' || r.status === 'earned';
    return `<li class="referral-row referral-${escapeHtml(r.status)}" data-id="${escapeHtml(r.id)}">
      <div class="referral-who"><strong>${escapeHtml(r.referrerName || 'A client')}</strong> referred
        <strong>${escapeHtml(r.referredName || 'someone')}</strong></div>
      <div class="referral-detail">${escapeHtml(detail)}</div>
      <div class="referral-meta">Recorded ${escapeHtml(fmtDate(r.createdAt))}${r.notes ? ` · ${escapeHtml(r.notes)}` : ''}</div>
      ${canVoid ? '<button type="button" class="link-btn referral-cancel-btn">Cancel this referral</button>' : ''}
    </li>`;
  }

  async function render() {
    const [refs, invoices] = await Promise.all([DB.getReferrals(), DB.getAllInvoices()]);
    const invoicesById = new Map(invoices.map((i) => [i.id, i]));
    const s = R.summarise(refs);
    subtitleEl.textContent = refs.length ? `${refs.length} recorded` : 'None yet';
    summaryEl.innerHTML = `
      <div class="referral-stat"><span>${s.pending}</span>waiting for payment</div>
      <div class="referral-stat referral-stat-owed"><span>${escapeHtml(money(s.owedCents))}</span>owed in credits</div>
      <div class="referral-stat"><span>${escapeHtml(money(s.creditedCents))}</span>credited so far</div>`;
    const order = { earned: 0, pending: 1, credited: 2, void: 3 };
    const sorted = refs.slice().sort((a, b) => (order[a.status] - order[b.status]) || ((b.createdAt || 0) - (a.createdAt || 0)));
    listEl.innerHTML = sorted.length
      ? sorted.map((r) => rowHtml(r, invoicesById)).join('')
      : '<li class="empty-hint">No referrals yet. When an enquiry comes in as a referral, choose who referred them, or record one here. '
        + 'A referral earns the person who made it $50 off their next service once the person they referred has paid.</li>';
    for (const btn of listEl.querySelectorAll('.referral-cancel-btn')) {
      btn.addEventListener('click', () => voidReferral(btn.closest('.referral-row').dataset.id));
    }
  }

  async function open() {
    showView();
    formEl.classList.add('hidden');
    listEl.innerHTML = '<li class="empty-hint">Loading…</li>';
    try { await evaluate(); } catch (e) { console.warn('[referrals] evaluate failed:', e.message || e); }
    await render();
  }

  async function voidReferral(id) {
    const ref = await DB.getReferral(id);
    if (!ref) return;
    const reason = await askPrompt(
      `${ref.referrerName || 'The client'} will not get a credit for referring ${ref.referredName || 'this person'}. It stays on the register, marked cancelled.`,
      '',
      { title: 'Cancel this referral?', okLabel: 'Cancel it', cancelLabel: 'Keep it', placeholder: 'Why? e.g. they were already a client' },
    );
    if (reason === null || reason === undefined) return;
    await DB.saveReferral({ ...ref, status: 'void', voidReason: String(reason).trim().slice(0, 200) });
    toast('Referral cancelled');
    await render();
  }

  async function openForm() {
    const [clients, leads, refs] = await Promise.all([DB.getClients(), DB.getLeads(), DB.getReferrals()]);
    const opt = (v, t) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`;
    referrerSel.innerHTML = opt('', 'Who made the referral?') + clients.map((c) => opt(c.id, c.name || c.phone || c.email || 'Unnamed client')).join('');
    const taken = new Set(refs.filter((r) => r.status !== 'void').flatMap((r) => [r.referredClientId, r.referredLeadId]).filter(Boolean));
    const openLeads = leads.filter((l) => !taken.has(l.id));
    referredSel.innerHTML = opt('', 'Who did they refer?')
      + (openLeads.length ? `<optgroup label="Enquiries">${openLeads.map((l) => opt(`lead:${l.id}`, l.name || 'Enquiry')).join('')}</optgroup>` : '')
      + `<optgroup label="Clients">${clients.filter((c) => !taken.has(c.id)).map((c) => opt(`client:${c.id}`, c.name || 'Unnamed client')).join('')}</optgroup>`;
    notesInput.value = '';
    formErr.hidden = true;
    formEl.classList.remove('hidden');
    formEl.scrollIntoView({ block: 'start' });
  }

  async function saveForm() {
    const referrerClientId = referrerSel.value || null;
    const [kind, refId] = String(referredSel.value || '').split(':');
    const referredClientId = kind === 'client' ? refId : null;
    const referredLeadId = kind === 'lead' ? refId : null;
    const problem = R.problemWith({ referrerClientId, referredClientId, referredLeadId }, await DB.getReferrals());
    if (problem) { formErr.textContent = problem; formErr.hidden = false; return; }
    const referrer = await DB.getClient(referrerClientId);
    const referred = referredClientId ? await DB.getClient(referredClientId) : await DB.getLead(referredLeadId);
    await DB.addReferral({
      referrerClientId,
      referrerName: (referrer && referrer.name) || '',
      referredClientId,
      referredLeadId,
      referredJobId: referred && referred.convertedJobId ? referred.convertedJobId : null,
      referredName: (referred && referred.name) || '',
      notes: notesInput.value.trim().slice(0, 300),
    });
    formEl.classList.add('hidden');
    await evaluate();
    await render();
    toast('Referral recorded');
  }

  if (view) {
    el('referrals-back-btn').addEventListener('click', () => { if (window.showJobListView) window.showJobListView(); });
    el('referral-new-btn').addEventListener('click', openForm);
    el('referral-save-btn').addEventListener('click', saveForm);
    el('referral-cancel-btn').addEventListener('click', () => formEl.classList.add('hidden'));
    const openBtn = el('open-referrals-btn');
    if (openBtn) openBtn.addEventListener('click', open);
  }

  window.ReferralsUI = {
    open, evaluate, afterSync, availableFor, applyTo, reconcileInvoice, recordForLead, onLeadConverted,
  };
})();
