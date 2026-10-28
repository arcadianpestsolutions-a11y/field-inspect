// Form rendering — turns a schema section into controls, and writes what the
// technician types back into a values object.
//
// This was inside report.js, which is how it came to be unreachable by
// anything else. The Safe Work Method Statement has its own store and its own
// schema and needs exactly the same text boxes, date pickers, yes/no toggles
// and signature pads — and the only way to get them was to be a report, which
// a safety statement is not.
//
// WHAT MOVED AND WHAT DID NOT
// The generic field types are here: static, text, textarea, date, time,
// select, choiceCards, yesno, multiselect, signature, and a plain photo
// field. What stayed in report.js is everything that is about inspections
// rather than about forms — the rich photo field with its pest and tree
// identification, the sketch pad, the chemical product list, the bait station
// register. Those are injected through `customFields`, so there is still one
// renderer; a host simply contributes the field types only it knows about.
//
// The same goes for decoration. report.js hangs its AI offer UI ("AI would
// answer Yes — use this / answer it myself") on every row, which is a report
// idea and not a form idea. It arrives through `decorateRow` rather than
// living in here, so a SWMS gets the same controls with none of that.
//
// No DOM ids, no globals of its own, no knowledge of what it is rendering
// into. A host creates one, points it at a container and a values object, and
// owns everything else.
(() => {
  'use strict';

  const { escapeHtml } = window.Common;

  const fieldVisible = (field, values) => (window.ReportSchemaUtils
    ? window.ReportSchemaUtils.isFieldVisible(field, values)
    : true);

  function create(opts) {
    const o = opts || {};
    let values = o.values || {};
    let container = o.container || null;
    let section = null;

    const customFields = o.customFields || {};
    // Called after the label is built and before the control is added, so a
    // host can hang its own UI on the row. Report.js uses it for the AI
    // offers; a SWMS passes nothing and gets a plain row.
    const decorateRow = typeof o.decorateRow === 'function' ? o.decorateRow : null;
    // Called whenever a value changes through a control here. Report.js uses
    // it to run the job-category prefill; most hosts will not need it.
    const onFieldChange = typeof o.onFieldChange === 'function' ? o.onFieldChange : null;
    // Ready-made wording for a comment box (comment-templates.js). The host
    // passes either a lookup, field -> [{ label, text }], or (v142) an object
    // that can also add, remove and restore: { list, add, remove,
    // restoreHidden, hiddenCount }. Report.js passes the object; a SWMS or an
    // enquiry form passes nothing and its comment boxes stay plain.
    const tpl = (() => {
      const c = o.commentTemplates;
      if (typeof c === 'function') return { list: c, manage: false };
      if (c && typeof c.list === 'function') return { ...c, manage: typeof c.add === 'function' };
      return null;
    })();
    const ask = (msg, def, opts) => (window.Common && window.Common.askPrompt ? window.Common.askPrompt(msg, def, opts) : Promise.resolve(window.prompt(msg, def)));
    const confirmIt = (msg, opts) => (window.Common && window.Common.askConfirm ? window.Common.askConfirm(msg, opts) : Promise.resolve(window.confirm(msg)));
    const say = (msg) => { if (window.Common && window.Common.toast) window.Common.toast(msg); };

    // "📝 Common comments" under a comment box. Tapping one ADDS it to what is
    // already there (never replaces a sentence somebody typed), on its own
    // line, and saves exactly as typing would. The [brackets] in a template
    // are left for the technician to fill in.
    function addTemplatePicker(row, field, ta) {
      if (!tpl) return;
      if (!tpl.list(field).length && !tpl.manage) return;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'link-btn comment-templates-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      const panel = document.createElement('div');
      panel.className = 'comment-templates hidden';
      const label = () => {
        const n = tpl.list(field).length;
        toggle.textContent = n ? `📝 Common comments (${n})` : '📝 Common comments';
      };
      const close = () => { panel.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); };

      function insert(t) {
        const current = ta.value.trimEnd();
        ta.value = current ? `${current}\n${t.text}` : t.text;
        setValue(field, ta.value);
        close();
        // Straight to the first [bracket], so filling it in is the next keystroke.
        const at = ta.value.indexOf('[', ta.value.length - t.text.length);
        ta.focus();
        if (at >= 0) {
          const end = ta.value.indexOf(']', at);
          ta.setSelectionRange(at, end >= 0 ? end + 1 : at + 1);
        } else {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }

      function build() {
        panel.innerHTML = '';
        for (const t of tpl.list(field)) {
          const item = document.createElement('div');
          item.className = 'comment-template-row';
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'comment-template';
          const strong = document.createElement('strong');
          strong.textContent = t.custom ? `${t.label} ✎` : t.label;
          const span = document.createElement('span');
          span.textContent = t.text;
          b.append(strong, span);
          b.addEventListener('click', () => insert(t));
          item.appendChild(b);
          if (tpl.manage) {
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'comment-template-remove';
            x.textContent = '✕';
            x.setAttribute('aria-label', t.custom ? `Delete "${t.label}"` : `Hide "${t.label}"`);
            x.addEventListener('click', async () => {
              const yes = await confirmIt(t.custom
                ? `Delete your common comment "${t.label}"? This is for everyone in the business.`
                : `Hide "${t.label}" from this list? It can be brought back later.`,
              { title: t.custom ? 'Delete common comment' : 'Hide common comment', okLabel: t.custom ? 'Delete' : 'Hide', danger: !!t.custom });
              if (!yes) return;
              try { await tpl.remove(field, t); build(); label(); } catch (e) { say(e.message || 'That did not save. Try again with a signal.'); }
            });
            item.appendChild(x);
          }
          panel.appendChild(item);
        }
        if (tpl.manage) {
          const save = document.createElement('button');
          save.type = 'button';
          save.className = 'btn btn-outline comment-template-save';
          save.textContent = '＋ Save what is in this box as a common comment';
          save.addEventListener('click', async () => {
            const text = ta.value.trim();
            if (!text) { say('Type the comment in the box first, then save it.'); return; }
            const name = await ask('A short name for it, to find it in this list:', '', { title: 'Save as a common comment', okLabel: 'Save' });
            if (name == null || !String(name).trim()) return;
            try { await tpl.add(field, name, text); build(); label(); say('Saved. It is in this list for everyone in the business.'); } catch (e) { say(e.message || 'That did not save. Try again with a signal.'); }
          });
          panel.appendChild(save);
          const hidden = tpl.hiddenCount ? tpl.hiddenCount(field) : 0;
          if (hidden) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'link-btn comment-template-restore';
            back.textContent = `Show the ${hidden} hidden one${hidden === 1 ? '' : 's'} again`;
            back.addEventListener('click', async () => {
              try { await tpl.restoreHidden(field); build(); label(); } catch (e) { say(e.message || 'That did not save. Try again with a signal.'); }
            });
            panel.appendChild(back);
          }
        }
      }

      toggle.addEventListener('click', () => {
        const open = panel.classList.toggle('hidden') === false;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) build();
      });
      label();
      row.append(toggle, panel);
    }

    function setValue(field, value) {
      values[field.id] = value;
      if (onFieldChange) onFieldChange(field, value);
    }

    // Re-evaluates every showIf on screen without rebuilding the section, so
    // answering a gate question does not cost the technician their scroll
    // position or the focus they were typing into.
    function refreshVisibility() {
      if (!section || !container) return;
      for (const field of section.fields) {
        const row = container.querySelector(`[data-field-row="${field.id}"]`);
        if (!row) continue;
        row.classList.toggle('hidden', !fieldVisible(field, values));
      }
    }

    function fieldRowWrapper(field) {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.dataset.fieldRow = field.id;
      if (!fieldVisible(field, values)) row.classList.add('hidden');
      const labelEl = document.createElement('label');
      labelEl.className = 'field-label';
      // No "AI" tag on every question the AI may fill (removed v140 at Tal's
      // request: it was on nearly every line and said nothing). What the AI
      // actually suggested is still marked by decorateRowWithAi in report.js.
      labelEl.innerHTML = escapeHtml(field.label)
        + (field.required ? ' <span class="required-dot">*</span>' : '');
      row.appendChild(labelEl);
      if (decorateRow) decorateRow(row, field);
      return row;
    }

    function renderSignatureField(field) {
      const wrap = document.createElement('div');
      wrap.className = 'signature-field';
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 130;
      canvas.className = 'signature-canvas';
      wrap.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      let hasSignature = false;
      const existing = values[field.id];
      if (existing) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = existing;
        hasSignature = true;
      }

      let drawing = false;
      function pos(e) {
        const rect = canvas.getBoundingClientRect();
        const point = e.touches ? e.touches[0] : e;
        return {
          x: (point.clientX - rect.left) * (canvas.width / rect.width),
          y: (point.clientY - rect.top) * (canvas.height / rect.height),
        };
      }
      function start(e) { drawing = true; hasSignature = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
      function move(e) { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
      function end() {
        if (!drawing) return;
        drawing = false;
        setValue(field, hasSignature ? canvas.toDataURL('image/png') : '');
      }
      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', move);
      window.addEventListener('mouseup', end);
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', move, { passive: false });
      canvas.addEventListener('touchend', end);

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-secondary';
      clearBtn.textContent = 'Clear Signature';
      clearBtn.addEventListener('click', () => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        hasSignature = false;
        setValue(field, '');
      });
      wrap.appendChild(clearBtn);
      return wrap;
    }

    // The plain version: add a photo, see it, remove it. A host that needs
    // more — report.js wants pest identification and photo sorting hanging
    // off the same field — registers its own under customFields.photos and
    // this one is never reached.
    function renderPhotosField(field) {
      const wrap = document.createElement('div');
      wrap.className = 'photo-field';
      const grid = document.createElement('div');
      grid.className = 'photo-field-grid';
      const photos = values[field.id] || [];

      function redraw() {
        grid.innerHTML = '';
        photos.forEach((p, idx) => {
          const tile = document.createElement('div');
          tile.className = 'photo-field-tile';
          const img = document.createElement('img');
          // Revoked when the tile goes, so a long form does not leak a blob
          // URL per photo per redraw.
          const url = URL.createObjectURL(p.blob);
          img.src = url;
          img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
          tile.appendChild(img);
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'photo-field-remove';
          del.textContent = '✕';
          del.addEventListener('click', () => {
            photos.splice(idx, 1);
            setValue(field, photos);
            redraw();
          });
          tile.appendChild(del);
          grid.appendChild(tile);
        });
      }
      redraw();
      wrap.appendChild(grid);

      // Two ways in, as on the report form (v129): Take photo opens the
      // phone's own camera app (`capture`, set as an attribute so phones
      // honour it), Import opens the gallery. Each photo is made a sensible
      // size first (photo-prep.js).
      const newId = () => ((window.DB && window.DB.uid) ? window.DB.uid() : String(Date.now() + Math.random()));
      async function addFiles(input) {
        const files = Array.from(input.files || []);
        input.value = '';
        if (!files.length) return;
        for (const file of files) {
          const blob = window.PhotoPrep ? await window.PhotoPrep.prepare(file) : file;
          photos.push({ id: newId(), blob });
        }
        setValue(field, photos);
        redraw();
      }
      const makeInput = (camera) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (camera) input.setAttribute('capture', 'environment');
        else input.multiple = true;
        input.className = 'hidden';
        input.addEventListener('change', () => addFiles(input));
        return input;
      };
      const cameraInput = makeInput(true);
      const galleryInput = makeInput(false);

      const buttons = document.createElement('div');
      buttons.className = 'row gap photo-field-buttons';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-outline flex1';
      addBtn.textContent = '📷 Take photo';
      addBtn.addEventListener('click', () => cameraInput.click());
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'btn btn-secondary flex1';
      importBtn.textContent = '🖼 Import';
      importBtn.addEventListener('click', () => galleryInput.click());
      buttons.append(addBtn, importBtn);

      wrap.appendChild(cameraInput);
      wrap.appendChild(galleryInput);
      wrap.appendChild(buttons);
      return wrap;
    }

    function renderField(field) {
      // A pure data slot (the sketch's marker JSON): no label, no control, no
      // row at all — it exists only so the value round-trips through save.
      if (field.type === 'sketchData') return;

      const row = fieldRowWrapper(field);

      if (customFields[field.type]) {
        row.appendChild(customFields[field.type](field));
      } else if (field.type === 'static') {
        const val = document.createElement('div');
        val.className = 'field-static';
        // The STORED value, not the schema default. It used to render the
        // default, which meant a finalized report displayed whatever the
        // constant happened to say today rather than what it said when it was
        // signed — so changing the office phone number silently rewrote the
        // provider line on every report ever issued. On a compliance document
        // that is not a cosmetic bug.
        const stored = values[field.id];
        val.textContent = (stored !== undefined && stored !== null && stored !== '')
          ? stored
          : (field.default || '');
        row.appendChild(val);
      } else if (field.type === 'text') {
        const input = document.createElement('input');
        input.type = 'text';
        if (field.placeholder) input.placeholder = field.placeholder;
        // Optional hints a schema may give: the right on-screen keyboard, a sane
        // length cap, and no automatic capital on an email address.
        if (field.inputMode) input.inputMode = field.inputMode;
        if (field.maxLength) input.maxLength = field.maxLength;
        if (field.autocapitalize) input.setAttribute('autocapitalize', field.autocapitalize);
        input.value = values[field.id] || '';
        input.addEventListener('input', () => setValue(field, input.value));
        row.appendChild(input);
      } else if (field.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.rows = field.rows || 3;
        if (field.placeholder) ta.placeholder = field.placeholder;
        ta.value = values[field.id] || '';
        ta.addEventListener('input', () => setValue(field, ta.value));
        row.appendChild(ta);
        addTemplatePicker(row, field, ta);
      } else if (field.type === 'date') {
        const input = document.createElement('input');
        input.type = 'date';
        input.value = values[field.id] || '';
        input.addEventListener('input', () => setValue(field, input.value));
        row.appendChild(input);
      } else if (field.type === 'time') {
        const input = document.createElement('input');
        input.type = 'time';
        input.value = values[field.id] || '';
        input.addEventListener('input', () => setValue(field, input.value));
        row.appendChild(input);
      } else if (field.type === 'select') {
        const select = document.createElement('select');
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '— Select —';
        select.appendChild(blank);
        // An option is a string (shown and stored as itself) or, since v121,
        // { value, label } where what is stored is not what is shown: a
        // client's id behind their name.
        for (const opt of field.options) {
          const optEl = document.createElement('option');
          const v = opt && typeof opt === 'object' ? String(opt.value) : opt;
          optEl.value = v;
          optEl.textContent = opt && typeof opt === 'object' ? String(opt.label) : opt;
          if (values[field.id] === v) optEl.selected = true;
          select.appendChild(optEl);
        }
        select.addEventListener('change', () => {
          setValue(field, select.value);
          refreshVisibility();
        });
        row.appendChild(select);
      } else if (field.type === 'choiceCards') {
        // A single-pick set of big tappable cards rather than a dropdown —
        // built for a choice that is itself a useful action, not just a value
        // to record. What that action is belongs to the host: it arrives
        // through onFieldChange rather than being named in here.
        const wrap = document.createElement('div');
        wrap.className = 'choice-cards';
        for (const cat of field.categories || []) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'choice-card' + (values[field.id] === cat.label ? ' active' : '');
          card.innerHTML = `<span class="choice-card-label">${escapeHtml(cat.label)}</span>`
            + (cat.blurb ? `<span class="choice-card-blurb">${escapeHtml(cat.blurb)}</span>` : '');
          card.addEventListener('click', () => {
            wrap.querySelectorAll('.choice-card').forEach((c) => c.classList.remove('active'));
            card.classList.add('active');
            setValue(field, cat.label);
          });
          wrap.appendChild(card);
        }
        row.appendChild(wrap);
      } else if (field.type === 'yesno') {
        const wrap = document.createElement('div');
        wrap.className = 'yesno-toggle';
        for (const opt of ['Yes', 'No']) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'yesno-btn' + (values[field.id] === opt ? ' active' : '');
          btn.textContent = opt;
          btn.addEventListener('click', () => {
            wrap.querySelectorAll('.yesno-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            setValue(field, opt);
            refreshVisibility();
          });
          wrap.appendChild(btn);
        }
        row.appendChild(wrap);
      } else if (field.type === 'multiselect') {
        const current = new Set(values[field.id] || []);
        const wrap = document.createElement('div');
        wrap.className = 'multiselect-list';

        function addChip(opt, isCustom) {
          const chip = document.createElement('label');
          chip.className = 'checkbox-chip';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = current.has(opt);
          cb.addEventListener('change', () => {
            if (cb.checked) current.add(opt); else current.delete(opt);
            setValue(field, Array.from(current));
          });
          chip.appendChild(cb);
          chip.appendChild(document.createTextNode(opt + (isCustom ? ' (custom)' : '')));
          wrap.insertBefore(chip, wrap.lastElementChild); // keep the add-row pinned at the bottom
        }

        const addRow = document.createElement('div');
        addRow.className = 'row gap multiselect-add-row';
        const addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.placeholder = 'Add other…';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-secondary';
        addBtn.textContent = '+ Add';
        addBtn.addEventListener('click', () => {
          const val = addInput.value.trim();
          if (!val || current.has(val)) return;
          current.add(val);
          setValue(field, Array.from(current));
          addInput.value = '';
          addChip(val, true);
        });
        addRow.appendChild(addInput);
        addRow.appendChild(addBtn);
        wrap.appendChild(addRow);

        for (const opt of field.options) addChip(opt, false);
        // Already-saved values not in the fixed option list (added via "+ Add"
        // on a previous edit) still need to render, or they'd silently vanish
        // from view despite still being part of the saved value.
        for (const val of current) {
          if (!field.options.includes(val)) addChip(val, true);
        }
        row.appendChild(wrap);
      } else if (field.type === 'photos') {
        row.appendChild(renderPhotosField(field));
      } else if (field.type === 'signature') {
        row.appendChild(renderSignatureField(field));
      }

      if (container) container.appendChild(row);
      return row;
    }

    function renderSection(sec) {
      section = sec;
      if (container) container.innerHTML = '';
      for (const field of (sec && sec.fields) || []) renderField(field);
    }

    return {
      renderField,
      renderSection,
      refreshVisibility,
      escapeHtml,
      // The values object and the container are both swapped rather than
      // rebuilt, because a host edits one section after another through the
      // same renderer and rebuilding it each time would drop every listener
      // the host attached through decorateRow.
      setValues(v) { values = v || {}; },
      getValues() { return values; },
      setContainer(el) { container = el; },
      setSection(sec) { section = sec; },
    };
  }

  window.FormRender = { create, escapeHtml };
})();
