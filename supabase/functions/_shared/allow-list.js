// Test mode for client messages (v124): an optional list of the only phone
// numbers and email addresses automated messages may go to.
//
//   SMS_ALLOWED_NUMBERS      e.g. "0400 111 222, +61400333444"
//   EMAIL_ALLOWED_ADDRESSES  e.g. "me@example.com, office@example.com"
//
// Not set (or blank): normal running, nothing is filtered. Set: a message to
// anybody NOT on the list is refused before it is built, and the job is not
// marked as sent, so it goes out normally once the list is removed. A list
// that is set but has nothing valid in it blocks everything, which is the
// safe way round for a typo.
//
// The point is a test period: the owner sets the list to their own phone and
// email, books test jobs against real-looking data, and no real client can be
// texted or emailed by accident. Set and cleared by the owner in Supabase
// secrets; never from the app.
//
// Shared with the browser test suite, which covers it.

import { normaliseAuMobile } from './reminder-sms.js';

function split(raw) {
  return String(raw == null ? '' : raw).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

// null = no list (everything allowed). A Set = only these.
export function parseNumberList(raw) {
  if (!String(raw == null ? '' : raw).trim()) return null;
  const out = new Set();
  for (const item of split(raw)) {
    const n = normaliseAuMobile(item);
    if (n.ok) out.add(n.e164);
  }
  return out;
}

export function parseEmailList(raw) {
  if (!String(raw == null ? '' : raw).trim()) return null;
  return new Set(split(raw).map((s) => s.toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)));
}

export function numberAllowed(rawPhone, list) {
  if (list === null || list === undefined) return true;
  const n = normaliseAuMobile(rawPhone);
  return !!(n.ok && list.has(n.e164));
}

export function emailAllowed(rawEmail, list) {
  if (list === null || list === undefined) return true;
  return list.has(String(rawEmail == null ? '' : rawEmail).trim().toLowerCase());
}
