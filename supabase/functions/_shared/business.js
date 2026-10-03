// Who is sending this. Read from the business's own record, not from secrets.
//
// Four Edge Functions used to carry the business name as a string of their
// own, and the contact details came from secrets that were never set. The
// visible result: a client opening their report saw "Any questions about this
// report — get in touch" with nothing to get in touch with, while the
// business had spent twenty minutes filling in exactly those details in the
// app. Three copies of one fact, and the one the owner actually maintained was
// the one nothing read.
//
// So there is now one source, the organisations row, and this is the one place
// that reads it. Shared between the Edge Functions (Deno) and the browser test
// suite, which is why it is a plain ES module with no imports — same
// arrangement as _shared/reminder-sms.js. The part that decides what the
// details ARE is pure and tested; only loadBusiness touches the database.
//
// PRECEDENCE, and why:
//   1. The business's own record. It is what the owner edits and sees, so it
//      has to be what is used.
//   2. The old secrets (BUSINESS_NAME and friends), but only for a field the
//      record leaves blank. A deployment that already set them keeps working,
//      and nothing changes until the record says something different.
//   3. A neutral phrase, never a particular business's name. A function that
//      cannot find who it is sending for should say so blandly, not quietly
//      sign off as somebody else.

// Last resort only. Deliberately not any real business.
export const NEUTRAL_NAME = 'your pest control provider';

// Trailing words that say what KIND of company this is rather than who it is.
// Dropped for the SMS sender name, where every character counts and a message
// that opens "Arcadian Pest Solutions Pty Ltd:" has spent a fifth of itself on
// the word "Pty". Matched at the end only, and repeatedly, so
// "Arcadian Services Pty Ltd" loses both ends but "Pest Solutions Pty Ltd"
// keeps "Pest".
const TRAILING_GENERIC = /\s+(pty\.?|ltd\.?|limited|proprietary|solutions|services|group|company|co\.?)$/i;

const clean = (v) => (v == null ? '' : String(v)).trim();

// The name a client recognises. Trading name first: a company registered as
// one thing and known as another should print the name the client knows. This
// is the same rule the app uses (org.js businessName), and the two must agree
// or an email and the report attached to it would be signed differently.
export function displayName(row) {
  const r = row || {};
  return clean(r.trading_name) || clean(r.name);
}

// "Arcadian Pest Solutions" -> "Arcadian Pest". Never returns empty for a
// non-empty name: a name that is ONLY generic words ("Services Pty Ltd") is
// kept whole rather than reduced to nothing.
export function shortName(name) {
  let n = clean(name);
  for (let i = 0; i < 6; i++) {
    const next = n.replace(TRAILING_GENERIC, '').trim();
    if (!next || next === n) break;
    n = next;
  }
  return n || clean(name);
}

// `row` is an organisations row or null. `env` is a plain object of the old
// secrets, passed in rather than read from Deno so this stays testable and
// platform-free.
export function businessFrom(row, env) {
  const r = row || {};
  const e = env || {};
  const name = displayName(r) || clean(e.BUSINESS_NAME) || NEUTRAL_NAME;
  const email = clean(r.email) || clean(e.BUSINESS_REPLY_TO);
  return {
    name,
    // An explicit SMS name is a deliberate setting and wins; otherwise derive.
    smsName: clean(e.BUSINESS_SMS_NAME) || shortName(name),
    abn: clean(r.abn) || clean(e.BUSINESS_ABN),
    phone: clean(r.phone) || clean(e.BUSINESS_PHONE),
    email,
    // Where a client's answer goes. Same address as the contact email, on
    // purpose: two different "ways to reach us" is how a reply lands in an
    // inbox nobody reads.
    replyTo: email,
    address: clean(r.address) || clean(e.BUSINESS_ADDRESS),
    // True when the record itself supplied the name, false when it fell back.
    // Lets a caller say so rather than silently signing off as a stranger.
    fromRecord: !!displayName(r),
  };
}

// Business names go into HTML emails. This is the owner's own text, not an
// attacker's, but "Smith & Sons" would still break the markup, and a name is
// not something to trust to be tag-free.
export function escapeHtml(s) {
  return clean(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The only function here that touches the database. `admin` is a service-role
// supabase client; `orgId` is the business whose details are wanted. A failed
// read degrades to the old secrets and then the neutral name rather than
// throwing, because "could not look up the business name" must never be the
// reason a client does not get their report.
export async function loadBusiness(admin, orgId, env) {
  if (!admin || !orgId) return businessFrom(null, env);
  try {
    const { data, error } = await admin
      .from('organisations')
      .select('name, trading_name, abn, phone, email, address')
      .eq('id', orgId)
      .maybeSingle();
    if (error) return businessFrom(null, env);
    return businessFrom(data, env);
  } catch (_e) {
    return businessFrom(null, env);
  }
}

// Which business a signed-in user belongs to. For the two functions that act
// for whoever is logged in rather than for a job. service_role bypasses RLS,
// so this reads exactly one user's own row and nothing wider.
export async function orgIdForUser(admin, userId) {
  if (!admin || !userId) return null;
  try {
    const { data } = await admin.from('user_roles').select('org_id').eq('user_id', userId).maybeSingle();
    return (data && data.org_id) || null;
  } catch (_e) {
    return null;
  }
}
