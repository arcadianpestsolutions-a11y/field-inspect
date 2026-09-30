// Reminder SMS — the words a client actually reads the day before a visit.
//
// One file, two consumers: the send-client-message Edge Function imports it
// under Deno, and tests/run-tests.js pulls it in with a dynamic import() so
// the wording and the phone handling are covered by the same suite as the
// rest of the app. Plain ES module with no dependencies, which is the only
// reason that works in both places without a build step.
//
// WHY THE WORDING IS SPLIT BY VISIT TYPE
// The original reminder said "please make sure we can get to the meter box,
// the subfloor access and under the sinks" for every job. That is the right
// message for a timber pest inspection and wrong for three of the four other
// things Arcadian actually turns up to do. A client who reads instructions
// that do not match the visit either ignores the next one or spends an hour
// clearing a subfloor nobody was going to enter. The whole value of a
// day-before reminder is that the access is ready when the van arrives, so
// the instructions have to be the real ones for that visit.
//
// WHY EVERY MESSAGE STAYS IN THE 7-BIT ALPHABET
// A GSM-7 SMS carries 160 characters, or 153 each once it has to be split.
// One character outside that alphabet switches the whole message to UCS-2,
// where the limits drop to 70 and 67 — so a single curly apostrophe turns a
// two-part message into a four-part one and doubles what it costs to send,
// every time, forever. This file therefore uses straight quotes ' and plain
// hyphens - and never the typographic quotes or em dashes used everywhere
// else in this project. assertGsm7() in the suite is what keeps it honest.

// The GSM 03.38 basic alphabet, plus the extension characters that cost two
// septets each. Anything not in here forces UCS-2.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅå'
  + 'Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ'
  + ' !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§'
  + '¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '\f^{}\\[~]|€';

export const SEGMENT_LIMITS = {
  gsm7: { single: 160, multi: 153 },
  ucs2: { single: 70, multi: 67 },
};

// Two segments is the budget every message in this file is written to. It is
// not a technical limit — it is a cost decision, and a test enforces it, so
// anyone lengthening the copy finds out here rather than on the bill.
export const MAX_SEGMENTS = 2;

export function smsSegments(text) {
  const s = String(text || '');
  let septets = 0;
  let gsm7 = true;
  for (const ch of s) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXTENDED.includes(ch)) septets += 2;
    else { gsm7 = false; break; }
  }
  const encoding = gsm7 ? 'gsm7' : 'ucs2';
  // UCS-2 is counted in UTF-16 code units, so an emoji outside the basic
  // plane is two, which is what a carrier bills for.
  const units = gsm7 ? septets : s.length;
  const limits = SEGMENT_LIMITS[encoding];
  const segments = units === 0 ? 0
    : units <= limits.single ? 1
    : Math.ceil(units / limits.multi);
  return { encoding, units, segments };
}

// ------------------------------------------------------------- phone ---

// Australian mobiles only, and deliberately so. A landline cannot receive an
// SMS: some carriers silently drop it, some read it out by robot at 2am, and
// either way the client does not get the reminder. Returning a refusal
// instead of a number is what puts the job on the list to ring by hand,
// which is a far better outcome than a message that goes nowhere.
export function normaliseAuMobile(raw) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return { ok: false, e164: null, reason: 'no-phone-on-file' };

  // Strip everything a human might type around the digits, but keep a
  // leading + so an already-international number is recognisable.
  let digits = original.replace(/[\s()\-.]/g, '');
  const hadPlus = digits.startsWith('+');
  digits = digits.replace(/\D/g, '');
  if (hadPlus === false && digits.startsWith('0011')) digits = digits.slice(4); // AU international prefix

  let national = null;
  if (digits.startsWith('61')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;

  if (!/^\d+$/.test(national)) return { ok: false, e164: null, reason: 'phone-not-valid' };
  // A mobile is 4 followed by eight more digits once the leading 0 is gone.
  if (!/^4\d{8}$/.test(national)) {
    // Tell the two cases apart, because they mean different things to
    // whoever reads the list: one is a typo, the other is a landline and
    // always will be.
    if (/^[2378]\d{8}$/.test(national)) return { ok: false, e164: null, reason: 'landline-not-mobile' };
    return { ok: false, e164: null, reason: 'phone-not-valid' };
  }
  return { ok: true, e164: `+61${national}`, reason: null };
}

// -------------------------------------------------------- visit kind ---

export const VISIT_KINDS = [
  'timber_pest_inspection',
  'termite_monitoring',
  'termite_works',
  'rodent_program',
  'general_pest',
];

// What is Arcadian actually turning up to do? The document type chosen at
// New Job is the honest signal for four of these. Rodent work is the odd one
// out: it is not a document type of its own, it is a general pest job whose
// report has the rodent station register switched on, so it can only be told
// apart by looking at what the last visit recorded.
export function visitKindFor(job, lastReport) {
  const docType = (job && (job.preferred_document_type || job.preferredDocumentType)) || '';
  const jobType = (job && (job.job_type || job.jobType)) || '';

  if (docType === 'timber_pest_inspection') return 'timber_pest_inspection';
  if (docType === 'termite_monitoring') return 'termite_monitoring';
  if (docType === 'termite_action_plan' || docType === 'termite_certificate') return 'termite_works';

  if (docType === 'general_pest' || jobType === 'pest_treatment') {
    if (hasRodentStations(lastReport)) return 'rodent_program';
    return 'general_pest';
  }

  // No document type recorded and not a pest treatment: it is a termite job,
  // and an inspection is both the most common one and the one whose
  // instructions ask for the most. Over-preparing costs a client ten minutes;
  // under-preparing costs a return visit.
  return 'timber_pest_inspection';
}

// Searches rather than reaching for a fixed path. A report row stores its
// field values under `sections`, keyed by section, and the rodent register is
// a gated section inside the pest treatment schema — so the flag sits at a
// depth that depends on how the schema is laid out that week. A recursive
// look for the two keys that matter survives the schema being rearranged,
// which a hard-coded path would not, and the cost of being wrong here is
// texting a client the wrong access instructions.
function hasRodentStations(lastReport) {
  if (!lastReport || typeof lastReport !== 'object') return false;

  let found = false;
  const seen = new Set();
  const walk = (node, depth) => {
    if (found || depth > 6 || !node || typeof node !== 'object') return;
    if (seen.has(node)) return;   // sections can be re-entrant once sanitised
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const flag = node.rodentStationsInUse;
    if (flag === true || flag === 'yes' || flag === 'Yes') { found = true; return; }
    if (Array.isArray(node.rodentStations) && node.rodentStations.length > 0) { found = true; return; }
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  };
  walk(lastReport, 0);
  return found;
}

// ----------------------------------------------------------- wording ---

// "tomorrow at 10am" reads better in a reminder than a date does, and the
// message only ever goes out the day before, so the word is always true.
export function whenPhrase(scheduledAtMs, nowMs) {
  if (!scheduledAtMs) return 'soon';
  const when = new Date(scheduledAtMs);
  const h = when.getHours();
  const m = when.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const time = m === 0 ? `${h12}${h < 12 ? 'am' : 'pm'}`
    : `${h12}.${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;

  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOfDay(scheduledAtMs) - startOfDay(nowMs == null ? Date.now() : nowMs)) / 86400000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${DOW[when.getDay()]} at ${time}`;
}

// Straight quotes and plain hyphens only - see the note at the top of this
// file about what one curly apostrophe costs.
const BODIES = {
  timber_pest_inspection: (when) =>
    `timber pest inspection ${when}. Please clear access to the roof manhole, `
    + `subfloor entry and garage walls, unlock side gates and secure pets. `
    + `Someone over 18 needs to be home.`,

  termite_monitoring: (when) =>
    `termite station check ${when}. We need to reach the in-ground stations `
    + `around the house, so please unlock side gates, move any pots or bins off `
    + `them and secure pets. You do not need to be home.`,

  termite_works: (when) =>
    `termite treatment ${when}. We will be working right around the house, so `
    + `please move cars off the driveway, clear pots and garden beds away from `
    + `the walls, unlock side gates and keep pets inside.`,

  rodent_program: (when) =>
    `rodent service ${when}. We need to reach every station we have put down - `
    + `inside, in the roof and around the yard - so please unlock gates, sheds `
    + `and any locked rooms, and secure pets.`,

  general_pest: (when) =>
    `pest treatment ${when}. Please clear kitchen benches, cover fish tanks, `
    + `secure pets and unlock side gates. Clearing along the skirting boards `
    + `helps but is not essential.`,
};

// The opt-out. An appointment reminder for work the client booked is
// transactional rather than marketing, so the Spam Act's unsubscribe rule is
// arguable here - but every dentist, vet and mechanic in the country carries
// one, it costs 24 characters, and arguing the point with ACMA is not worth
// saving them. STOP replies land in the SMS provider's inbox; someone still
// has to tick Do not contact on the job in Scope until an inbound webhook
// exists to do it automatically.
export const OPT_OUT = 'Reply STOP to opt out.';

export function reminderSms(opts) {
  const o = opts || {};
  const business = String(o.businessName || '').trim() || 'Your pest technician';
  const kind = BODIES[o.visitKind] ? o.visitKind : 'timber_pest_inspection';
  const when = o.when || 'tomorrow';
  const text = `${business}: ${BODIES[kind](when)} ${OPT_OUT}`;
  const metrics = smsSegments(text);
  return { text, visitKind: kind, ...metrics };
}

// Everything the sweep needs to decide whether this job can be reminded at
// all, in one call, so the Edge Function has no wording logic of its own.
export function composeReminder(opts) {
  const o = opts || {};
  const job = o.job || {};
  const phone = normaliseAuMobile(job.client_phone || job.clientPhone);
  const visitKind = visitKindFor(job, o.lastReport);
  const when = whenPhrase(job.scheduled_at || job.scheduledAt, o.now);
  const composed = reminderSms({ businessName: o.businessName, visitKind, when });
  return {
    sendable: phone.ok,
    reason: phone.reason,
    to: phone.e164,
    ...composed,
  };
}
