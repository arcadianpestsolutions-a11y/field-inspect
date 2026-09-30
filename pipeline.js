// Leads, and knowing which one to ring next.
//
// A lead is somebody who asked, and is not yet a job. That distinction is the
// whole module: a job is work that exists, a lead is work that might. Mixing
// them means either a diary full of maybes or an enquiry that quietly becomes
// nobody's problem.
//
// WHY SPEED-TO-LEAD IS THE FIRST RULE.
// Of everything in here, the one that moves money is answering a new enquiry
// quickly. Somebody who has just found termite damage rings three companies;
// the one that calls back first usually gets it, and the gap between first
// and second is measured in hours, not days. So a new enquiry becomes overdue
// far faster than anything else here, and it is the only stage measured in
// hours rather than days.
//
// IT IS MEASURED IN WORKING HOURS, NOT WALL-CLOCK HOURS.
// An enquiry that lands at 9pm on Saturday is not late at 1am on Sunday. The
// working week comes from availability.js rather than being invented again,
// so the diary and the follow-up clock agree about when this business is open.
//
// Pure: leads in, decisions out. No DOM, no database, injectable clock.
(() => {
  'use strict';

  // The stages a pest-control enquiry actually passes through. Deliberately
  // few: a pipeline with nine stages is a pipeline nobody updates, and an
  // out-of-date pipeline is worse than none because it is believed.
  const STAGES = [
    { key: 'new', label: 'New enquiry', hint: 'Nobody has spoken to them yet', open: true },
    { key: 'contacted', label: 'Contacted', hint: 'Spoken to, working out what they need', open: true },
    { key: 'quoted', label: 'Quoted', hint: 'Price given, waiting on them', open: true },
    { key: 'won', label: 'Won', hint: 'Booked in — this is a job now', open: false },
    { key: 'lost', label: 'Lost', hint: 'Went elsewhere, or changed their mind', open: false },
  ];

  const STAGE_KEYS = STAGES.map((s) => s.key);
  const isOpen = (stage) => {
    const found = STAGES.find((s) => s.key === stage);
    return !!(found && found.open);
  };

  // How long a lead may sit in a stage before it needs chasing.
  //
  // `new` is in working HOURS and everything else in days, because they are
  // different problems. A new enquiry going cold is a race against the other
  // companies they rang. A quote going quiet is a person thinking about it,
  // and chasing that at four hours is how you lose it for a different reason.
  const DEFAULT_CONFIG = {
    newEnquiryWorkingHours: 4,
    contactedDays: 2,
    quotedDays: 3,
    // A quote chased twice and still silent has had the automatic path spent
    // on it. Past this it is a decision, not a reminder.
    quotedGiveUpDays: 21,
    maxFollowUps: 2,
    // Rough odds by stage, for a forecast that is honest about being a guess.
    // A pipeline that reports its full face value as expected income is a
    // pipeline that lies to whoever is deciding whether they can afford a ute.
    odds: { new: 0.2, contacted: 0.4, quoted: 0.5, won: 1, lost: 0 },
  };

  function configFrom(overrides) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, overrides || {});
    cfg.odds = Object.assign({}, DEFAULT_CONFIG.odds, (overrides && overrides.odds) || {});
    return cfg;
  }

  // Working hours elapsed between two instants, counted against the same
  // working week the scheduler offers appointments in.
  function workingHoursBetween(fromMs, toMs, hoursConfig) {
    if (!(toMs > fromMs)) return 0;
    const hours = hoursConfig
      || (window.Availability ? window.Availability.DEFAULT_CONFIG.hours : null)
      || { 0: null, 1: [8, 17], 2: [8, 17], 3: [8, 17], 4: [8, 17], 5: [8, 17], 6: [8, 12] };

    let total = 0;
    const cursor = new Date(fromMs);
    cursor.setHours(0, 0, 0, 0);

    // Day by day with the Date constructor, never by adding 86,400,000ms —
    // the clocks go forward in October and a millisecond-stepped loop drifts
    // an hour at that point, the same trap availability.js documents.
    for (let i = 0; i < 400; i++) {
      const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i);
      const dayStartMs = day.getTime();
      if (dayStartMs > toMs) break;

      const window_ = hours[day.getDay()];
      if (!window_) continue;

      const openMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), window_[0]).getTime();
      const closeMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), window_[1]).getTime();
      const from = Math.max(openMs, fromMs);
      const to = Math.min(closeMs, toMs);
      if (to > from) total += (to - from) / 3600000;
    }
    return total;
  }

  const DAY = 86400000;

  // The last time anybody did anything about this lead — moved it, rang them,
  // sent something. Not createdAt: a lead contacted yesterday is not stale
  // because it arrived last month.
  function lastTouchedAt(lead) {
    return Math.max(
      lead.stageChangedAt || 0,
      lead.lastContactedAt || 0,
      lead.lastFollowUpAt || 0,
      lead.createdAt || 0
    );
  }

  // Why this lead is being shown, in the words somebody would use about it.
  // A list that says "overdue" against everything teaches people to ignore it;
  // one that says what is actually happening gets read.
  function followUpFor(lead, opts) {
    const o = opts || {};
    const cfg = configFrom(o.config);
    const now = typeof o.now === 'number' ? o.now : Date.now();
    if (!lead || !isOpen(lead.stage)) return null;
    if (lead.snoozedUntil && lead.snoozedUntil > now) return null;

    const since = lastTouchedAt(lead);
    const sent = lead.followUpCount || 0;

    if (lead.stage === 'new') {
      const hours = workingHoursBetween(since, now, o.hours);
      if (hours < cfg.newEnquiryWorkingHours) return null;
      return {
        reason: 'new-unanswered',
        urgency: 'high',
        // Named as the race it is, because that is what makes somebody pick
        // up the phone instead of adding it to a list.
        text: `Enquiry ${Math.floor(hours)} working hours old and nobody has called back`,
        action: 'call',
      };
    }

    const days = Math.floor((now - since) / DAY);

    if (lead.stage === 'contacted') {
      if (days < cfg.contactedDays) return null;
      return {
        reason: 'contacted-no-quote',
        urgency: days >= cfg.contactedDays * 3 ? 'high' : 'normal',
        text: `Spoken to ${days} days ago and still no quote sent`,
        action: 'quote',
      };
    }

    // quoted
    if (days >= cfg.quotedGiveUpDays) {
      return {
        reason: 'quoted-cold',
        urgency: 'normal',
        text: `Quoted ${days} days ago, chased ${sent} ${sent === 1 ? 'time' : 'times'}, no answer`,
        action: 'close',
      };
    }
    if (days < cfg.quotedDays) return null;
    if (sent >= cfg.maxFollowUps) {
      return {
        reason: 'quoted-exhausted',
        urgency: 'normal',
        text: `Quoted ${days} days ago and followed up ${sent} times — worth a call or letting go`,
        action: 'call',
      };
    }
    return {
      reason: 'quoted-quiet',
      urgency: 'normal',
      text: `Quoted ${days} days ago, no answer yet`,
      action: 'follow-up',
    };
  }

  // Everything that needs doing, most urgent first. A new enquiry outranks
  // everything else regardless of age, because it is the one with a clock on
  // it that somebody else is also racing.
  function dueList(opts) {
    const o = opts || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const out = [];
    for (const lead of o.leads || []) {
      const due = followUpFor(lead, o);
      if (due) out.push({ lead, ...due, ageDays: Math.floor((now - lastTouchedAt(lead)) / DAY) });
    }
    const rank = { high: 0, normal: 1 };
    out.sort((a, b) => {
      if (a.reason === 'new-unanswered' && b.reason !== 'new-unanswered') return -1;
      if (b.reason === 'new-unanswered' && a.reason !== 'new-unanswered') return 1;
      if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
      return b.ageDays - a.ageDays;
    });
    return out;
  }

  // The board, and what it is worth.
  function summarise(opts) {
    const o = opts || {};
    const cfg = configFrom(o.config);
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const leads = o.leads || [];

    const byStage = {};
    for (const key of STAGE_KEYS) byStage[key] = { key, leads: [], valueCents: 0 };
    for (const lead of leads) {
      const key = STAGE_KEYS.includes(lead.stage) ? lead.stage : 'new';
      byStage[key].leads.push(lead);
      byStage[key].valueCents += lead.quotedCents || 0;
    }

    const open = leads.filter((l) => isOpen(l.stage));
    const openValueCents = open.reduce((sum, l) => sum + (l.quotedCents || 0), 0);
    // Weighted by stage. Stated as a forecast rather than as money, because
    // it is not money.
    const forecastCents = Math.round(open.reduce(
      (sum, l) => sum + (l.quotedCents || 0) * (cfg.odds[l.stage] || 0), 0));

    // Win rate over decided leads only. Counting open ones as losses would
    // make a busy month look like a bad one.
    const won = leads.filter((l) => l.stage === 'won').length;
    const lost = leads.filter((l) => l.stage === 'lost').length;
    const decided = won + lost;

    return {
      byStage,
      openCount: open.length,
      openValueCents,
      forecastCents,
      won,
      lost,
      winRate: decided ? Math.round((won / decided) * 100) : null,
      due: dueList({ leads, now, config: o.config, hours: o.hours }),
    };
  }

  // A lead becoming a job. Everything the job needs, and nothing the pipeline
  // kept for its own purposes — the odds, the follow-up counter and the
  // stage have no meaning once this is real work.
  function jobFromLead(lead) {
    return {
      name: lead.name || '',
      address: lead.address || '',
      addressLat: typeof lead.addressLat === 'number' ? lead.addressLat : null,
      addressLng: typeof lead.addressLng === 'number' ? lead.addressLng : null,
      clientPhone: lead.phone || '',
      clientEmail: lead.email || '',
      jobType: lead.jobType === 'pest_treatment' ? 'pest_treatment' : 'termite',
      notes: lead.notes || '',
    };
  }

  window.Pipeline = {
    STAGES,
    STAGE_KEYS,
    DEFAULT_CONFIG,
    configFrom,
    isOpen,
    workingHoursBetween,
    lastTouchedAt,
    followUpFor,
    dueList,
    summarise,
    jobFromLead,
  };
})();
