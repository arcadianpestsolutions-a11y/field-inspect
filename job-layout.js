// ---------------------------------------------------------------------------
// job-layout.js - puts the job screen's cards in the order a technician needs.
//
// PURPOSE   The job screen is assembled by several modules (app.js for the
//           status card and the messages and plan rows, job-details.js for the
//           client card), each inserting its own piece where it happened to be
//           convenient. The result put two settings rows above the main action.
//           This one place decides the order, and keeps deciding it as the
//           pieces are redrawn:
//             1. a re-inspection prompt, when one is due
//             2. the status card: the next step (Start, Open Report, Invoice)
//             3. the client link panel, which opens from a button in that card
//             4. the client details: Call, Directions, Edit
//             5. messages and plan: settings, read rarely
//             6. the photos
// EXPOSES   window.JobLayout = { ORDER, arrange, orderOf }
// DEPENDS   the element ids below; nothing else.
// TESTS     tests/run-tests.js - "Job screen" group.
//
// It only ever MOVES existing elements, never creates content, so a page with
// a piece missing (an old cached index.html, a role without invoices) simply
// arranges whatever is there.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // Top to bottom. An entry is an element id, or a selector starting with '.'.
  const ORDER = ['due-callout', '.inspection-card', 'client-link-panel', 'job-details-card', 'job-settings'];

  const SETTINGS_ID = 'job-settings';
  const SETTINGS_MEMBERS = ['job-comms-row', 'plan-row'];

  function content() {
    return document.querySelector('#view-job .content');
  }

  function find(host, entry) {
    return entry.charAt(0) === '.' ? host.querySelector(entry) : document.getElementById(entry);
  }

  // The two rows that are settings rather than actions share one wrapper, so
  // they stay together whichever of them is currently shown.
  function gatherSettings(host) {
    const members = SETTINGS_MEMBERS.map((id) => document.getElementById(id)).filter(Boolean);
    let wrap = document.getElementById(SETTINGS_ID);
    if (!members.length) { if (wrap) wrap.remove(); return; }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = SETTINGS_ID;
      wrap.className = 'job-settings';
      host.insertBefore(wrap, host.firstChild);
    }
    // plan-row first, then the messages row: the plan is what happens next
    // year, the messages row is what happens tomorrow.
    members.sort((a, b) => SETTINGS_MEMBERS.indexOf(b.id) - SETTINGS_MEMBERS.indexOf(a.id));
    members.forEach((m) => { if (m.parentNode !== wrap) wrap.appendChild(m); });
  }

  // Idempotent: it moves only what is out of place, so calling it again, or
  // from a mutation observer, settles and stops.
  function arrange() {
    const host = content();
    if (!host) return;
    gatherSettings(host);
    let ref = host.firstChild;
    for (const entry of ORDER) {
      const node = find(host, entry);
      if (!node || node.parentNode !== host) continue;
      if (node === ref) ref = ref.nextSibling;
      else host.insertBefore(node, ref);
    }
  }

  // The ids currently directly inside the job screen, in order. For tests.
  function orderOf() {
    const host = content();
    if (!host) return [];
    return Array.from(host.children).map((c) => c.id || (c.classList.contains('inspection-card') ? 'inspection-card' : ''));
  }

  // Pieces are redrawn by different modules at different times (opening a job,
  // saving details, toggling messages). Watching the screen's children keeps
  // the order right without each of them having to call this.
  function watch() {
    const host = content();
    if (!host || host.__jobLayoutWatched) return;
    host.__jobLayoutWatched = true;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; arrange(); });
    }).observe(host, { childList: true });
  }

  function start() { watch(); arrange(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.JobLayout = { ORDER, arrange, orderOf };
})();
