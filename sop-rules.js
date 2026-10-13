// SOP library rules (v122): pure, no DOM, no database. sops-ui.js reads and
// writes; this decides. Each function returns a NEW record and never changes
// the one it was given.
//
// The life of a procedure, the way ISO 9001 clause 7.5 expects it:
//
//   draft      written or being revised. A revision of an approved SOP lives
//              in `draft` while the approved text stays in force.
//   approved   version N, approved by somebody on a date, due for review on a
//              date. Every approved version is kept in `history` word for word.
//   retired    no longer used. Kept, with why.
//
// Reviews that change nothing are recorded too (history, kind 'reviewed'),
// and staff sign that they have read the version in force
// (`acknowledgements`, one per person per version).
//
// EXPOSES: window.SopRules

(() => {
  'use strict';

  const DEFAULT_REVIEW_MONTHS = 12;
  const DUE_SOON_DAYS = 30;
  const CATEGORIES = ['Inspection', 'Treatment', 'Chemicals', 'Safety', 'Records', 'Quality', 'Other'];

  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 200);

  function addMonths(ts, months) {
    const d = new Date(ts);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // 31 Jan plus a month is the end of February, not 3 March.
    if (d.getDate() < day) d.setDate(0);
    return d.getTime();
  }

  function nextCode(existing = []) {
    let n = 0;
    for (const s of existing) {
      const m = /^SOP-(\d+)$/.exec(String(s.code || ''));
      if (m) n = Math.max(n, Number(m[1]));
    }
    return `SOP-${String(n + 1).padStart(3, '0')}`;
  }

  function newSop({ id, code, title, category, owner, body, reviewIntervalMonths, actor, now = Date.now() }) {
    return {
      id: id || rid(),
      code: clean(code, 20),
      title: '',
      category: CATEGORIES.includes(category) ? category : 'Other',
      owner: '',
      status: 'draft',
      version: 0,
      body: '',
      changeNote: '',
      reviewIntervalMonths: Number(reviewIntervalMonths) || DEFAULT_REVIEW_MONTHS,
      approvedAt: null,
      approvedBy: '',
      lastReviewedAt: null,
      lastReviewedBy: '',
      nextReviewAt: null,
      draft: {
        title: clean(title, 160),
        category: CATEGORIES.includes(category) ? category : 'Other',
        owner: clean(owner, 120),
        body: String(body || ''),
        changeNote: 'First version.',
        reviewIntervalMonths: Number(reviewIntervalMonths) || DEFAULT_REVIEW_MONTHS,
        updatedAt: now,
        updatedBy: actor || '',
      },
      history: [],
      acknowledgements: [],
      retiredAt: null,
      retiredReason: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  // What is being worked on: the draft if there is one, else the approved text.
  function working(sop) {
    return sop.draft || {
      title: sop.title, category: sop.category, owner: sop.owner, body: sop.body,
      changeNote: '', reviewIntervalMonths: sop.reviewIntervalMonths,
    };
  }

  function edit(sop, changes, { actor, now = Date.now() } = {}) {
    if (sop.status === 'retired') return sop;
    const base = working(sop);
    const draft = {
      title: changes.title !== undefined ? clean(changes.title, 160) : base.title,
      category: changes.category !== undefined && CATEGORIES.includes(changes.category) ? changes.category : base.category,
      owner: changes.owner !== undefined ? clean(changes.owner, 120) : base.owner,
      body: changes.body !== undefined ? String(changes.body) : base.body,
      changeNote: changes.changeNote !== undefined ? clean(changes.changeNote, 300) : (sop.draft ? sop.draft.changeNote : ''),
      reviewIntervalMonths: Number(changes.reviewIntervalMonths) || base.reviewIntervalMonths || DEFAULT_REVIEW_MONTHS,
      updatedAt: now,
      updatedBy: actor || '',
    };
    return { ...sop, draft };
  }

  // Why the draft cannot be approved, or null.
  function approvalProblem(sop) {
    if (sop.status === 'retired') return 'A retired SOP cannot be approved. Make a new one.';
    const d = sop.draft;
    if (!d) return 'There are no changes waiting for approval.';
    if (!clean(d.title)) return 'Give it a title first.';
    if (clean(d.body, 100000).length < 20) return 'Write the procedure first.';
    if (sop.version > 0 && !clean(d.changeNote)) return 'Say what changed in this version.';
    return null;
  }

  function approve(sop, { actor, now = Date.now() } = {}) {
    const problem = approvalProblem(sop);
    if (problem) return { sop, problem };
    const d = sop.draft;
    const version = (sop.version || 0) + 1;
    const interval = Number(d.reviewIntervalMonths) || DEFAULT_REVIEW_MONTHS;
    const next = {
      ...sop,
      status: 'approved',
      version,
      title: d.title,
      category: d.category,
      owner: d.owner,
      body: d.body,
      changeNote: d.changeNote || (version === 1 ? 'First version.' : ''),
      reviewIntervalMonths: interval,
      approvedAt: now,
      approvedBy: actor || '',
      lastReviewedAt: now,
      lastReviewedBy: actor || '',
      nextReviewAt: addMonths(now, interval),
      draft: null,
      history: [...(sop.history || []), {
        id: rid(), kind: 'approved', version, title: d.title, body: d.body,
        changeNote: d.changeNote || '', at: now, by: actor || '',
      }],
    };
    return { sop: next, problem: null };
  }

  function discardDraft(sop) {
    if (!sop.draft || sop.version === 0) return sop; // a never-approved SOP IS its draft
    return { ...sop, draft: null };
  }

  function markReviewed(sop, { actor, note, now = Date.now() } = {}) {
    if (sop.status !== 'approved') return sop;
    return {
      ...sop,
      lastReviewedAt: now,
      lastReviewedBy: actor || '',
      nextReviewAt: addMonths(now, sop.reviewIntervalMonths || DEFAULT_REVIEW_MONTHS),
      history: [...(sop.history || []), {
        id: rid(), kind: 'reviewed', version: sop.version, note: clean(note, 300) || 'Reviewed. No changes needed.', at: now, by: actor || '',
      }],
    };
  }

  function retire(sop, { actor, reason, now = Date.now() } = {}) {
    if (sop.status === 'retired') return sop;
    return {
      ...sop,
      status: 'retired',
      retiredAt: now,
      retiredReason: clean(reason, 300),
      draft: null,
      history: [...(sop.history || []), { id: rid(), kind: 'retired', version: sop.version, note: clean(reason, 300), at: now, by: actor || '' }],
    };
  }

  const sameSigner = (a, b) => {
    const ea = String(a.email || '').toLowerCase();
    const eb = String(b.email || '').toLowerCase();
    if (ea && eb) return ea === eb;
    return String(a.name || '').trim().toLowerCase() === String(b.name || '').trim().toLowerCase();
  };

  // One signature per person per version. Only the approved version in force
  // can be signed for.
  function acknowledge(sop, { name, email, now = Date.now() } = {}) {
    if (sop.status !== 'approved' || !clean(name || email)) return sop;
    const who = { name: clean(name, 120), email: clean(email, 160) };
    const already = (sop.acknowledgements || []).some((a) => a.version === sop.version && sameSigner(a, who));
    if (already) return sop;
    return {
      ...sop,
      acknowledgements: [...(sop.acknowledgements || []), { id: rid(), version: sop.version, ...who, at: now }],
    };
  }

  function signedCurrent(sop) {
    return (sop.acknowledgements || []).filter((a) => a.version === sop.version);
  }

  function hasSigned(sop, who) {
    return signedCurrent(sop).some((a) => sameSigner(a, who || {}));
  }

  // overdue | due-soon | ok | draft | retired
  function reviewState(sop, now = Date.now()) {
    if (sop.status === 'retired') return 'retired';
    if (sop.status !== 'approved' || !sop.nextReviewAt) return 'draft';
    if (sop.nextReviewAt < now) return 'overdue';
    if (sop.nextReviewAt - now < DUE_SOON_DAYS * 86400000) return 'due-soon';
    return 'ok';
  }

  function needsAttention(sop, now = Date.now()) {
    const s = reviewState(sop, now);
    return s === 'overdue' || s === 'due-soon' || s === 'draft' || (sop.status === 'approved' && !!sop.draft);
  }

  function summarise(sops = [], now = Date.now()) {
    const out = { approved: 0, drafts: 0, overdue: 0, dueSoon: 0, retired: 0 };
    for (const s of sops) {
      const st = reviewState(s, now);
      if (s.status === 'approved') out.approved += 1;
      if (s.status === 'draft' || (s.status === 'approved' && s.draft)) out.drafts += 1;
      if (st === 'overdue') out.overdue += 1;
      if (st === 'due-soon') out.dueSoon += 1;
      if (s.status === 'retired') out.retired += 1;
    }
    return out;
  }

  window.SopRules = {
    DEFAULT_REVIEW_MONTHS, DUE_SOON_DAYS, CATEGORIES,
    addMonths, nextCode, newSop, working, edit, approvalProblem, approve, discardDraft,
    markReviewed, retire, acknowledge, signedCurrent, hasSigned, reviewState, needsAttention, summarise,
  };
})();
