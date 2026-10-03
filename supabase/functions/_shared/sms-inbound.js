// What a text message coming IN means, and how to read it.
//
// Shared between the sms-inbound Edge Function (Deno) and the browser test
// suite, which is why it is a plain ES module — same arrangement as
// reminder-sms.js, which it imports from. The rules here decide whether
// somebody who has told us to stop is texted again, so they are worth a test.
//
// WHY THIS EXISTS. Every reminder we send ends "Reply STOP to opt out." That
// is a promise. For a long time the reply went to the SMS provider's inbox and
// nothing in Scope ever saw it, so the promise was being made and not kept:
// somebody could text STOP and be texted again the next day.

import { normaliseAuMobile } from './reminder-sms.js';

// A message is an opt-out if it says so plainly. Deliberately generous, because
// the two ways of being wrong are not equal: missing a real STOP is somebody
// asking you to stop and being ignored, and wrongly treating a message as one
// costs a client a text they can still be rung about. Everything that is NOT an
// opt-out is kept for a person to read either way, so a false positive is
// visible and recoverable and a false negative is neither.
//
// Whole-message keywords. "CANCEL" and "END" are only an opt-out on their own —
// "cancel my appointment" is a reply a person has to act on, not a request to
// be removed from a list, and is kept as one.
const EXACT = new Set([
  'stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit',
  'opt out', 'optout', 'opt-out', 'remove me', 'remove',
]);

// Plain-language forms. "Stop texting me", "please stop messaging", "unsubscribe
// me" — what people actually type.
const LEADING = /^(?:please\s+)?stop\b/;
const ANYWHERE = /\b(?:unsubscribe|opt[\s-]?out)\b/;

// Lowercased, punctuation and emoji stripped, spaces collapsed. "STOP!" and
// " Stop. " are the same message.
export function normaliseReply(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 'stop' or 'reply'. Never anything else: there is no third thing a person
// reading the log needs to be told.
export function classifyReply(text) {
  const n = normaliseReply(text);
  if (!n) return 'reply';
  if (EXACT.has(n)) return 'stop';
  if (ANYWHERE.test(n)) return 'stop';
  if (LEADING.test(n)) return 'stop';
  return 'reply';
}

// ClickSend can deliver an inbound message three ways, chosen per rule in its
// dashboard: a form POST (the default), a JSON POST, or a GET with the fields in
// the query string. Which one a rule uses is a setting nobody should have to
// remember, so all three are read.
//
// `rawBody` is the request body as text (may be empty); `contentType` its
// header; `query` a URLSearchParams.
export function parseInbound(contentType, rawBody, query) {
  const fields = {};
  const ct = String(contentType || '').toLowerCase();
  const body = String(rawBody || '');

  try {
    if (ct.includes('json') && body.trim()) {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        // A rule that wraps the message ({ data: {...} }) is read through.
        const inner = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
        for (const [k, v] of Object.entries(inner)) fields[k] = v;
      }
    } else if (body.trim()) {
      for (const [k, v] of new URLSearchParams(body)) fields[k] = v;
    }
  } catch (_e) { /* an unreadable body is treated as empty, below */ }

  if (query) for (const [k, v] of query) if (!(k in fields)) fields[k] = v;

  const pick = (...names) => {
    for (const n of names) {
      const v = fields[n];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  return {
    from: pick('from', 'sender', 'msisdn'),
    to: pick('to', 'recipient'),
    // ClickSend calls it "body"; some paths call it "message".
    body: pick('body', 'message', 'text'),
    messageId: pick('message_id', 'messageId', 'id'),
    originalMessageId: pick('original_message_id'),
    // What we attached when we sent: the job id. A reply to one of our texts
    // carries it back, which is what lets a reply be tied to a business.
    customString: pick('custom_string', 'customString'),
  };
}

// The decision, with no database in it. `parsed` comes from parseInbound.
//   kind:   'stop' | 'reply'  — what the message means
//   e164:   the sender normalised, or null when it is not an Australian mobile
//   ignore: true when there is nothing worth storing at all
//
// A message from a number that is not a valid Australian mobile is still kept
// when it says anything — the person exists, we just cannot key them — but it
// cannot be suppressed by number, and the caller must say so rather than
// pretend it was handled.
export function decideInbound(parsed) {
  const p = parsed || {};
  const body = String(p.body || '').trim();
  const fromRaw = String(p.from || '').trim();
  if (!fromRaw && !body) return { ignore: true, kind: 'reply', e164: null, body: '' };

  const n = normaliseAuMobile(fromRaw);
  return {
    ignore: false,
    kind: classifyReply(body),
    e164: n.ok ? n.e164 : null,
    keyable: n.ok,
    body: body.slice(0, 500), // a text is at most a few hundred characters; bound it anyway
  };
}

// Constant-time comparison for the shared secret in the URL. A plain === leaks,
// through timing, how many leading characters of a guess were right.
export function sameSecret(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Whether this phone number, however it was typed on a job, belongs to somebody
// who has texted STOP. `optedOut` is a Set of normalised E.164 numbers.
//
// THIS IS THE RULE THAT MAKES STOP SURVIVE A NEW JOB. The per-job flag cannot:
// a new job starts opted in. Comparing the NUMBER, normalised, means
// "0412 345 678" on last year's job and "+61 412 345 678" on this year's are the
// same person, and a client who texted STOP stays stopped however many times
// they book. A number that cannot be normalised (a landline, a typo) never
// matches — nobody can have texted STOP from it, and guessing would suppress a
// stranger.
export function isNumberOptedOut(rawPhone, optedOut) {
  const key = normaliseAuMobile(rawPhone).e164;
  return !!(key && optedOut && optedOut.has(key));
}
