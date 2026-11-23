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
//             5. one line, "Booking, repeat plan and messages", with the
//                booking card and the two settings rows folded behind it
//                (v173): settings, read rarely, and on a new job they were
//                three more cards between Start and the photos
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
  const ORDER = ['due-callout', '.inspection-card', 'client-link-panel', 'job-details-card', 'job-more-toggle', 'job-settings', 'job-booking-card'];

  // ---------- The fold (v173) ----------
  const MORE_ID = 'job-more-toggle';
  // What sits behind the line, and what the line calls each of them.
  const FOLDED = [['job-booking-card', 'booking'], ['plan-row', 'repeat plan'], ['job-comms-row', 'messages']];
  let foldOpen = false;   // closed when a job opens
  let foldedFor = null;   // the job that choice belongs to

  function showing(node) { return !!node && !node.classList.contains('hidden'); }

  function syncFold(host) {
    const present = FOLDED.filter(([id]) => showing(document.getElementById(id)));
    let toggle = document.getElementById(MORE_ID);
    if (!present.length) {
      if (toggle) toggle.remove();
      host.classList.remove('job-more-closed');
      return;
    }
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = MORE_ID;
      toggle.className = 'job-more-toggle';
      toggle.addEventListener('click', () => { foldOpen = !foldOpen; arrange(); });
      host.appendChild(toggle);
    }
    // Something to act on is never folded away: the reminder that booking
    // details have not been sent to the client stays on screen while the
    // rest of the group is closed (styles.css does that part).
    const open = foldOpen;
    const names = present.map(([, name]) => name);
    const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const label = joined.charAt(0).toUpperCase() + joined.slice(1);
    if (toggle.textContent !== label) toggle.textContent = label;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    host.classList.toggle('job-more-closed', !open);
  }

  // Called when a job is shown. A different job starts folded; redrawing the
  // same one (after saving, after changing the time) leaves it as it was.
  function fold(jobId) {
    if (jobId === foldedFor) return;
    foldedFor = jobId;
    foldOpen = false;
    arrange();
  }

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
    syncFold(host);
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
    }).observe(host, { childList: true, subtree: true });
  }

  function start() { watch(); arrange(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.JobLayout = { ORDER, arrange, orderOf, fold };
})();
