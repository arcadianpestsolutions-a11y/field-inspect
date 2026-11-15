// What the walk's ticks mean for the report (v145).
//
// The walk (photo-walk.js) ends every spot as OK, Issue or Not here. This
// turns those into the whole-house answers of the report, so the technician
// does not answer the same thing twice: an Issue on the hot water system IS
// "water leaks found: Yes, hot water relief valve".
//
// Rules, agreed with Tal on 15 Nov 2026 ("Scope should do as much as it
// can", confirmed by the technician once at the end):
//
//   - A spot's `rollup` (photo-checklists.js) says which question it answers.
//   - Any Issue among the spots for a question gives the "issue" answer.
//     Every such spot dealt with and none an Issue gives the "ok" answer.
//     Otherwise the question is left alone.
//   - The walk only ever writes a field that is blank, still at the form's
//     default, or holding what the walk itself last wrote. An answer the
//     technician typed or chose in the report is never overwritten.
//     `wrote` (kept in sections.walkthrough) is how it tells the difference.
//   - Timber pests are different. An Issue on timber asks what kind (termite
//     damage, live termites, borers, decay), and that is a "Yes" the
//     technician gave. A "No" to any of them is never inferred here: it is
//     offered once the walk is finished and recorded only when the
//     technician confirms it (report.js, the still-to-do card).
//
// Pure: no DOM, no storage. EXPOSES: window.WalkRollup = { KINDS, compute,
//   photoTargets, kindsFor, AREA_NAMES }

(() => {
  'use strict';

  // What an Issue on timber can be. `found`/`areas`/`photos` are fields of
  // `section`; a test keeps them real.
  const KINDS = [
    { id: 'workings', label: 'Termite damage or workings', section: 'findings', found: 'workingsFound', areas: 'workingsAreas', photos: 'damagePhotos' },
    { id: 'live', label: 'Live termites', section: 'findings', found: 'liveTermitesFound', areas: 'liveTermitesAreas', photos: 'liveTermitesPhotos' },
    { id: 'borers', label: 'Borers', section: 'findings', found: 'borersFound', areas: 'borerAreas', photos: 'borerPhotos' },
    { id: 'decay', label: 'Fungal decay', section: 'conducive', found: 'fungalDecayFound', areas: null, photos: 'fungalDecayPhotos' },
  ];

  // The walk's areas, in the words the report's area lists use.
  const AREA_NAMES = { outside: 'The Exterior', subfloor: 'Subfloor', roof: 'Roof Void', inside: 'The Interior' };

  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const blank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  function kindsFor(item) {
    return item && item.rollup && item.rollup.timber ? KINDS : [];
  }

  // Where an Issue's photos belong, instead of the spot's general photo field:
  // the field whose photo the rules make mandatory.
  function photoTargets(item, result) {
    const fallback = item.schemaField ? [{ section: item.schemaSection, field: item.schemaField }] : [];
    const r = item.rollup;
    if (!r || !result || result.r !== 'issue') return fallback;
    if (r.leak) return [{ section: 'conducive', field: 'waterLeakPhotos' }];
    if (r.photos) return [{ section: r.set[0], field: r.photos }];
    if (r.timber) {
      const picked = KINDS.filter((k) => (result.kinds || []).includes(k.id));
      if (picked.length) return picked.map((k) => ({ section: k.section, field: k.photos }));
    }
    return fallback;
  }

  // items: the checklist. activeIds: the spots this house actually has (a
  // slab home has no subfloor spots). state: the walk. sections: the report's
  // sections as they stand. defaults: { 'section.field': default } from the
  // schema. wrote: what the walk wrote last time.
  // Returns { changes: [{sectionId, fieldId, to}], wrote }.
  function compute({ items, activeIds, state, sections, defaults, wrote }) {
    const results = (state && state.results) || {};
    const skipped = new Set((state && state.skipped) || []);
    const active = new Set(activeIds || []);
    const prev = wrote || {};
    const nextWrote = {};
    const changes = [];
    const cur = (s, f) => ((sections || {})[s] || {})[f];
    const def = (s, f) => (defaults || {})[s + '.' + f];

    // May the walk write this field? Only if nobody else has.
    function mine(s, f) {
      const v = cur(s, f);
      const key = s + '.' + f;
      return blank(v) || same(v, def(s, f)) || (key in prev && same(v, prev[key]));
    }
    function write(s, f, to) {
      const key = s + '.' + f;
      if (!mine(s, f)) return;
      nextWrote[key] = to;
      if (!same(cur(s, f), to)) changes.push({ sectionId: s, fieldId: f, to });
    }
    // The walk no longer has a view: put back the default, if it was the
    // walk's value sitting there.
    function release(s, f) {
      const key = s + '.' + f;
      if (!(key in prev) || !same(cur(s, f), prev[key])) return;
      const d = def(s, f);
      if (!same(cur(s, f), d)) changes.push({ sectionId: s, fieldId: f, to: d });
    }
    // A tick list: the walk adds and removes only its own entries.
    function writeList(s, f, add) {
      const key = s + '.' + f;
      const before = Array.isArray(cur(s, f)) ? cur(s, f) : [];
      const hadMine = Array.isArray(prev[key]) ? prev[key] : [];
      const kept = before.filter((v) => !hadMine.includes(v));
      const mineNow = add.filter((v) => !kept.includes(v));
      const to = [...kept, ...mineNow];
      if (mineNow.length) nextWrote[key] = mineNow;
      if (!same(before, to)) changes.push({ sectionId: s, fieldId: f, to: to.length ? to : undefined });
    }
    function verdict(item) {
      if (!active.has(item.id)) return null;
      const r = results[item.id];
      if (r && r.r === 'issue') return 'issue';
      if (r && r.r === 'ok') return 'ok';
      if (skipped.has(item.id)) return 'nothere';
      return 'open'; // not dealt with yet (or could not be photographed)
    }
    const noteLine = (item) => {
      const r = results[item.id];
      return r && r.note ? `${item.label}: ${r.note}` : '';
    };

    // ---- one question per group of spots ----
    const groups = new Map();
    for (const item of items) {
      const r = item.rollup;
      if (!r || !r.set) continue;
      const key = r.set.join('.');
      if (!groups.has(key)) groups.set(key, { rollup: r, items: [] });
      groups.get(key).items.push(item);
    }
    for (const { rollup, items: spots } of groups.values()) {
      const [s, f] = rollup.set;
      const verdicts = spots.map((i) => [i, verdict(i)]).filter(([, v]) => v !== null);
      const issues = verdicts.filter(([, v]) => v === 'issue').map(([i]) => i);
      const anyOk = verdicts.some(([, v]) => v === 'ok');
      const anyOpen = verdicts.some(([, v]) => v === 'open');
      if (issues.length) write(s, f, rollup.issue);
      else if (anyOk && !anyOpen) write(s, f, rollup.ok);
      else release(s, f);
      if (rollup.details) {
        const text = issues.map(noteLine).filter(Boolean).join('\n');
        if (text) write(s, rollup.details, text); else release(s, rollup.details);
      }
      // "Is there one at all?" (a water tank): a verdict means yes, Not here no.
      if (rollup.present) {
        const [ps, pf] = rollup.present;
        if (verdicts.some(([, v]) => v === 'ok' || v === 'issue')) write(ps, pf, 'Yes');
        else if (verdicts.length && verdicts.every(([, v]) => v === 'nothere')) write(ps, pf, 'No');
        else release(ps, pf);
      }
    }

    // ---- water leaks: several spots, one question, a list of where ----
    const leakSpots = items.filter((i) => i.rollup && i.rollup.leak).map((i) => [i, verdict(i)]).filter(([, v]) => v !== null);
    if (leakSpots.length) {
      const leaking = leakSpots.filter(([, v]) => v === 'issue').map(([i]) => i);
      const anyOk = leakSpots.some(([, v]) => v === 'ok');
      const anyOpen = leakSpots.some(([, v]) => v === 'open');
      if (leaking.length) write('conducive', 'waterLeaksFound', 'Yes');
      else if (anyOk && !anyOpen) write('conducive', 'waterLeaksFound', 'No');
      else release('conducive', 'waterLeaksFound');
      writeList('conducive', 'waterLeakAreas', Array.from(new Set(leaking.map((i) => i.rollup.leak))));
      const text = leaking.map(noteLine).filter(Boolean).join('\n');
      if (text) write('conducive', 'waterLeakDetails', text); else release('conducive', 'waterLeakDetails');
    }

    // ---- timber pests: a Yes is the technician's; a No is never inferred ----
    for (const kind of KINDS) {
      const hits = items.filter((i) => i.rollup && i.rollup.timber && verdict(i) === 'issue'
        && (results[i.id].kinds || []).includes(kind.id));
      if (hits.length) write(kind.section, kind.found, 'Yes');
      else release(kind.section, kind.found);
      if (kind.areas) writeList(kind.section, kind.areas, Array.from(new Set(hits.map((i) => AREA_NAMES[i.area]).filter(Boolean))));
    }

    return { changes, wrote: nextWrote };
  }

  window.WalkRollup = { KINDS, AREA_NAMES, compute, photoTargets, kindsFor };
})();
