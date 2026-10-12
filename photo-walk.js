// Guided photo walk for the timber pest inspection (v118).
//
// After the front photo, the camera used to leave the technician with a row
// of chips and a zone box: everything that ought to be photographed was there,
// but in no order, and remembering what was left was their job. This turns
// the same checklist (photo-checklists.js, items carrying an `area`) into one
// step at a time, in the order the property is walked:
//
//   Outside      every photo step for the exterior
//   Subfloor     "Is there a subfloor?" first; No skips its steps
//   Roof void    the same question, then its steps
//   Inside       no photos: a few ticks for what blocked the view, written
//                into the report's Areas We Were Unable to Inspect section
//   Done         says so, and points at Generate Form
//
// Each step sets the zone for the photos taken on it, exactly as tapping its
// chip does, so filing them into the report is unchanged. Nothing is ever
// forced: Skip moves on, Back goes back, the chips still jump anywhere, and a
// zone typed by hand still works for something off the list.
//
// Where the walk is up to (skips and the Yes/No answers) is kept on this phone
// in localStorage, per job. It is about this visit on this device, so it has
// no business being synced, and a re-opened camera picks up where it left off.
//
// EXPOSES: window.PhotoWalk = { isGuided, buildSteps, firstOpenIndex,
//   loadState, saveState, mount, AREAS, INSIDE_NOTES }

(() => {
  'use strict';

  const AREAS = [
    { id: 'outside', title: 'Outside' },
    { id: 'subfloor', title: 'Subfloor', ask: 'Is there a subfloor to get under?', no: 'No, slab' },
    { id: 'roof', title: 'Roof void', ask: 'Is there a roof void you can get into?', no: 'No access' },
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

  function isGuided(items) {
    return Array.isArray(items) && items.length > 0 && items.every((i) => !!i.area);
  }

  function blankState() { return { skipped: [], answers: {}, notesSaved: false, notes: null }; }

  function loadState(jobId) {
    try {
      const raw = localStorage.getItem(KEY(jobId));
      const s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== 'object') return blankState();
      return {
        skipped: Array.isArray(s.skipped) ? s.skipped.filter((x) => typeof x === 'string') : [],
        answers: s.answers && typeof s.answers === 'object' ? s.answers : {},
        notesSaved: !!s.notesSaved,
        notes: Array.isArray(s.notes) ? s.notes.filter((x) => typeof x === 'string') : null,
      };
    } catch (e) { return blankState(); }
  }

  function saveState(jobId, state) {
    try { localStorage.setItem(KEY(jobId), JSON.stringify(state)); } catch (e) { /* private mode: the walk still works, it just forgets */ }
  }

  // The ordered steps for this job as things stand. The front photo is left
  // out (it has its own prompt) and so are hidden items; an area answered No
  // keeps its question, so the answer can be changed, but loses its photos.
  function buildSteps(items, state) {
    const st = state || blankState();
    const steps = [];
    for (const area of AREAS) {
      if (area.notes) { steps.push({ kind: 'notes', area: area.id, areaTitle: area.title }); continue; }
      const photos = items.filter((i) => i.area === area.id && !i.hidden && i.id !== 'frontElevation');
      if (!photos.length) continue;
      if (area.ask) steps.push({ kind: 'question', area: area.id, areaTitle: area.title, ask: area.ask, no: area.no });
      if (area.ask && st.answers[area.id] === 'no') continue;
      for (const item of photos) steps.push({ kind: 'photo', area: area.id, areaTitle: area.title, item });
    }
    steps.push({ kind: 'done', area: 'done', areaTitle: 'Done' });
    return steps;
  }

  function stepComplete(step, done, state) {
    if (step.kind === 'photo') return done.has(step.item.label) || state.skipped.includes(step.item.id);
    if (step.kind === 'question') return !!state.answers[step.area];
    if (step.kind === 'notes') return !!state.notesSaved;
    return false;
  }

  // Where a re-opened camera should land: the first thing not yet dealt with.
  function firstOpenIndex(steps, done, state) {
    const i = steps.findIndex((s) => !stepComplete(s, done, state));
    return i === -1 ? steps.length - 1 : i;
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
  // the inside ticks into the report, resolving true when it did.
  function mount({ container, jobId, items, done, setZone, saveNotes, visible: startVisible }) {
    let state = loadState(jobId);
    let steps = buildSteps(items, state);
    let index = firstOpenIndex(steps, done(), state);
    let banner = '';
    let bannerTimer = null;
    let visible = startVisible !== false;
    let saving = false;

    function persist() { saveState(jobId, state); }

    function zoneFor(step) {
      if (step.kind === 'photo') return step.item.label;
      if (step.kind === 'notes') return INSIDE_ZONE;
      return '';
    }

    function go(i, { quiet } = {}) {
      index = Math.max(0, Math.min(steps.length - 1, i));
      if (!quiet) { banner = ''; clearTimeout(bannerTimer); }
      setZone(zoneFor(steps[index]));
      render();
    }

    function next() { go(index + 1); }

    function rebuild(keepStep) {
      steps = buildSteps(items, state);
      if (keepStep) {
        const at = steps.findIndex((s) => s.kind === keepStep.kind && s.area === keepStep.area
          && (s.kind !== 'photo' || s.item.id === keepStep.item.id));
        if (at !== -1) index = at;
      }
    }

    function answer(value) {
      const step = steps[index];
      state.answers[step.area] = value;
      persist();
      rebuild(step);
      next();
    }

    function skip() {
      const step = steps[index];
      if (step.kind === 'photo' && !state.skipped.includes(step.item.id)) {
        state.skipped.push(step.item.id);
        persist();
      }
      next();
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
      const meta = step.kind === 'done' ? 'All areas' : `${step.areaTitle} · ${pos + 1} of ${countable.length}`;
      container.appendChild(el('div', 'walk-meta', meta));

      const actions = el('div', 'walk-actions');
      const back = btn('‹', 'walk-back', () => go(index - 1), { disabled: index === 0 });
      back.setAttribute('aria-label', 'Previous step');
      actions.appendChild(back);

      if (step.kind === 'photo') {
        const got = doneSet.has(step.item.label);
        container.appendChild(el('div', 'walk-title', (got ? '✓ ' : '') + step.item.label));
        if (step.item.hint) container.appendChild(el('div', 'walk-hint', step.item.hint));
        if (got) {
          container.appendChild(el('div', 'walk-got', 'Photo saved. Take another, or go on.'));
          actions.appendChild(btn('Next ›', 'walk-primary', next));
        } else {
          actions.appendChild(btn('Not here, skip', 'walk-secondary', skip));
        }
      } else if (step.kind === 'question') {
        container.appendChild(el('div', 'walk-title', step.ask));
        const current = state.answers[step.area];
        const no = btn(step.no, 'walk-secondary' + (current === 'no' ? ' chosen' : ''), () => answer('no'));
        const yes = btn('Yes', 'walk-primary' + (current === 'yes' ? ' chosen' : ''), () => answer('yes'));
        actions.appendChild(no);
        actions.appendChild(yes);
      } else if (step.kind === 'notes') {
        container.appendChild(el('div', 'walk-title', 'Inside: no photos needed'));
        container.appendChild(el('div', 'walk-hint',
          'Tick what stopped you seeing walls and floors. These go into the report. Only photograph inside if you find damage or damp.'));
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
        container.appendChild(el('div', 'walk-title', '✓ All areas done'));
        container.appendChild(el('div', 'walk-hint', 'Tap Generate Form when you are ready, or go back to add anything.'));
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
      photoSaved() { render(); },
      // The zone box changed (a chip, or typing). A checklist label jumps the
      // walk to that step; anything else leaves the walk where it is.
      zoneChanged(label) {
        const at = steps.findIndex((s) => s.kind === 'photo' && s.item.label === label);
        if (at !== -1 && at !== index) { index = at; render(); }
      },
      setVisible(on) {
        const was = visible;
        visible = !!on;
        if (visible && !was) onShow(); else render();
      },
      start() { if (visible) onShow(); else render(); },
      current() { return steps[index]; },
      destroy() { clearTimeout(bannerTimer); container.innerHTML = ''; container.classList.add('hidden'); },
    };
  }

  window.PhotoWalk = { isGuided, buildSteps, firstOpenIndex, loadState, saveState, mount, AREAS, INSIDE_NOTES, INSIDE_ZONE };
})();
