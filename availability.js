// Availability — the one place that answers "when am I actually free?".
//
// Before this file there were three separate answers to that question and no
// two of them agreed:
//
//   scheduler.js      bookIntoFirstFreeSlot() scanned whole hours from 8am,
//                     ignored travel, and ignored whether the job's own
//                     duration ran into the next booking. The confirm dialog
//                     afterwards was the only thing catching either mistake.
//   schedule-agent.js toolFindFreeSlots() scanned whole hours from 7am with no
//                     lead time at all, so the model was happily told that
//                     7am last Tuesday was free, and no travel check existed.
//   nothing           for a client picking their own slot on a booking page.
//
// All three rounded durations up to whole hours, so a 30-minute treatment
// consumed an hour and half the real gaps in a day were invisible.
//
// This module replaces the arithmetic in all of them. It is deliberately
// pure: no DOM, no DB, no network, no globals read from outside. Jobs come in
// as an argument and slots go out as data, which is what lets the same code
// run in the app, in the booking assistant, and — when the public booking
// page arrives — inside an Edge Function, where the travel-aware calculation
// has to happen server-side because client addresses must never be shipped to
// a stranger's browser just so it can work out a drive time.
//
// TWO POLICIES, ONE ENGINE. The difference between a technician looking at
// their own diary and a member of the public picking a slot is trust, not
// arithmetic:
//
//   'advisory' (internal) — shows everything and stays quiet about what it
//     cannot know. A missing travel estimate is not a reason to hide a slot
//     from the person who owns the diary; they can see the addresses.
//   'strict' (public) — never offers anything that would create a day that
//     cannot physically be worked. Where travel cannot be estimated it
//     ASSUMES a drive rather than assuming none, refuses addresses outside
//     the service area, and honours the daily cap. A slot offered to a client
//     is a promise, so the failure has to land on the side of offering less.
(() => {
  'use strict';

  // A working week. Hour pairs are [firstStartHour, lastEndHour] on the local
  // clock; null means closed. These are the PUBLIC-facing defaults, which is
  // why they are narrower than the scheduler's own 7am–6pm grid: 7am exists in
  // that grid so an early start can be booked deliberately, not so a stranger
  // can be offered one. Callers inside the app pass their own hours.
  const DEFAULT_CONFIG = {
    hours: {
      0: null,      // Sunday
      1: [8, 17],
      2: [8, 17],
      3: [8, 17],
      4: [8, 17],
      5: [8, 17],
      6: [8, 12],   // Saturday mornings
    },
    slotStepMins: 30,
    // A client booking online is not booking for this afternoon. Pest control
    // needs the product, the gear and the drive planned, so the first slot on
    // offer is a day out.
    minLeadMins: 24 * 60,
    horizonDays: 28,
    // The travel estimate already includes gear time at both ends, so this is
    // zero by default rather than double-counting it.
    bufferMins: 0,
    // Used ONLY under the strict policy, and only when a travel estimate is
    // impossible because one end has no coordinates. Coordinates are saved
    // only when an address was picked from the suggestion list, so plenty of
    // real jobs have none — and "no estimate" must never quietly become "no
    // driving required" on a slot being offered to a client.
    assumedTravelMins: 20,
    maxMinutesPerDay: 8 * 60,
    maxJobsPerDay: 6,
    // ISO 'YYYY-MM-DD' strings. Public holidays have to be supplied; see
    // NSW_FIXED_CLOSURES for the date-certain ones.
    closedDates: [],
    // null means no limit — the app itself does not restrict where a job can
    // be. A public booking page must set this, or it will offer slots for
    // Dubbo. Shape: { zones: [{ name, lat, lng, radiusKm }] }.
    serviceArea: null,
    // Same estimate scheduler.js has used since travel time was added: a
    // straight line scaled for the fact roads are not straight, at an average
    // door-to-door speed for suburban Macarthur running, which is well under
    // any speed limit because it includes lights, roundabouts, finding the
    // place and parking.
    roadWindingFactor: 1.3,
    averageSpeedKmh: 40,
    gearMinutes: 10,
  };

  // The NSW public holidays that fall on the same date every year. The moving
  // ones — Easter, the King's Birthday, Labour Day, and any one-off — are not
  // in here and cannot be, so a caller that cares has to add them. Offering a
  // client Good Friday is the kind of mistake that costs a booking, so this is
  // a starting point, not a substitute for a real list.
  const NSW_FIXED_CLOSURES = ['01-01', '01-26', '04-25', '12-25', '12-26'];

  const REFUSALS = {
    outside_service_area: 'That address is outside the area we cover. Give us a call — we may still be able to help.',
    address_not_located: 'We could not find that address on the map. Check the street number and suburb, then try again.',
    bad_duration: 'That job length does not look right, so no times can be worked out for it.',
    empty_window: 'There are no days to look at between those two dates.',
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d; };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function configFrom(overrides) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, overrides || {});
    // hours is a nested object, so a caller overriding Saturday alone would
    // otherwise wipe out the rest of the week.
    cfg.hours = Object.assign({}, DEFAULT_CONFIG.hours, (overrides && overrides.hours) || {});
    return cfg;
  }

  // Accepts either shape this project stores coordinates in: a job row
  // (addressLat/addressLng) or a plain point ({lat, lng}).
  function coordsOf(x) {
    if (!x) return null;
    const lat = typeof x.lat === 'number' ? x.lat : x.addressLat;
    const lng = typeof x.lng === 'number' ? x.lng : x.addressLng;
    return (typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng))
      ? { lat, lng } : null;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const EARTH_RADIUS_KM = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Null, never zero, when either end has no coordinates — a missing estimate
  // and a zero-minute drive are completely different facts and the callers
  // above treat them differently. Rounded to five minutes so it never reads as
  // more precise than a straight-line guess deserves.
  function travelMinutesBetween(from, to, config) {
    const cfg = config && config.averageSpeedKmh ? config : DEFAULT_CONFIG;
    const a = coordsOf(from);
    const b = coordsOf(to);
    if (!a || !b) return null;
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
    const minutes = ((km * cfg.roadWindingFactor) / cfg.averageSpeedKmh) * 60 + cfg.gearMinutes;
    return Math.max(5, Math.round(minutes / 5) * 5);
  }

  // Straight-line distance to the nearest zone centre, which is how a service
  // radius is actually advertised ("we cover 15km around Camden South") even
  // though the driving is longer. Kept consistent with how the radius was
  // quoted rather than silently stricter than the promise.
  function serviceAreaCheck(point, config) {
    const cfg = configFrom(config);
    const p = coordsOf(point);
    if (!cfg.serviceArea || !Array.isArray(cfg.serviceArea.zones) || !cfg.serviceArea.zones.length) {
      return { limited: false, inside: true, km: null, zone: null };
    }
    if (!p) return { limited: true, inside: false, km: null, zone: null, located: false };
    let best = null;
    for (const zone of cfg.serviceArea.zones) {
      const z = coordsOf(zone);
      if (!z) continue;
      const km = haversineKm(p.lat, p.lng, z.lat, z.lng);
      if (!best || km < best.km) best = { km, zone, inside: km <= (zone.radiusKm || 0) };
    }
    if (!best) return { limited: true, inside: true, km: null, zone: null, located: true };
    return {
      limited: true,
      located: true,
      inside: best.inside,
      km: Math.round(best.km * 10) / 10,
      zone: best.zone.name || null,
    };
  }

  function dayLabel(d, now) {
    const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  }

  const durationOf = (job) => job.scheduledDurationMins || 60;

  // How much room a slot has on either side once the drive is paid for. The
  // scheduler colours slots with this, following the same convention as the
  // rest of the app: green nominal, amber caution.
  function fitLabel(slackBefore, slackAfter) {
    const slack = Math.min(
      slackBefore === null ? Infinity : slackBefore,
      slackAfter === null ? Infinity : slackAfter
    );
    if (slack === Infinity) return 'open';        // nothing either side
    if (slack <= 0) return 'back_to_back';
    if (slack < 30) return 'tight';
    return 'easy';
  }

  function freeSlots(opts) {
    const o = opts || {};
    const cfg = configFrom(o.config);
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const policy = o.policy === 'strict' ? 'strict' : 'advisory';
    const strict = policy === 'strict';
    const limit = typeof o.limit === 'number' ? Math.max(1, o.limit) : 60;
    const at = coordsOf(o.at);

    const excluded = { closed: 0, clash: 0, travel: 0, capacity: 0, outsideWindow: 0 };
    const fail = (code, extra) => Object.assign({
      ok: false,
      refusal: { code, message: REFUSALS[code] || 'Those times cannot be worked out.' },
      slots: [], days: [], policy, excluded,
    }, extra || {});

    // Not `o.durationMins || 60`. A caller that works out a duration and
    // arrives at zero means zero, and quietly turning that into an hour would
    // hand back a list of hour-long slots for a job nobody sized — the kind of
    // default that is indistinguishable from a correct answer. Only a missing
    // value takes the default.
    const durationMins = Math.round(o.durationMins == null ? 60 : o.durationMins);
    if (!(durationMins > 0) || durationMins > 12 * 60) return fail('bad_duration');

    // Service area, before any arithmetic. Under the strict policy an address
    // that cannot be placed on a map is a refusal rather than an unchecked
    // booking: the whole point of the radius is that it is enforced, and an
    // ungeocoded address quietly skipping the check would defeat it.
    const area = serviceAreaCheck(o.at, cfg);
    if (strict && area.limited) {
      if (!area.located) return fail('address_not_located');
      if (!area.inside) {
        return fail('outside_service_area', { serviceArea: area });
      }
    }

    // The earliest time on offer. Lead time is enforced here and not left to
    // the caller, because every path that forgot it offered slots in the past.
    const earliest = Math.max(
      typeof o.from === 'number' ? o.from : now,
      now + cfg.minLeadMins * 60000
    );
    const latest = typeof o.to === 'number'
      ? o.to
      : startOfDay(earliest).getTime() + cfg.horizonDays * 86400000;
    if (latest <= earliest) return fail('empty_window');

    // Only booked jobs matter, and only their time and place.
    const booked = (o.jobs || [])
      .filter((j) => j && j.scheduledAt && j.id !== o.excludeJobId)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    const byDay = new Map();
    for (const j of booked) {
      const key = isoDate(new Date(j.scheduledAt));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(j);
    }

    const closed = new Set(cfg.closedDates || []);
    const slots = [];
    const days = [];
    const firstDay = startOfDay(earliest);
    const lastDay = startOfDay(latest);

    // Days are stepped with the Date constructor, never by adding 86400000.
    // NSW puts its clocks forward on the first Sunday in October, and a
    // millisecond-stepped loop drifts an hour at that point — which would
    // quietly shift every offered time for the rest of the horizon.
    for (let i = 0; ; i++) {
      const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i);
      if (day.getTime() > lastDay.getTime()) break;
      if (i > 400) break;   // a stop, not a limit
      if (slots.length >= limit) break;

      const key = isoDate(day);
      const window = cfg.hours[day.getDay()];
      if (!window || closed.has(key) || closed.has(key.slice(5))) { excluded.closed++; continue; }

      const dayJobs = (byDay.get(key) || []);
      const bookedMins = dayJobs.reduce((sum, j) => sum + durationOf(j), 0);
      const full = bookedMins >= cfg.maxMinutesPerDay || dayJobs.length >= cfg.maxJobsPerDay;
      if (strict && (full || bookedMins + durationMins > cfg.maxMinutesPerDay)) {
        excluded.capacity++;
        days.push({ date: key, label: dayLabel(day, now), slots: [], bookedMins, bookedJobs: dayJobs.length, full: true });
        continue;
      }

      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), window[0], 0, 0, 0).getTime();
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), window[1], 0, 0, 0).getTime();
      const step = cfg.slotStepMins * 60000;
      const daySlots = [];

      // Slot starts are aligned to the day's own opening time, so a business
      // opening at 8:30 gets 8:30/9:00/9:30 rather than being pulled onto the
      // hour and losing its first half hour.
      let t = dayStart;
      if (earliest > dayStart) t = dayStart + Math.ceil((earliest - dayStart) / step) * step;

      for (; t + durationMins * 60000 <= dayEnd; t += step) {
        if (slots.length >= limit) break;
        const endAt = t + durationMins * 60000;

        let clash = false;
        let prev = null;   // last job that finishes at or before this slot starts
        let next = null;   // first job that starts at or after this slot ends
        for (const j of dayJobs) {
          const jStart = j.scheduledAt;
          const jEnd = jStart + durationOf(j) * 60000;
          if (jStart < endAt && jEnd > t) { clash = true; break; }
          if (jEnd <= t && (!prev || jEnd > prev.scheduledAt + durationOf(prev) * 60000)) prev = j;
          if (jStart >= endAt && (!next || jStart < next.scheduledAt)) next = j;
        }
        if (clash) { excluded.clash++; continue; }

        // Travel. A gap on the clock is not a gap in the day if the drive
        // does not fit inside it — two jobs half an hour apart and forty
        // minutes apart on the road is a promise that cannot be kept, and it
        // is discovered on the drive rather than in the diary.
        let travelBeforeMins = null;
        let travelAfterMins = null;
        let assumed = false;

        let needBefore = 0;
        let slackBefore = null;
        if (prev) {
          const prevEnd = prev.scheduledAt + durationOf(prev) * 60000;
          travelBeforeMins = travelMinutesBetween(prev, at, cfg);
          if (travelBeforeMins === null && strict) { needBefore = cfg.assumedTravelMins; assumed = true; }
          else needBefore = travelBeforeMins || 0;
          needBefore += cfg.bufferMins;
          slackBefore = Math.round((t - prevEnd) / 60000) - needBefore;
        }

        let needAfter = 0;
        let slackAfter = null;
        if (next) {
          travelAfterMins = travelMinutesBetween(at, next, cfg);
          if (travelAfterMins === null && strict) { needAfter = cfg.assumedTravelMins; assumed = true; }
          else needAfter = travelAfterMins || 0;
          needAfter += cfg.bufferMins;
          slackAfter = Math.round((next.scheduledAt - endAt) / 60000) - needAfter;
        }

        if ((slackBefore !== null && slackBefore < 0) || (slackAfter !== null && slackAfter < 0)) {
          excluded.travel++;
          continue;
        }

        const slot = {
          startAt: t,
          endAt,
          date: key,
          durationMins,
          travelBeforeMins,
          travelAfterMins,
          slackBeforeMins: slackBefore,
          slackAfterMins: slackAfter,
          fit: fitLabel(slackBefore, slackAfter),
          // True when a drive time had to be assumed because an address has
          // no coordinates. The UI says so rather than presenting a guess as
          // a measurement.
          assumedTravel: assumed,
        };
        daySlots.push(slot);
        slots.push(slot);
      }

      if (daySlots.length || dayJobs.length) {
        days.push({
          date: key,
          label: dayLabel(day, now),
          slots: daySlots,
          bookedMins,
          bookedJobs: dayJobs.length,
          full,
        });
      }
    }

    return {
      ok: true,
      refusal: null,
      slots,
      days,
      policy,
      durationMins,
      searchedFrom: earliest,
      searchedTo: latest,
      serviceArea: area.limited ? area : null,
      // Why slots were dropped, so a caller can tell "the week is booked out"
      // apart from "the week is unreachable" — very different things to say to
      // a client, and indistinguishable from an empty list alone.
      excluded,
    };
  }

  function nextFreeSlot(opts) {
    const result = freeSlots(Object.assign({}, opts, { limit: 1 }));
    return result.ok && result.slots.length ? result.slots[0] : null;
  }

  const API = {
    DEFAULT_CONFIG,
    NSW_FIXED_CLOSURES,
    REFUSALS,
    configFrom,
    coordsOf,
    haversineKm,
    travelMinutesBetween,
    serviceAreaCheck,
    freeSlots,
    nextFreeSlot,
  };

  // globalThis rather than window, so this same file can be imported by a Deno
  // Edge Function unchanged when the public booking page needs the strict
  // policy computed server-side.
  globalThis.Availability = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})();
