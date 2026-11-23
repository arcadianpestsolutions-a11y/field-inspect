// ===========================================================================
// finish-step.js - the Finish step (v169): what is still to answer on a
// report, grouped into the questions a person would actually be asked, and
// the signature a technician keeps on their own phone.
//
// WHY IT EXISTS
// After the walk a clean house has about 14 answers missing, spread through
// six sections of an eleven-section document. The report screen listed them;
// finding each one meant opening a section and scrolling past thirty fields
// that were already answered. The Finish step asks them one at a time.
//
// WHAT A "QUESTION" IS
// report-schema.js already knows what is missing (sectionValidationErrors).
// Left as a list of fields that is 14 lines. Here each missing answer is
// handed to the question that owns it:
//   - a field shown only because of another answer belongs to that answer
//     ("Client agreement" owns the name, date and signature under it);
//   - a field named in another's `askWith` is asked on that field's screen
//     (the inspector's name and licence with their signature, the comment box
//     that goes with "Is a termite treatment recommended?").
// So fourteen missing fields are nine or ten screens, most of them one tap.
//
// Pure apart from the signature (localStorage, this phone only, never synced).
// EXPOSES: window.FinishStep = { ownerOf, screenFields, screenErrors,
//   questions, position, tapAnswers, Signature }
// DEPENDS ON: ReportSchemaUtils (report-schema.js).
// TESTS: tests/run-tests.js ("Finish step:" group).
// ===========================================================================
(() => {
  'use strict';

  // How many choices still read as buttons. Past this a list is a dropdown.
  const MAX_TAP_CHOICES = 7;

  function fieldsOf(section) { return (section && section.fields) || []; }

  // The question a field is asked under: up its showIf chain, and across an
  // `askWith`, until there is nowhere further to go.
  function ownerOf(section, fieldId) {
    const fields = fieldsOf(section);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const askedWith = new Map();
    for (const f of fields) for (const id of (f.askWith || [])) if (!askedWith.has(id)) askedWith.set(id, f.id);

    let field = byId.get(fieldId) || null;
    const seen = new Set();
    while (field && !seen.has(field.id)) {
      seen.add(field.id);
      const gate = field.showIf && byId.get(field.showIf.field);
      if (gate && gate.id !== field.id) { field = gate; continue; }
      const host = byId.get(askedWith.get(field.id));
      if (host && host.id !== field.id) { field = host; continue; }
      break;
    }
    return field;
  }

  // Everything on a question's screen, in the order of the form. Whether each
  // one is showing right now is the renderer's business (its showIf).
  function screenFields(section, ownerId) {
    return fieldsOf(section).filter((f) => {
      if (f.type === 'sketchData') return false; // a data slot, never a row
      const owner = ownerOf(section, f.id);
      return !!owner && owner.id === ownerId;
    });
  }

  // What is still wrong on one screen.
  function screenErrors(section, values, ownerId) {
    const utils = window.ReportSchemaUtils;
    if (!utils || !section) return [];
    return utils.sectionValidationErrors(section, values || {}).filter((e) => {
      const owner = ownerOf(section, e.fieldId);
      return !!owner && owner.id === ownerId;
    });
  }

  // Where a question sits in the form, as one number, so "the next one after
  // this" still means something after answers have changed the list.
  function position(schema, sectionId, fieldId) {
    const s = (schema || []).findIndex((x) => x.id === sectionId);
    if (s === -1) return -1;
    const f = fieldsOf(schema[s]).findIndex((x) => x.id === fieldId);
    return s * 1000 + Math.max(0, f);
  }

  // The questions still to answer, in the order of the form.
  // Each: { key, sectionId, sectionTitle, fieldId, label, soft, missing[] }.
  // `soft` is a question that does not stop the report being finalized (the
  // client's two signatures: they are often not there to give them).
  function questions(schema, report) {
    const utils = window.ReportSchemaUtils;
    if (!utils || !report) return [];
    const sections = report.sections || {};
    const out = [];
    for (const section of utils.visibleSchema(schema || [], report)) {
      if (section.computed || section.fixed) continue;
      const mine = new Map();
      for (const err of utils.sectionValidationErrors(section, sections[section.id] || {})) {
        const owner = ownerOf(section, err.fieldId);
        if (!owner) continue;
        let q = mine.get(owner.id);
        if (!q) {
          q = {
            key: `${section.id}.${owner.id}`,
            sectionId: section.id,
            sectionTitle: section.title,
            fieldId: owner.id,
            label: owner.label,
            soft: !!section.softRequired,
            missing: [],
          };
          mine.set(owner.id, q);
        }
        q.missing.push(err);
      }
      const order = fieldsOf(section).map((f) => f.id);
      out.push(...Array.from(mine.values()).sort((a, b) => order.indexOf(a.fieldId) - order.indexOf(b.fieldId)));
    }
    return out;
  }

  // Answered with one tap on a large button: yes or no, or a short list.
  function tapAnswers(field) {
    if (!field) return false;
    if (field.type === 'yesno') return true;
    return field.type === 'select' && Array.isArray(field.options)
      && field.options.length > 0 && field.options.length <= MAX_TAP_CHOICES
      && field.options.every((o) => typeof o === 'string');
  }

  // ---------- The signature kept on this phone ----------
  // Asked for once, then offered as "Sign as ..." on later reports. It is
  // never put on a report by itself: each use is a tap by the person signing.
  // Kept in this browser only, under the signed-in person's own id, so a
  // second login on a shared phone is never offered someone else's.
  const SIG_PREFIX = 'scope.signature.v1:';
  const SIG_MAX = 400000;

  function sigKey() {
    if (window.IS_TEST) return SIG_PREFIX + 'test';
    if (window.IS_DEMO) return SIG_PREFIX + 'demo';
    const uid = window.Sync && window.Sync.currentUserId && window.Sync.currentUserId();
    return uid ? SIG_PREFIX + uid : null; // nobody signed in: nothing is kept
  }
  function isSignatureImage(s) {
    return typeof s === 'string' && s.length < SIG_MAX
      && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
  }

  const Signature = {
    get() {
      try {
        const key = sigKey();
        const stored = key ? localStorage.getItem(key) : '';
        return isSignatureImage(stored) ? stored : '';
      } catch (e) { return ''; } // private window, storage blocked: there is none
    },
    save(dataUrl) {
      const key = sigKey();
      if (!key || !isSignatureImage(dataUrl)) return false;
      try { localStorage.setItem(key, dataUrl); return true; } catch (e) { return false; }
    },
    clear() {
      try { const key = sigKey(); if (key) localStorage.removeItem(key); } catch (e) { /* nothing to clear */ }
    },
  };

  window.FinishStep = { ownerOf, screenFields, screenErrors, questions, position, tapAnswers, Signature, MAX_TAP_CHOICES };
})();
