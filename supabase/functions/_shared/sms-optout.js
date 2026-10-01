// Reading a reply to a reminder, and honouring "STOP".
//
// One file, two consumers, same as reminder-sms.js: the sms-inbound and
// send-client-message Edge Functions import it under Deno and the suite
// dynamic-imports it in a browser. Plain ES module, no dependencies.
//
// WHY THIS EXISTS
// Every reminder says "Reply STOP to opt out." A reply went to the SMS
// provider's inbox and nowhere else, so the promise was a promise nobody was
// keeping: the client had done exactly what they were told, and the next
// reminder went out anyway. Under the Spam Act that is not a UX gap.
//
// WHAT COUNTS AS STOP
// The rule leans toward opting people out, because the two mistakes are not
// the same size. Treating "stop texting me" as a reply costs a client one
// reminder they wanted; missing it is a breach and an angry client. So a
// message opts out when it is a bare keyword, or when it opens with STOP,
// UNSUBSCRIBE or OPT OUT and is short enough to be a request rather than a
// sentence that happens to start that way.
//
// CANCEL, END and QUIT opt out only when they are the WHOLE message. In a
// reminder thread "cancel tomorrow" is somebody cancelling an appointment,
// and silently unsubscribing them from the business instead is the wrong
// reading of what a person meant. Those go to a human.

import { normaliseAuMobile } from './reminder-sms.js';

const BARE_KEYWORDS = new Set([
  'stop', 'stopall', 'stop all', 'unsubscribe', 'unsub', 'optout', 'opt out',
  'cancel', 'end', 'quit', 'remove me',
]);

// Strong enough to opt out even with a few words after them.
const OPENING_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'unsub', 'optout']);
const MAX_WORDS_AFTER_OPENING = 4;

function words(body) {
  return String(body == null ? '' : body)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// 'opt_out' when the message is a request to stop, otherwise 'other'. 'other'
// is not "ignore": it is a person who wrote back, and the caller records it so
// that somebody can read it.
export function classifyReply(body) {
  const w = words(body);
  if (!w.length) return 'other';
  if (BARE_KEYWORDS.has(w.join(' '))) return 'opt_out';

  // How many words follow the opening keyword. "opt out" is two words, so it
  // is handled alongside the single-word ones rather than as a special case.
  let wordsAfter = null;
  if (OPENING_KEYWORDS.has(w[0])) wordsAfter = w.length - 1;
  else if (w[0] === 'opt' && w[1] === 'out') wordsAfter = w.length - 2;

  return wordsAfter !== null && wordsAfter <= MAX_WORDS_AFTER_OPENING ? 'opt_out' : 'other';
}

// ClickSend can post a reply as JSON, as a form, or as query parameters, and
// names the text `body` in some of its payloads and `message` in others.
// Accepts any of them and returns just the two things that matter.
export function inboundFields(source) {
  const s = source || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = s[k];
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return '';
  };
  return {
    from: pick('from', 'From', 'sender'),
    body: pick('body', 'message', 'Body', 'text'),
    messageId: pick('message_id', 'sms_id', 'MessageSid', 'id'),
  };
}

// The key a phone number is compared on: E.164 for an Australian mobile, null
// for anything else. A reply from a number that is not a mobile cannot be one
// of ours, so null is "do nothing", not "match everything".
export function phoneKey(raw) {
  const r = normaliseAuMobile(raw);
  return r.ok ? r.e164 : null;
}

// Marks jobs whose client's phone is on the opt-out list, in memory, by
// setting the same flag a technician sets by hand. The reminder code already
// refuses a job with comms_opt_out, so honouring a STOP does not need a new
// code path there — it needs the flag to be true, including on a job created
// after the client replied, which is the case a flag on the old rows alone
// would miss.
export function applyPhoneOptOuts(jobs, optedOutKeys) {
  const keys = optedOutKeys instanceof Set ? optedOutKeys : new Set(optedOutKeys || []);
  if (!keys.size) return jobs;
  for (const job of jobs || []) {
    if (!job || job.comms_opt_out) continue;
    const key = phoneKey(job.client_phone);
    if (key && keys.has(key)) job.comms_opt_out = true;
  }
  return jobs;
}

// Constant-time comparison for the shared secret in the webhook URL. A plain
// === leaks how many leading characters matched; the secret is the only thing
// standing between the internet and a function that can suppress reminders.
export function tokensMatch(given, expected) {
  const a = String(given == null ? '' : given);
  const b = String(expected == null ? '' : expected);
  if (!b) return false; // an unset secret must never match an empty one
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
