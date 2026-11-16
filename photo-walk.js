// Guided photo walk for the timber pest inspection (v118, reworked v143).
//
// The checklist (photo-checklists.js, items carrying an `area`) as a walk of
// the property, one spot at a time:
//
//   Outside      every photo step for the exterior
//   Subfloor     "Is there a subfloor?" first: Yes, Yes but can't get in, or
//                No (a slab). Only Yes walks its photo steps; can't get in
//                asks for one photo of why
//   Roof void    the same three answers, then its steps
//   Inside       no photos: each room ticked OK or Issue, then a few ticks
//                for what blocked the view, written into the report's Areas
//                We Were Unable to Inspect section
//   Done         what is still to do, each one tap away; or that all is done
//
// v143, agreed with Tal on 15 Nov 2026. An inspection is not walked in a
// straight line, so:
//   - the area buttons along the top jump to any area at any time, and the
//     walk comes back to whatever is still open there;
//   - every spot ends in a state: a photo marked OK or Issue, or "Not here".
//     A photo alone is not finished, because the report has to say what the
//     photo showed;
//   - the last step lists what is still to do rather than saying "done" when
//     it is not.
//
// The answers to the two questions are written into the report (v119,
// ReportUI.recordAccessAnswer): floor type, subfloor drainage, and a
// restricted-access line for an area that could not be entered.
//
// v151, Tal on 16 Nov 2026 after walking it on his phone: 37 photos is too
// many for a report. Photograph ISSUES, not everything. So every area is now
// ONE screen of ticks (the way Inside always was): OK, Issue or N/A per item,
// and "Rest are OK" for the remainder. Only an Issue asks for a photo. The
// photos that stay mandatory: the front (its own prompt), the durable notice
// when one is found (`photoWhen: 'ok'`), any Issue, and why an area could not
// be entered. An OK item prints a standard sentence for the client
// (`okText`, photo-checklists.js), so the technician types nothing.
//
// Each step sets the zone for the photos taken on it, exactly as tapping its
// chip does, so filing them into the report is unchanged. Back goes back, the
// chips still jump anywhere, and a zone typed by hand still works for
// something off the list.
//
// Where the walk is up to is kept on this phone in localStorage, per job, so
// it works with no signal. Since v143 it is also handed to `saveResults`
// after every change (app.js writes it into the report, which syncs), so the
// office and the finished report know what was checked.
//
// EXPOSES: window.PhotoWalk = { isGuided, buildSteps, firstOpenIndex,
//   outstanding, mergeStates, loadState, saveState, mount, AREAS,
//   INSIDE_NOTES, INSIDE_ZONE }

(() => {
  'use strict';

  const AREAS = [
    { id: 'outside', title: 'Outside' },
    { id: 'subfloor', title: 'Subfloor', ask: 'Is there a subfloor?', answers: [
      { value: 'yes', label: 'Yes, going under' },
      { value: 'blocked', label: 'Yes, but I can’t get in' },
      { value: 'no', label: 'No, it’s a slab' },
    ] },
    { id: 'roof', title: 'Roof void', ask: 'Is there a roof void?', answers: [
      { value: 'yes', label: 'Yes, going in' },
      { value: 'blocked', label: 'Yes, but I can’t get in' },
      { value: 'no', label: 'No roof void' },
    ] },
    { id: 'inside', title: 'Inside', notes: true },
  ];

  // `value` is exactly an option of the report's Interior Obstructions field
  // (report-schema.js, access.interiorObstructions); a test keeps them equal.
  const INSIDE_NOTES = [
    { value: 'Furniture', label: 'Furniture against walls' },
    { value: 'Fixtures', label: 'Built-in fixtures (cabinets, wardrobes)' },
    { value: 'Flooring', label: 'Floor coverings (carpet, tiles, floating floors)' },
    { value: 'Items/belongings stored against wall', label: 'Belongings stored against walls' },
    { value: 'Items/belongings stored in cupboards', label: 'Belongings stored in cupboards' },
  ];

  const INSIDE_ZONE = 'Inside';
  const KEY = (jobId) => 'scope-photo-walk:' + jobId;
  // 'nophoto' (v144): the spot is here but could not be photographed. It
  // only counts with a reason, which the report prints.
  const RESULTS = ['ok', 'issue', 'nophoto'];

  function isGuided(items) {
    return Array.isArray(items) && items.length > 0 && items.every((i) => !!i.area);
  }

  const TIPS = ['ok', 'issue', 'unsure'];

  function blankState() { return { skipped: [], answers: {}, results: {}, notesSaved: false, notes: null }; }

  // Anything stored (this phone, or the report) made safe to use.
  function cleanState(s) {
    if (!s || typeof s !== 'object') return blankState();
    const results = {};
    if (s.results && typeof s.results === 'object') {
      for (const id of Object.keys(s.results)) {
        const r = s.results[id];
        if (!r || !RESULTS.includes(r.r)) continue;
        results[id] = { r: r.r, at: Number(r.at) || 0 };
        if (typeof r.note === 'string' && r.note.trim()) results[id].note = r.note.trim().slice(0, 300);
        if (r.r === 'nophoto' && !results[id].note) { delete results[id]; continue; }
        // What kind of issue (walk-rollup.js KINDS), for timber.
        if (r.r === 'issue' && Array.isArray(r.kinds)) {
          const kinds = r.kinds.filter((k) => typeof k === 'string').slice(0, 8);
          if (kinds.length) results[id].kinds = kinds;
        }
        // What the AI suggested for this spot (v148), kept beside what the
        // technician tapped so the two can be compared later.
        if (TIPS.includes(r.ai)) results[id].ai = r.ai;
        // Why an Issue (or a found notice) has no photo (v151).
        if (typeof r.noPhoto === 'string' && r.noPhoto.trim()) results[id].noPhoto = r.noPhoto.trim().slice(0, 300);
      }
    }
    return {
      skipped: Array.isArray(s.skipped) ? s.skipped.filter((x) => typeof x === 'string') : [],
      answers: s.answers && typeof s.answers === 'object' ? { ...s.answers } : {},
      results,
      notesSaved: !!s.notesSaved,
      notes: Array.isArray(s.notes) ? s.notes.filter((x) => typeof x === 'string') : null,
    };
  }

  function loadState(jobId) {
    try {
      const raw = localStorage.getItem(KEY(jobId));
      return cleanState(raw ? JSON.parse(raw) : null);
    } catch (e) { return blankState(); }
  }

  function saveState(jobId, state) {
    try { localStorage.setItem(KEY(jobId), JSON.stringify(state)); } catch (e) { /* private mode: the walk still works, it just forgets */ }
  }

  // This phone's copy and the report's copy (another phone's work) as one.
  // Per spot the later tap wins; this phone wins a tie and the two questions,
  // because it is the one being held on site right now.
  function mergeStates(local, remote) {
    const a = cleanState(local);
    const b = cleanState(remote);
    const out = cleanState(a);
    for (const id of Object.keys(b.results)) {
      if (!out.results[id] || b.results[id].at > out.results[id].at) out.results[id] = b.results[id];
    }
    for (const id of b.skipped) {
      if (!out.skipped.includes(id) && !out.results[id]) out.skipped.push(id);
    }
    out.skipped = out.skipped.filter((id) => !out.results[id]);
    for (const area of Object.keys(b.answers)) {
      if (!out.answers[area]) out.answers[area] = b.answers[area];
    }
    out.notesSaved = a.notesSaved || b.notesSaved;
    return out;
  }

  // The ordered steps for this job as things stand. The front photo is left
  // out (it has its own prompt) and so are hidden items. An answered question
  // stays in the list, so the answer can be changed: No drops the area's
  // photos, and can't-get-in keeps only the steps that say what to show
  // instead (`blockedHint`: why it could not be entered).
  function buildSteps(items, state) {
    const st = state || blankState();
    const steps = [];
    for (const area of AREAS) {
      if (area.notes) {
        const ticks = items.filter((i) => i.area === area.id && !i.hidden && i.tick);
        if (ticks.length) steps.push({ kind: 'checks', area: area.id, areaTitle: area.title, items: ticks });
        steps.push({ kind: 'notes', area: area.id, areaTitle: area.title });
        continue;
      }
      const photos = items.filter((i) => i.area === area.id && !i.hidden && !i.tick && i.id !== 'frontElevation');
      if (!photos.length) continue;
      if (area.ask) steps.push({ kind: 'question', area: area.id, areaTitle: area.title, ask: area.ask, answers: area.answers });
      const answer = area.ask ? st.answers[area.id] : null;
      if (answer === 'no') continue;
      if (answer === 'blocked') {
        // Could not get in: one photo of why, and nothing to tick.
        for (const item of photos) {
          if (item.blockedHint) steps.push({ kind: 'photo', area: area.id, areaTitle: area.title, item, hint: item.blockedHint, blocked: true });
        }
      } else {
        // The whole area on one screen (v151): tick each, photograph issues.
        steps.push({ kind: 'checks', area: area.id, areaTitle: area.title, items: photos });
      }
    }
    steps.push({ kind: 'done', area: 'done', areaTitle: 'Done' });
    return steps;
  }

  // Whether this answer has to be backed by a photo (v151): any Issue, and
  // an OK that means "found it" (the durable notice). A typed reason for
  // having no photo stands in for one.
  function needsPhoto(item, result) {
    if (!result || result.noPhoto) return false;
    // For the durable notice the answers run the other way: "found" is the
    // one to photograph, and "no notice" has nothing to show.
    if (item.photoWhen === 'ok') return result.r === 'ok';
    return result.r === 'issue';
  }

  // A photo step is finished when the spot is not here, or it has a photo AND
  // someone has said what the photo shows. The photo of why an area could not
  // be entered needs no verdict: it is the evidence, not a check.
  function stepComplete(step, done, state) {
    const results = state.results || {};
    if (step.kind === 'photo') {
      if (state.skipped.includes(step.item.id)) return true;
      if (results[step.item.id] && results[step.item.id].r === 'nophoto') return true;
      if (!done.has(step.item.label)) return false;
      return step.blocked ? true : !!results[step.item.id];
    }
    if (step.kind === 'question') return !!state.answers[step.area];
    if (step.kind === 'checks') {
      return step.items.every((i) => {
        if (state.skipped.includes(i.id)) return true;
        if (!results[i.id]) return false;
        return !needsPhoto(i, results[i.id]) || done.has(i.label);
      });
    }
    if (step.kind === 'notes') return !!state.notesSaved;
    return false;
  }

  // Where a re-opened camera should land: the first thing not yet dealt with.
  function firstOpenIndex(steps, done, state) {
    const i = steps.findIndex((s) => !stepComplete(s, done, state));
    return i === -1 ? steps.length - 1 : i;
  }

  // What is still to do, in walking order, in words a technician can act on.
  // Used by the walk's last step and by the report screen.
  function outstanding(items, state, done) {
    const st = cleanState(state);
    const doneSet = done || new Set();
    const out = [];
    for (const step of buildSteps(items, st)) {
      if (step.kind === 'done' || stepComplete(step, doneSet, st)) continue;
      if (step.kind === 'photo') {
        const got = doneSet.has(step.item.label);
        out.push({ area: step.area, areaTitle: step.areaTitle, kind: 'photo', id: step.item.id, label: step.item.label,
          need: got ? 'mark OK or Issue' : 'photo, or Not here' });
      } else if (step.kind === 'question') {
        out.push({ area: step.area, areaTitle: step.areaTitle, kind: 'question', id: step.area, label: step.ask, need: 'answer' });
      } else if (step.kind === 'checks') {
        const left = step.items.filter((i) => !st.results[i.id] && !st.skipped.includes(i.id));
        if (left.length) {
          out.push({ area: step.area, areaTitle: step.areaTitle, kind: 'checks', id: 'checks',
            label: left.length === 1 ? left[0].label : `${left.length} ${step.area === 'inside' ? 'rooms and checks' : 'items'}`, need: 'tick OK or Issue' });
        }
        for (const i of step.items) {
          if (st.skipped.includes(i.id) || !needsPhoto(i, st.results[i.id]) || doneSet.has(i.label)) continue;
          out.push({ area: step.area, areaTitle: step.areaTitle, kind: 'checks', id: i.id, label: i.label,
            need: st.results[i.id].r === 'issue' ? 'photo of the issue' : 'photo of it' });
        }
      } else if (step.kind === 'notes') {
        out.push({ area: step.area, areaTitle: step.areaTitle, kind: 'notes', id: 'notes', label: 'What blocked the view inside', need: 'save the ticks' });
      }
    }
    return out;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(text, cls, onClick, extra) {
    const b = el('button', 'walk-btn ' + (cls || ''), text);
    b.type = 'button';
    if (extra) Object.assign(b, extra);
    b.addEventListener('click', onClick);
    return b;
  }

  // container: the card element over the camera preview.
  // items: the job's checklist. done(): the set of zone labels with a photo.
  // setZone(label): sets the zone box as if typed. saveNotes(list): writes
  // the inside ticks into the report, resolving true when it did;
  // saveAnswer(area, value) does the same for a question's answer.
  // saveResults(state): told after every change, to copy the walk into the
  // report. remote: the report's copy of the walk, if it has one.
  function mount({ container, jobId, items, done, setZone, saveNotes, saveAnswer, saveResults, suggest, refile, remote, visible: startVisible }) {
    let state = remote ? mergeStates(loadState(jobId), remote) : loadState(jobId);
    let steps = buildSteps(items, state);
    let index = firstOpenIndex(steps, done(), state);
    let banner = '';
    let bannerTimer = null;
    let visible = startVisible !== false;
    let saving = false;
    let noteOpenFor = null; // the item whose Issue note box is showing
    let draft = null;       // { id, note, kinds } being filled in there
    // The AI's suggestion per spot (v148): { wait } while it looks, then
    // { verdict, reason, note, kinds }. Never stored and never an answer:
    // it points at a button, the technician taps one.
    const tips = {};
    let tipSeq = 0;
    // A photo taken on a tick list with no item open (v151): the technician
    // photographed the problem first and will tap Issue next. Kept for a few
    // minutes so that Issue can claim it instead of asking for another.
    let loose = null;
    const LOOSE_MS = 5 * 60 * 1000;

    function say(text) {
      banner = text;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner = ''; render(); }, 6000);
    }

    // Moves the loose photo onto this item, if there is one and the item has
    // none yet. Resolves true when it did.
    async function claimLoose(item, step) {
      if (!loose || !refile || done().has(item.label)) return false;
      if (Date.now() - loose.at > LOOSE_MS || loose.area !== step.area) { loose = null; return false; }
      const mine = loose;
      loose = null;
      let ok = false;
      try { ok = await refile(mine.id, item.label); } catch (e) { ok = false; }
      if (!ok) return false;
      say('✓ Your last photo is now filed under ' + item.label + '.');
      const res = state.results[item.id];
      if (res && res.r === 'issue') askTip(item, mine.blob);
      render();
      return true;
    }

    function askTip(item, blob) {
      if (!suggest || !blob) return;
      const mine = ++tipSeq;
      tips[item.id] = { wait: true, seq: mine };
      let asked;
      try { asked = suggest(blob, item); } catch (e) { asked = null; }
      if (!asked || typeof asked.then !== 'function') { delete tips[item.id]; return; }
      const settle = (tip) => {
        // A newer photo of the same spot has been sent since: that one wins.
        if (!tips[item.id] || tips[item.id].seq !== mine) return;
        if (tip) tips[item.id] = tip; else delete tips[item.id];
        // On a tick list the answer is already in: keep what the AI made of
        // the photo beside it.
        const res = state.results[item.id];
        if (tip && res && res.r !== 'nophoto' && res.ai !== tip.verdict) { res.ai = tip.verdict; persist(); }
        const step = steps[index];
        if (step && step.kind === 'photo' && step.item.id === item.id) render();
        if (step && step.kind === 'checks' && noteOpenFor === item.id) render();
      };
      asked.then((r) => {
        if (!r || !TIPS.includes(r.verdict)) { settle(null); return; }
        settle({
          verdict: r.verdict, seq: mine,
          reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '',
          note: typeof r.note === 'string' ? r.note.slice(0, 300) : '',
          kinds: Array.isArray(r.kinds) ? r.kinds.filter((k) => typeof k === 'string') : [],
        });
      }, () => settle(null));
    }

    function tipFor(id) { const t = tips[id]; return t && !t.wait ? t : null; }

    function persist() {
      saveState(jobId, state);
      if (saveResults) {
        try { Promise.resolve(saveResults(cleanState(state))).catch(() => {}); } catch (e) { /* the phone's copy is the one that matters on site */ }
      }
    }

    function zoneFor(step) {
      if (step.kind === 'photo') return step.item.label;
      if (step.kind === 'notes') return INSIDE_ZONE;
      if (step.kind === 'checks') return step.area === 'inside' ? INSIDE_ZONE : '';
      return '';
    }

    function go(i, { quiet } = {}) {
      // Leaving a tick list with an issue box open keeps what was typed in it.
      commitDraft();
      index = Math.max(0, Math.min(steps.length - 1, i));
      noteOpenFor = null;
      draft = null;
      if (!quiet) { banner = ''; clearTimeout(bannerTimer); }
      setZone(zoneFor(steps[index]));
      render();
    }

    function next() { go(index + 1); }

    // An area button: the first thing still open there, or its first step.
    function goArea(areaId) {
      const doneSet = done();
      let at = steps.findIndex((s) => s.area === areaId && !stepComplete(s, doneSet, state));
      if (at === -1) at = steps.findIndex((s) => s.area === areaId);
      if (at !== -1) go(at);
    }

    function goStep(match) {
      const at = steps.findIndex((s) => s.kind === match.kind && s.area === match.area
        && (s.kind !== 'photo' || s.item.id === match.id));
      if (at !== -1) go(at);
    }

    function rebuild(keepStep) {
      steps = buildSteps(items, state);
      if (keepStep) {
        const at = steps.findIndex((s) => s.kind === keepStep.kind && s.area === keepStep.area
          && (s.kind !== 'photo' || s.item.id === keepStep.item.id));
        if (at !== -1) index = at;
      }
    }

    // Written into the report first; the walk only moves on once it is, so a
    // failed save leaves the question up to answer again.
    async function answer(value) {
      if (saving) return;
      const step = steps[index];
      saving = true;
      let ok = true;
      if (saveAnswer) {
        try { ok = await saveAnswer(step.area, value); } catch (err) { ok = false; }
      }
      saving = false;
      if (!ok) { render(); return; }
      state.answers[step.area] = value;
      persist();
      rebuild(step);
      next();
    }

    function skip() {
      const step = steps[index];
      if (step.kind === 'photo') {
        if (!state.skipped.includes(step.item.id)) state.skipped.push(step.item.id);
        delete state.results[step.item.id];
        persist();
      }
      next();
    }

    function setResult(id, r, note, kinds) {
      const before = state.results[id];
      // A reason for no photo belongs to the answer it was given for.
      const prevNoPhoto = before && before.r === r ? before.noPhoto : null;
      state.results[id] = { r, at: Date.now() };
      const tip = tipFor(id);
      if (tip && r !== 'nophoto') state.results[id].ai = tip.verdict;
      if (note && note.trim()) state.results[id].note = note.trim().slice(0, 300);
      if (r === 'issue' && Array.isArray(kinds) && kinds.length) state.results[id].kinds = kinds.slice();
      if (prevNoPhoto && r !== 'nophoto') state.results[id].noPhoto = prevNoPhoto;
      state.skipped = state.skipped.filter((x) => x !== id);
      persist();
    }

    // Whatever is typed or ticked in the open issue box of a tick list is
    // written to the answer. Called before anything redraws or moves on.
    function commitDraft() {
      if (!draft || !noteOpenFor || draft.id !== noteOpenFor) return;
      const cur = state.results[draft.id];
      if (!cur || cur.r === 'nophoto') return;
      const step = steps[index];
      if (!step || step.kind !== 'checks') return;
      const same = (cur.note || '') === draft.note.trim() && (cur.kinds || []).join() === draft.kinds.join()
        && (cur.noPhoto || '') === (draft.noPhoto || '').trim();
      if (same) return;
      const ai = cur.ai;
      state.results[draft.id] = { r: cur.r, at: Date.now() };
      if (draft.note.trim()) state.results[draft.id].note = draft.note.trim().slice(0, 300);
      if (cur.r === 'issue' && draft.kinds.length) state.results[draft.id].kinds = draft.kinds.slice();
      if ((draft.noPhoto || '').trim()) state.results[draft.id].noPhoto = draft.noPhoto.trim().slice(0, 300);
      if (ai) state.results[draft.id].ai = ai;
      persist();
    }

    function renderAreas(step, doneSet) {
      const row = el('div', 'walk-areas');
      for (const area of AREAS) {
        const mine = steps.filter((s) => s.area === area.id);
        if (!mine.length) continue;
        const left = mine.filter((s) => !stepComplete(s, doneSet, state)).length;
        const b = btn(area.title + (left ? ' ' + left : ' ✓'), 'walk-area' + (step.area === area.id ? ' current' : '') + (left ? '' : ' clear'),
          () => goArea(area.id));
        b.dataset.area = area.id;
        b.setAttribute('aria-label', area.title + (left ? `: ${left} still to do` : ': all done'));
        row.appendChild(b);
      }
      return row;
    }

    // "What kind of issue?" for timber (walk-rollup.js): any number of them.
    function kindChips(item, chosen, onChange) {
      const kinds = window.WalkRollup ? window.WalkRollup.kindsFor(item) : [];
      if (!kinds.length) return null;
      const row = el('div', 'walk-kinds');
      row.appendChild(el('div', 'walk-kinds-ask', 'What is it? Tick any that apply.'));
      for (const k of kinds) {
        const b = btn(k.label, 'walk-kind' + (chosen.includes(k.id) ? ' chosen-issue' : ''), () => {
          const at = chosen.indexOf(k.id);
          if (at === -1) chosen.push(k.id); else chosen.splice(at, 1);
          b.classList.toggle('chosen-issue', chosen.includes(k.id));
          if (onChange) onChange(chosen);
        });
        b.dataset.kind = k.id;
        row.appendChild(b);
      }
      return row;
    }

    function noteBox(item, existing, onSave, opts) {
      const o = opts || {};
      const wrap = el('div', 'walk-issue');
      // What is being typed and ticked lives outside this box, because the
      // card is redrawn under it (a photo arriving, the banner timing out)
      // and a redraw must not throw away half an answer.
      if (!draft || draft.id !== item.id) draft = { id: item.id, note: existing || '', kinds: (o.kinds || []).slice() };
      const picked = draft.kinds;
      if (!o.required) { const chips = kindChips(item, picked); if (chips) wrap.appendChild(chips); }
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'walk-other walk-issue-note';
      input.maxLength = 300;
      input.placeholder = o.placeholder || 'What is wrong? (optional)';
      input.value = draft.note;
      input.addEventListener('input', () => { if (draft) draft.note = input.value; });
      wrap.appendChild(input);
      const save = btn(o.saveLabel || 'Save issue, next ›', 'walk-primary walk-issue-save', () => {
        if (o.required && !input.value.trim()) { input.focus(); return; }
        onSave(input.value, picked);
      });
      wrap.appendChild(save);
      return wrap;
    }

    function render() {
      container.innerHTML = '';
      container.classList.toggle('hidden', !visible);
      if (!visible) return;
      const step = steps[index];
      const doneSet = done();
      const countable = steps.filter((s) => s.kind !== 'done');
      const pos = countable.indexOf(step);

      if (banner) container.appendChild(el('div', 'walk-banner', banner));
      container.appendChild(renderAreas(step, doneSet));
      const meta = step.kind === 'done' ? 'All areas' : `${step.areaTitle} · ${pos + 1} of ${countable.length}`;
      container.appendChild(el('div', 'walk-meta', meta));

      const actions = el('div', 'walk-actions');
      const back = btn('‹', 'walk-back', () => go(index - 1), { disabled: index === 0 });
      back.setAttribute('aria-label', 'Previous step');
      actions.appendChild(back);

      if (step.kind === 'photo') {
        const got = doneSet.has(step.item.label);
        const result = state.results[step.item.id];
        const finished = stepComplete(step, doneSet, state);
        container.appendChild(el('div', 'walk-title', (finished ? '✓ ' : '') + step.item.label));
        if (step.hint) container.appendChild(el('div', 'walk-hint', step.hint));
        if (got && step.blocked) {
          container.appendChild(el('div', 'walk-got', 'Photo saved. Take another, or go on.'));
          actions.appendChild(btn('Next ›', 'walk-primary', next));
        } else if (got) {
          const verdict = result && result.r !== 'nophoto' ? result : null;
          container.appendChild(el('div', 'walk-got', verdict
            ? (verdict.r === 'ok' ? 'Photo saved, marked OK.' : 'Photo saved, marked as an issue' + (verdict.note ? ': ' + verdict.note : '.'))
            : 'Photo saved. What does it show?'));
          const waiting = tips[step.item.id] && tips[step.item.id].wait;
          const tip = tipFor(step.item.id);
          if (!verdict && waiting) {
            const line = el('div', 'walk-tip walk-tip-wait', 'AI is looking at the photo… you do not have to wait.');
            line.dataset.tip = 'wait';
            container.appendChild(line);
          } else if (!verdict && tip) {
            const says = tip.verdict === 'ok' ? 'AI suggests: ' + (step.item.okLabel || 'OK') + '.'
              : tip.verdict === 'issue' ? 'AI suggests: ' + (step.item.issueLabel || 'Issue') + '.'
                : 'AI cannot tell from this photo.';
            const line = el('div', 'walk-tip walk-tip-' + tip.verdict, says + (tip.reason ? ' ' + tip.reason : ''));
            line.dataset.tip = tip.verdict;
            container.appendChild(line);
            if (tip.verdict !== 'unsure') container.appendChild(el('div', 'walk-tip-own', 'Check it yourself, then tap your answer.'));
          }
          if (noteOpenFor === step.item.id) {
            // The AI's wording is offered as a start, only where nothing was
            // written yet; it is saved only when the technician taps Save.
            const fromTip = tip && tip.verdict === 'issue' && !(result && result.r === 'issue');
            container.appendChild(noteBox(step.item, (result && result.note) || (fromTip ? tip.note : ''),
              (note, kinds) => { setResult(step.item.id, 'issue', note, kinds); next(); },
              { kinds: (result && result.kinds) || (fromTip ? tip.kinds : null) }));
          } else {
            const points = !verdict && tip ? tip.verdict : '';
            const ok = btn('✓ ' + (step.item.okLabel || 'OK'), 'walk-primary' + (result && result.r === 'ok' ? ' chosen' : '') + (points === 'ok' ? ' suggested' : ''), () => { setResult(step.item.id, 'ok'); next(); });
            ok.dataset.result = 'ok';
            const issue = btn('⚠ ' + (step.item.issueLabel || 'Issue'), 'walk-secondary walk-issue-btn' + (result && result.r === 'issue' ? ' chosen' : '') + (points === 'issue' ? ' suggested' : ''), () => { noteOpenFor = step.item.id; draft = null; render(); });
            issue.dataset.result = 'issue';
            actions.appendChild(ok);
            actions.appendChild(issue);
          }
        } else if (noteOpenFor === step.item.id) {
          container.appendChild(noteBox(step.item, result && result.note,
            (note) => { setResult(step.item.id, 'nophoto', note); next(); },
            { required: true, placeholder: 'Why could it not be photographed?', saveLabel: 'Save reason, next ›' }));
        } else {
          if (state.skipped.includes(step.item.id)) container.appendChild(el('div', 'walk-got', 'Marked as not here. Take a photo if that was wrong.'));
          if (result && result.r === 'nophoto') container.appendChild(el('div', 'walk-got', 'No photo: ' + result.note));
          const none = btn('Not here', 'walk-secondary', skip);
          none.dataset.result = 'nothere';
          actions.appendChild(none);
          if (!step.blocked) {
            const cant = btn('Can’t photo', 'walk-secondary', () => { noteOpenFor = step.item.id; draft = null; render(); });
            cant.dataset.result = 'nophoto';
            actions.appendChild(cant);
          }
        }
      } else if (step.kind === 'question') {
        container.appendChild(el('div', 'walk-title', step.ask));
        container.appendChild(el('div', 'walk-hint', 'Your answer goes into the report.'));
        const current = state.answers[step.area];
        const choices = el('div', 'walk-choices');
        step.answers.forEach((a, k) => {
          const b = btn((current === a.value ? '✓ ' : '') + a.label,
            (k === 0 ? 'walk-primary' : 'walk-secondary') + (current === a.value ? ' chosen' : ''),
            (e) => { e.currentTarget.disabled = true; answer(a.value); });
          b.dataset.answer = a.value;
          choices.appendChild(b);
        });
        container.appendChild(choices);
      } else if (step.kind === 'checks') {
        const inside = step.area === 'inside';
        container.appendChild(el('div', 'walk-title', (inside ? 'Inside' : step.areaTitle) + ': tick each one'));
        container.appendChild(el('div', 'walk-hint', inside
          ? 'No photos needed inside unless something is wrong. Mark an Issue, then photograph it.'
          : 'Tap Issue only where something is wrong, then photograph it. Then “Rest are OK”.'));
        const list = el('div', 'walk-checks');
        const closeBox = () => { commitDraft(); noteOpenFor = null; draft = null; setZone(zoneFor(step)); render(); };
        for (const item of step.items) {
          const result = state.results[item.id];
          const gone = state.skipped.includes(item.id);
          const row = el('div', 'walk-check' + (gone ? ' walk-check-gone' : ''));
          row.dataset.item = item.id;
          const text = el('div', 'walk-check-text');
          text.appendChild(el('div', 'walk-check-label', item.label));
          if (inside && item.hint) text.appendChild(el('div', 'walk-check-hint', item.hint));
          if (!gone && needsPhoto(item, result) && !doneSet.has(item.label)) {
            const need = el('div', 'walk-check-need', 'Needs a photo');
            need.dataset.need = 'photo';
            text.appendChild(need);
          }
          row.appendChild(text);
          const open = (r) => {
            commitDraft();
            setResult(item.id, r, result && result.r === r ? result.note : '', result && result.r === r ? result.kinds : null);
            const wantsBox = needsPhoto(item, { r }) || (r === 'issue' && item.photoWhen !== 'ok');
            noteOpenFor = wantsBox ? item.id : null;
            draft = null;
            // The next photo is of this item, so it is filed under it.
            setZone(wantsBox ? item.label : zoneFor(step));
            render();
            if (needsPhoto(item, state.results[item.id])) claimLoose(item, step);
          };
          const ok = btn(item.okLabel || 'OK', 'walk-mini' + (!gone && result && result.r === 'ok' ? ' chosen-ok' : ''), () => open('ok'));
          ok.dataset.result = 'ok';
          const issue = btn(item.issueLabel || 'Issue', 'walk-mini' + (!gone && result && result.r === 'issue' ? ' chosen-issue' : ''), () => open('issue'));
          issue.dataset.result = 'issue';
          const na = btn('N/A', 'walk-mini walk-mini-na' + (gone ? ' chosen-na' : ''), () => {
            commitDraft();
            if (!state.skipped.includes(item.id)) state.skipped.push(item.id);
            delete state.results[item.id];
            persist();
            if (noteOpenFor === item.id) { noteOpenFor = null; draft = null; setZone(zoneFor(step)); }
            render();
          });
          na.dataset.result = 'nothere';
          na.setAttribute('aria-label', item.label + ': not at this property');
          row.appendChild(ok);
          row.appendChild(issue);
          row.appendChild(na);
          list.appendChild(row);

          if (noteOpenFor === item.id && result && !gone) {
            const isIssue = result.r === 'issue';
            const got = doneSet.has(item.label);
            const wrap = el('div', 'walk-issue');
            wrap.dataset.box = item.id;
            wrap.appendChild(el('div', 'walk-got', got
              ? '✓ Photo saved under ' + item.label + '. Take another if it helps.'
              : 'Photograph it now: the next photo is filed under ' + item.label + '.'));
            if (!inside && item.hint) wrap.appendChild(el('div', 'walk-check-hint', item.hint));
            if (!draft || draft.id !== item.id) draft = { id: item.id, note: result.note || '', kinds: (result.kinds || []).slice(), noPhoto: result.noPhoto || '' };
            if (isIssue) {
              // The AI's reading of the photo (v148, v151): offered, never applied.
              const waiting = tips[item.id] && tips[item.id].wait;
              const tip = tipFor(item.id);
              if (waiting) {
                const line = el('div', 'walk-tip walk-tip-wait', 'AI is looking at the photo… you do not have to wait.');
                line.dataset.tip = 'wait';
                wrap.appendChild(line);
              } else if (tip) {
                const says = tip.verdict === 'issue' ? 'AI suggests: ' + (tip.note || tip.reason)
                  : tip.verdict === 'ok' ? 'AI could not see an issue in this photo. Check it shows the problem.'
                    : 'AI cannot tell from this photo.';
                const line = el('div', 'walk-tip walk-tip-' + tip.verdict, says);
                line.dataset.tip = tip.verdict;
                wrap.appendChild(line);
                if (tip.verdict === 'issue' && tip.note) {
                  const use = btn('Use this wording', 'walk-secondary walk-tip-use', () => {
                    draft.note = tip.note;
                    // Only kinds this item is actually asked about.
                    const offered = (window.WalkRollup ? window.WalkRollup.kindsFor(item) : []).map((k) => k.id);
                    for (const k of tip.kinds) if (offered.includes(k) && !draft.kinds.includes(k)) draft.kinds.push(k);
                    commitDraft();
                    render();
                  });
                  use.dataset.action = 'use-tip';
                  wrap.appendChild(use);
                }
              }
              const chips = kindChips(item, draft.kinds, () => commitDraft());
              if (chips) wrap.appendChild(chips);
              const input = document.createElement('input');
              input.type = 'text';
              input.className = 'walk-other walk-issue-note';
              input.maxLength = 300;
              input.placeholder = 'What is wrong? (optional)';
              input.value = draft.note;
              input.addEventListener('input', () => { if (draft) draft.note = input.value; });
              input.addEventListener('change', () => commitDraft());
              wrap.appendChild(input);
            }
            if (!got) {
              const why = document.createElement('input');
              why.type = 'text';
              why.className = 'walk-other walk-nophoto-reason';
              why.maxLength = 300;
              why.placeholder = 'Can’t photograph it? Say why';
              why.value = draft.noPhoto;
              why.addEventListener('input', () => { if (draft) draft.noPhoto = why.value; });
              why.addEventListener('change', () => { commitDraft(); render(); });
              wrap.appendChild(why);
            }
            const doneBtn = btn('Done', 'walk-primary walk-issue-save', closeBox);
            doneBtn.dataset.action = 'close-issue';
            wrap.appendChild(doneBtn);
            list.appendChild(wrap);
          }
        }
        container.appendChild(list);
        const unanswered = step.items.filter((i) => !state.results[i.id] && !state.skipped.includes(i.id));
        // "Rest are OK" never answers an item whose OK needs a photo (the
        // durable notice): that one is answered on purpose.
        const sweep = unanswered.filter((i) => i.photoWhen !== 'ok');
        if (sweep.length) {
          const all = btn(sweep.length === step.items.length ? 'All OK' : 'Rest are OK', 'walk-secondary', () => {
            commitDraft();
            for (const i of sweep) setResult(i.id, 'ok');
            noteOpenFor = null;
            draft = null;
            setZone(zoneFor(step));
            render();
          });
          all.dataset.action = 'all-ok';
          actions.appendChild(all);
        }
        actions.appendChild(btn('Next ›', 'walk-primary', () => { commitDraft(); next(); }, { disabled: unanswered.length > 0 }));
      } else if (step.kind === 'notes') {
        container.appendChild(el('div', 'walk-title', 'Inside: what blocked the view'));
        container.appendChild(el('div', 'walk-hint',
          'Tick what stopped you seeing walls and floors. These go into the report. No photos of these.'));
        const chosen = new Set(state.notes || INSIDE_NOTES.map((n) => n.value));
        const list = el('div', 'walk-notes');
        for (const n of INSIDE_NOTES) {
          const row = el('label', 'walk-note');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = n.value;
          cb.checked = chosen.has(n.value);
          row.appendChild(cb);
          row.appendChild(document.createTextNode(n.label));
          list.appendChild(row);
        }
        const known = new Set(INSIDE_NOTES.map((n) => n.value));
        const other = document.createElement('input');
        other.type = 'text';
        other.className = 'walk-other';
        other.maxLength = 120;
        other.placeholder = 'Anything else? e.g. boxes stacked in the spare room';
        other.value = (state.notes || []).filter((v) => !known.has(v)).join(', ');
        list.appendChild(other);
        container.appendChild(list);
        actions.appendChild(btn(state.notesSaved ? 'Save again, next ›' : 'Save, next ›', 'walk-primary', async (e) => {
          if (saving) return;
          saving = true;
          e.currentTarget.disabled = true;
          const picked = Array.from(list.querySelectorAll('input[type=checkbox]')).filter((c) => c.checked).map((c) => c.value);
          const extra = other.value.split(',').map((s) => s.trim()).filter(Boolean);
          const all = Array.from(new Set([...picked, ...extra]));
          let ok = false;
          try { ok = await saveNotes(all); } catch (err) { ok = false; }
          saving = false;
          if (!ok) { render(); return; }
          state.notes = all;
          state.notesSaved = true;
          persist();
          next();
        }));
      } else {
        const todo = outstanding(items, state, doneSet);
        if (!todo.length) {
          container.appendChild(el('div', 'walk-title', '✓ All areas done'));
          container.appendChild(el('div', 'walk-hint', 'Tap Generate Form when you are ready, or go back to add anything.'));
        } else {
          container.appendChild(el('div', 'walk-title', `${todo.length} still to do`));
          container.appendChild(el('div', 'walk-hint', 'Tap one to go straight to it.'));
          const list = el('div', 'walk-todo');
          for (const t of todo) {
            const b = btn(`${t.areaTitle}: ${t.label}`, 'walk-todo-item', () => goStep(t));
            b.appendChild(el('span', 'walk-todo-need', t.need));
            b.dataset.todo = t.id;
            list.appendChild(b);
          }
          container.appendChild(list);
        }
      }
      container.appendChild(actions);
    }

    function onShow() {
      setZone(zoneFor(steps[index]));
      render();
    }

    return {
      // The front photo has just been saved: say so, and say what is next.
      frontSaved() {
        const step = steps[index];
        const nextName = step.kind === 'photo' ? step.item.label : step.areaTitle;
        banner = '✓ Front photo saved. Next: ' + nextName + '.';
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => { banner = ''; render(); }, 6000);
        render();
        return nextName;
      },
      photoSaved(blob, captureId) {
        // A photo of a spot that had been marked "not here" means it is here.
        const step = steps[index];
        // Ask the AI what it shows (v148), unless the spot is already answered
        // or it is the "why I could not get in" photo of a blocked area.
        if (step && step.kind === 'photo' && !step.blocked && done().has(step.item.label)) {
          const had = state.results[step.item.id];
          if (!had || had.r === 'nophoto') askTip(step.item, blob);
        }
        // On a tick list (v151) the photo is of the open Issue: ask the AI to
        // describe it. A photo also makes a typed "can't photograph" moot.
        if (step && step.kind === 'checks' && !noteOpenFor && captureId) {
          loose = { id: captureId, blob, at: Date.now(), area: step.area };
          say('Photo saved. Tap Issue on the item it shows and it will be filed there.');
        }
        if (step && step.kind === 'checks' && noteOpenFor) {
          const item = step.items.find((i) => i.id === noteOpenFor);
          const res = item && state.results[item.id];
          if (item && res && done().has(item.label)) {
            if (draft && draft.id === item.id) draft.noPhoto = '';
            if (res.noPhoto) { delete res.noPhoto; persist(); }
            if (res.r === 'issue') askTip(item, blob);
          }
        }
        if (step && step.kind === 'photo' && done().has(step.item.label) && state.skipped.includes(step.item.id)) {
          state.skipped = state.skipped.filter((x) => x !== step.item.id);
          persist();
        }
        // Likewise a photo of a spot marked "can't photograph".
        if (step && step.kind === 'photo' && done().has(step.item.label)
          && state.results[step.item.id] && state.results[step.item.id].r === 'nophoto') {
          delete state.results[step.item.id];
          persist();
        }
        render();
      },
      // The zone box changed (a chip, or typing). A checklist label jumps the
      // walk to that step; anything else leaves the walk where it is.
      zoneChanged(label) {
        const at = steps.findIndex((s) => s.kind === 'photo' && s.item.label === label);
        if (at !== -1 && at !== index) { index = at; noteOpenFor = null; draft = null; render(); return; }
        // An item on a tick list (v151): go to its list, and open it if it is
        // already an Issue, so the photo about to be taken belongs to it.
        const list = steps.findIndex((s) => s.kind === 'checks' && s.items.some((i) => i.label === label));
        if (list === -1) return;
        const item = steps[list].items.find((i) => i.label === label);
        const res = state.results[item.id];
        const wantsBox = !!res && (item.photoWhen === 'ok' ? res.r === 'ok' : res.r === 'issue');
        if (list === index && noteOpenFor === (wantsBox ? item.id : null)) return;
        commitDraft();
        index = list;
        noteOpenFor = wantsBox ? item.id : null;
        draft = null;
        render();
      },
      setVisible(on) {
        const was = visible;
        visible = !!on;
        if (visible && !was) onShow(); else render();
      },
      start() { if (visible) onShow(); else render(); },
      current() { return steps[index]; },
      state() { return cleanState(state); },
      // Finishing the inspection with an issue box open keeps what was typed.
      destroy() { commitDraft(); clearTimeout(bannerTimer); loose = null; container.innerHTML = ''; container.classList.add('hidden'); },
    };
  }

  window.PhotoWalk = { isGuided, buildSteps, firstOpenIndex, outstanding, needsPhoto, mergeStates, loadState, saveState, mount, AREAS, INSIDE_NOTES, INSIDE_ZONE };
})();
