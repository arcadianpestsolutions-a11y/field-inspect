// Referral rules (v121): pure, no DOM, no database. referrals-ui.js does the
// reading and writing; this decides.
//
//   A client refers somebody. That is a referral, PENDING.
//   The referred person PAYS for their first job: the referral is EARNED, and
//     $50 is owed to the referrer.
//   The $50 goes onto the referrer's next invoice as a credit line: CREDITED.
//   A referral can be VOIDED, with a reason. It is never deleted.
//
// "Paid" means Xero says PAID, or the invoice was marked paid by hand in Scope
// for money that never went through Xero (invoice.paidAt). Nothing else
// counts: an invoice that was merely sent, or drafted, earns nothing.
//
// EXPOSES: window.Referrals = { AMOUNT_CENTS, STATUSES, isPaid, jobIdsFor,
//   earningInvoice, creditLine, creditedOn, summarise, problemWith, label }

(() => {
  'use strict';

  const AMOUNT_CENTS = 5000;
  const STATUSES = ['pending', 'earned', 'credited', 'void'];
  const GST_RATE = 0.10;

  const isPaid = (inv) => !!inv && (String(inv.xeroStatus || '').toUpperCase() === 'PAID' || !!inv.paidAt);

  // Every job that belongs to the referred person: the job an enquiry was
  // booked as, any job for the referred client, and a job named directly.
  function jobIdsFor(ref, { jobs = [], leads = [] } = {}) {
    const ids = new Set();
    if (!ref) return ids;
    if (ref.referredJobId) ids.add(ref.referredJobId);
    if (ref.referredLeadId) {
      const lead = leads.find((l) => l.id === ref.referredLeadId);
      if (lead && lead.convertedJobId) ids.add(lead.convertedJobId);
    }
    if (ref.referredClientId) {
      for (const j of jobs) if (j.clientId === ref.referredClientId) ids.add(j.id);
    }
    return ids;
  }

  // The paid invoice that earns a pending referral, or null. The earliest paid
  // one, so the record points at the job that actually did it.
  function earningInvoice(ref, { jobs = [], leads = [], invoices = [] } = {}) {
    if (!ref || ref.status !== 'pending') return null;
    const jobIds = jobIdsFor(ref, { jobs, leads });
    if (!jobIds.size) return null;
    const paid = invoices.filter((i) => jobIds.has(i.jobId) && isPaid(i));
    if (!paid.length) return null;
    paid.sort((a, b) => (a.paidAt || a.updatedAt || 0) - (b.paidAt || b.updatedAt || 0));
    return paid[0];
  }

  // The line that takes the $50 off. GST-inclusive, because "$50 off" means
  // fifty dollars off the bill: on a GST-registered invoice the line is $45.45
  // ex GST, and the GST on it rounds to $4.55, exactly as Xero rounds it
  // (half away from zero; see Invoicing.lineGstCents).
  function creditLine(ref, { gstRegistered = true, uid } = {}) {
    const amount = Math.max(0, Math.round(Number(ref && ref.amountCents) || AMOUNT_CENTS));
    const unit = gstRegistered ? -Math.round(amount / (1 + GST_RATE)) : -amount;
    const who = (ref && ref.referredName) ? ref.referredName : 'someone';
    return {
      id: uid ? uid() : `ref-${ref && ref.id}`,
      description: `Referral credit: thank you for referring ${who}`,
      quantity: 1,
      unitAmountCents: unit,
      taxExempt: false,
      referralId: ref ? ref.id : null,
    };
  }

  // Which referrals an invoice is carrying a credit for.
  function creditedOn(invoice) {
    return new Set(((invoice && invoice.lineItems) || []).map((l) => l.referralId).filter(Boolean));
  }

  function summarise(refs = []) {
    const out = { pending: 0, earned: 0, credited: 0, void: 0, owedCents: 0, creditedCents: 0 };
    for (const r of refs) {
      if (!STATUSES.includes(r.status)) continue;
      out[r.status] += 1;
      if (r.status === 'earned') out.owedCents += Number(r.amountCents) || 0;
      if (r.status === 'credited') out.creditedCents += Number(r.amountCents) || 0;
    }
    return out;
  }

  // Why a new referral cannot be recorded, or null when it can.
  function problemWith({ referrerClientId, referredClientId, referredLeadId }, existing = []) {
    if (!referrerClientId) return 'Choose who made the referral.';
    if (!referredClientId && !referredLeadId) return 'Choose who they referred.';
    if (referredClientId && referredClientId === referrerClientId) return 'A client cannot refer themselves.';
    const live = existing.filter((r) => r.status !== 'void');
    if (referredClientId && live.some((r) => r.referredClientId === referredClientId)) {
      return 'That person is already on the register as somebody’s referral.';
    }
    if (referredLeadId && live.some((r) => r.referredLeadId === referredLeadId)) {
      return 'That enquiry is already on the register as somebody’s referral.';
    }
    return null;
  }

  const LABELS = {
    pending: 'Waiting for their first payment',
    earned: '$50 owed: goes on their next invoice',
    credited: 'Credited',
    void: 'Cancelled',
  };
  const label = (status) => LABELS[status] || status;

  window.Referrals = {
    AMOUNT_CENTS, STATUSES, isPaid, jobIdsFor, earningInvoice, creditLine, creditedOn, summarise, problemWith, label,
  };
})();
