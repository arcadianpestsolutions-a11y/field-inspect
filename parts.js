// ---------------------------------------------------------------------------
// parts.js - which optional parts of Scope a business uses (v174).
//
// PURPOSE   Scope grew a screen for everything a pest business might do:
//           enquiries, follow-ups, referrals, safety statements, an SOP
//           library, a station register, business figures, invoices, a booking
//           assistant. A one-person business uses three of them and looks at
//           all of them. Each is now a switch in Settings. Switched off, a
//           part leaves the menus; nothing is deleted, and switching it back
//           on brings everything in it back.
// HOW       The business's choice is a list of part ids kept on its own row
//           (organisations.parts_off, migration 049) and cached with the rest
//           of the profile (org.js), so it holds with no signal. Here it
//           becomes classes on <body> ("part-off-referrals"), and styles.css
//           hides that part's way in. Nothing else in the app has to know.
//           A business that exists already has nothing switched off. A new
//           one starts with all of these off: that is the column's default.
// EXPOSES   window.Parts = { PARTS, off, isOn, apply, settingsSection }
// DEPENDS   Org (org.js) for the list; styles.css for the hiding.
// TESTS     tests/run-tests.js - "Quiet mode" group.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // `hides` is what styles.css hides for body.part-off-<id>. It is here as
  // well so a test can hold the two together.
  const PARTS = [
    { id: 'invoices', label: 'Invoices and Xero', blurb: 'The Invoice button on a job. Leave it off if you invoice from your accounts package.', hides: ['#view-invoice-btn'] },
    { id: 'enquiries', label: 'Enquiries', blurb: 'The Enquiries tab: people who have asked for a quote or a call back.', hides: ['#tab-leads', '#open-leads-btn'] },
    { id: 'followups', label: 'Follow-ups', blurb: 'Customers due or overdue for their next service, and the line about them on the home screen.', hides: ['#open-followups-btn', '#followups-banner'] },
    { id: 'referrals', label: 'Referrals', blurb: 'Who sends you work, and what they are owed for it.', hides: ['#open-referrals-btn'] },
    { id: 'swms', label: 'Safety statements', blurb: 'Safe work method statements, for builders and commercial sites.', hides: ['#open-swms-btn'] },
    { id: 'sops', label: 'SOP library', blurb: 'Your written procedures.', hides: ['#open-sops-btn'] },
    { id: 'stations', label: 'Station register', blurb: 'Bait and monitoring stations by property, and their QR stickers.', hides: ['#open-assets-btn'] },
    { id: 'figures', label: 'Business figures', blurb: 'Money in, work done and what is coming up.', hides: ['#open-business-btn'] },
    { id: 'assistant', label: 'Booking assistant', blurb: 'The chat box in the Diary that books and moves jobs when you ask it to.', hides: ['#agent-open'] },
  ];
  const KNOWN = new Set(PARTS.map((p) => p.id));

  // The ids switched off for this business. Anything unknown is ignored: an
  // older app meeting a newer list must not hide the wrong thing.
  function off() {
    const org = window.Org && window.Org.get ? window.Org.get() : null;
    const list = org && Array.isArray(org.partsOff) ? org.partsOff : [];
    return list.filter((id) => KNOWN.has(id));
  }

  function isOn(id) { return !off().includes(id); }

  function apply() {
    if (!document.body) return;
    const offNow = new Set(off());
    for (const p of PARTS) document.body.classList.toggle('part-off-' + p.id, offNow.has(p.id));
  }

  // The "What you use" part of Settings. Returns the element to put on the
  // screen and a way to read back what is now switched off.
  function settingsSection() {
    const offNow = new Set(off());
    const node = document.createElement('div');
    node.className = 'parts-settings';
    const head = document.createElement('h3');
    head.className = 'business-subhead';
    head.textContent = 'What you use';
    const about = document.createElement('p');
    about.className = 'business-hint';
    about.textContent = 'Switch off the parts of Scope you do not use and they leave the menus, for everyone in the business. '
      + 'Nothing is deleted: switch one back on and everything in it is still there.';
    node.append(head, about);
    const boxes = [];
    for (const p of PARTS) {
      const row = document.createElement('label');
      row.className = 'parts-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'part-' + p.id;
      box.checked = !offNow.has(p.id);
      const words = document.createElement('span');
      words.className = 'parts-words';
      const name = document.createElement('strong');
      name.textContent = p.label;
      const blurb = document.createElement('span');
      blurb.className = 'parts-blurb';
      blurb.textContent = p.blurb;
      words.append(name, blurb);
      row.append(box, words);
      node.appendChild(row);
      boxes.push([p.id, box]);
    }
    return { node, value: () => boxes.filter(([, box]) => !box.checked).map(([id]) => id) };
  }

  // The profile is read from this phone at once, then from the server when
  // there is a signal (org.js says when).
  document.addEventListener('scope-org', apply);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();

  window.Parts = { PARTS, off, isOn, apply, settingsSection };
})();
