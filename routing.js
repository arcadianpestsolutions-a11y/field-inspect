// Routing — works out a better order to drive a day in.
//
// The scheduler already knows how long the drive between two jobs is
// (availability.js owns that estimate, and this file never re-derives it).
// What it could not do is answer the question a technician actually asks
// while looking at tomorrow: is this the order I should drive it in?
//
// WHY THIS PROPOSES RATHER THAN APPLIES.
// Re-ordering a day is not free. Some of those clients have been told a time
// — a booking confirmation went out when the job was booked, or a reminder
// went out last night — and moving them means breaking a promise somebody
// made on the business's behalf. A route optimiser that quietly reshuffles a
// day is worse than no optimiser at all, because the saving is visible and
// the broken promise is not.
//
// So this returns a proposal: the new order, what it saves, and which of the
// moved clients have already been told when to expect you. Scope is in the
// unusual position of knowing that last part, because send-client-message
// stamps confirmation_sent_for_at and day_before_sent_for_at on the job and
// sync pulls both down. Nothing is written here; the caller decides.
//
// Pure module: no DOM, no database, injectable clock. Same reasoning as
// availability.js, which it depends on for travel and nothing else.
(() => {
  'use strict';

  // Above this many jobs, checking every possible order stops being
  // instant: 8 jobs is 40,320 orders and runs in a few milliseconds, 11
  // would be 40 million. A real pest-control day does not reach 8 often, so
  // the exact answer is available almost always, and the heuristic below
  // only takes over where a human could not check the work anyway.
  const EXACT_LIMIT = 8;

  const travelBetween = (a, b, config) => (window.Availability
    ? window.Availability.travelMinutesBetween(a, b, config)
    : null);

  const durationOf = (job) => job.scheduledDurationMins || 60;
  const hasCoords = (job) => !!(window.Availability && window.Availability.coordsOf(job));

  // Total driving for one order of jobs. Returns null if any leg cannot be
  // estimated — a route with an unknown leg is not a route, and scoring it
  // as zero would make the worst day look like the best one.
  function totalTravel(order, config) {
    let total = 0;
    for (let i = 1; i < order.length; i++) {
      const mins = travelBetween(order[i - 1], order[i], config);
      if (mins === null) return null;
      total += mins;
    }
    return total;
  }

  function legsFor(order, config) {
    const legs = [];
    for (let i = 1; i < order.length; i++) {
      legs.push({
        fromId: order[i - 1].id,
        toId: order[i].id,
        mins: travelBetween(order[i - 1], order[i], config),
      });
    }
    return legs;
  }

  // Every order, checked. `fixedFirst` keeps the day starting where it
  // already starts — the first appointment of the morning is the one most
  // likely to have been promised, and holding it still also cuts the search
  // by a factor of n.
  function bestExact(jobs, config, fixedFirst) {
    const head = fixedFirst ? [jobs[0]] : [];
    const rest = fixedFirst ? jobs.slice(1) : jobs.slice();
    let best = null;
    let bestCost = Infinity;

    const permute = (chosen, remaining) => {
      if (!remaining.length) {
        const order = head.concat(chosen);
        const cost = totalTravel(order, config);
        if (cost !== null && cost < bestCost) { bestCost = cost; best = order; }
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const next = remaining[i];
        const left = remaining.slice(0, i).concat(remaining.slice(i + 1));
        permute(chosen.concat([next]), left);
      }
    };
    permute([], rest);
    return best;
  }

  // Nearest neighbour to get a sane starting order, then 2-opt: repeatedly
  // reverse any stretch of the route that makes it shorter. It is the
  // standard pair for this problem and gets within a few percent of optimal
  // on the handful of stops a day actually has.
  function bestHeuristic(jobs, config, fixedFirst) {
    const remaining = jobs.slice();
    const order = [remaining.shift()];
    while (remaining.length) {
      let bestIdx = 0;
      let bestMins = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const mins = travelBetween(order[order.length - 1], remaining[i], config);
        if (mins !== null && mins < bestMins) { bestMins = mins; bestIdx = i; }
      }
      order.push(remaining.splice(bestIdx, 1)[0]);
    }

    let improved = true;
    let guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      for (let i = fixedFirst ? 1 : 0; i < order.length - 1; i++) {
        for (let k = i + 1; k < order.length; k++) {
          const candidate = order.slice(0, i)
            .concat(order.slice(i, k + 1).reverse())
            .concat(order.slice(k + 1));
          const a = totalTravel(candidate, config);
          const b = totalTravel(order, config);
          if (a !== null && b !== null && a < b) {
            order.length = 0;
            Array.prototype.push.apply(order, candidate);
            improved = true;
          }
        }
      }
    }
    return order;
  }

  // Lays start times back onto an order: the day begins when it already
  // began, and each job starts when the one before it finishes plus the
  // drive. Rounded up to five minutes, because a schedule that reads 9:37 is
  // not a schedule anyone keeps.
  function timesFor(order, startAt, config) {
    const times = [];
    let cursor = startAt;
    for (let i = 0; i < order.length; i++) {
      if (i > 0) {
        const drive = travelBetween(order[i - 1], order[i], config);
        cursor += (drive === null ? 0 : drive) * 60000;
        cursor = Math.ceil(cursor / (5 * 60000)) * (5 * 60000);
      }
      times.push(cursor);
      cursor += durationOf(order[i]) * 60000;
    }
    return { times, finishesAt: cursor };
  }

  // A client who has been told a time. Both stamps are written server-side by
  // send-client-message and pulled down read-only, so their presence is the
  // closest thing to proof that a message actually left.
  function hasBeenTold(job) {
    return !!(job && (job.confirmationSentForAt || job.dayBeforeSentForAt));
  }

  function optimiseDay(opts) {
    const o = opts || {};
    const config = window.Availability ? window.Availability.configFrom(o.config) : (o.config || {});
    const jobs = (o.jobs || [])
      .filter((j) => j && j.scheduledAt)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    const unlocatable = jobs.filter((j) => !hasCoords(j))
      .map((j) => ({ jobId: j.id, name: j.name }));

    if (jobs.length < 3) {
      // Two stops have exactly one order. Saying so is a better answer than
      // a proposal that changes nothing.
      return {
        ok: false,
        reason: jobs.length < 2 ? 'nothing-to-order' : 'only-one-route',
        unlocatable, jobs: jobs.length,
      };
    }
    if (unlocatable.length) {
      // A route with an unknown point on it is not a route. The fix is
      // specific and worth naming: those jobs have an address that was typed
      // rather than picked from the suggestion list, so no coordinates were
      // ever saved.
      return { ok: false, reason: 'addresses-not-located', unlocatable, jobs: jobs.length };
    }

    const fixedFirst = o.fixedFirst !== false;
    const before = jobs.slice();
    const after = jobs.length <= EXACT_LIMIT
      ? bestExact(jobs, config, fixedFirst)
      : bestHeuristic(jobs, config, fixedFirst);

    if (!after) return { ok: false, reason: 'no-route-found', unlocatable, jobs: jobs.length };

    const beforeTravel = totalTravel(before, config);
    const afterTravel = totalTravel(after, config);
    const startAt = before[0].scheduledAt;
    const beforeTimes = timesFor(before, startAt, config);
    const afterTimes = timesFor(after, startAt, config);

    const moves = [];
    for (let i = 0; i < after.length; i++) {
      const job = after[i];
      const toAt = afterTimes.times[i];
      if (toAt !== job.scheduledAt) {
        moves.push({
          jobId: job.id,
          name: job.name,
          address: job.address || '',
          fromAt: job.scheduledAt,
          toAt,
          durationMins: durationOf(job),
          // The bit that decides whether this is a tidy-up or a phone call.
          toldClient: hasBeenTold(job),
        });
      }
    }

    return {
      ok: true,
      reason: null,
      unlocatable,
      jobs: jobs.length,
      before: { order: before.map((j) => j.id), travelMins: beforeTravel, legs: legsFor(before, config), finishesAt: beforeTimes.finishesAt },
      after: { order: after.map((j) => j.id), travelMins: afterTravel, legs: legsFor(after, config), finishesAt: afterTimes.finishesAt },
      savingMins: (beforeTravel === null || afterTravel === null) ? null : beforeTravel - afterTravel,
      // How much earlier the day ends. Drivers feel this one more than the
      // travel total, because it is the difference between finishing at four
      // and finishing at five.
      finishesEarlierMins: Math.round((beforeTimes.finishesAt - afterTimes.finishesAt) / 60000),
      moves,
      alreadyToldCount: moves.filter((m) => m.toldClient).length,
      sameOrder: before.every((j, i) => j.id === after[i].id),
    };
  }

  const REASONS = {
    'nothing-to-order': 'Nothing is booked on this day.',
    'only-one-route': 'Two jobs can only be driven in one order.',
    'addresses-not-located':
      'Some jobs on this day have an address that was typed in rather than picked from the '
      + 'suggestion list, so there are no map coordinates for them. Re-pick those addresses and try again.',
    'no-route-found': 'The drive between these jobs could not be worked out.',
  };

  window.Routing = { optimiseDay, totalTravel, hasBeenTold, REASONS, EXACT_LIMIT };
})();
