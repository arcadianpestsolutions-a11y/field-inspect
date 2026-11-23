// Subcontractor sign-up: the rules, in one place.
//
// A business (the host) hands a subcontractor a link. They fill in who they
// are, their licence and insurance, read the host's agreement and accept it.
// This file decides what a complete application is. It is shared by the
// subcontractor-join Edge Function (Deno), the sign-up page (join.html) and
// the browser test suite, which is why it is a plain ES module with no
// imports: the page and the server cannot then disagree about what is
// required, and the wording a person reads is the wording the tests check.
//
// NOTHING HERE IS A LEGAL RULE. Which licence a person needs and how much
// insurance is a matter for the host and the state they work in. The form
// asks for the details; the host reads them and decides.

// Invite tokens are 64 hex characters (two UUIDs without the dashes). Checked
// for shape before a token is ever used in a query.
export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export function validToken(t) {
  return TOKEN_PATTERN.test(String(t == null ? '' : t));
}

// One sentence for every reason a link does not work: switched off, replaced,
// made up, or a business that has not written its agreement yet. Telling them
// apart would tell a stranger which links exist.
export const LINK_REFUSAL = 'This sign-up link is not active. Ask the business that sent it for a new one.';

export const LIMITS = {
  fullName: 120, businessName: 160, abn: 20, phone: 30, email: 200,
  licenceNumber: 60, insurer: 120, insurancePolicy: 80, acceptedName: 120,
  passwordMin: 8, passwordMax: 200,
};

const str = (v) => (v == null ? '' : String(v));
const oneLine = (v, max) => str(v).replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' for a real calendar date, else ''. 2027-02-30 is not a date.
export function cleanDate(v) {
  const s = str(v).trim();
  if (!ISO_DATE.test(s)) return '';
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10) === s ? s : '';
}

// Today as 'YYYY-MM-DD' in Sydney, where the businesses using this work. A
// licence that runs out today is still good today.
export function todayIso(now) {
  const d = new Date(now == null ? Date.now() : now);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    if (ISO_DATE.test(parts)) return parts;
  } catch (e) { /* fall through to UTC */ }
  return d.toISOString().slice(0, 10);
}

// What was typed, tidied. The password is deliberately NOT trimmed or
// touched: it is the person's own and goes to the login service as typed.
export function cleanApplication(input) {
  const v = input || {};
  return {
    fullName: oneLine(v.fullName, LIMITS.fullName),
    businessName: oneLine(v.businessName, LIMITS.businessName),
    abn: oneLine(v.abn, LIMITS.abn),
    phone: oneLine(v.phone, LIMITS.phone),
    email: oneLine(v.email, LIMITS.email).toLowerCase(),
    password: str(v.password),
    licenceNumber: oneLine(v.licenceNumber, LIMITS.licenceNumber),
    licenceExpiry: cleanDate(v.licenceExpiry),
    insurer: oneLine(v.insurer, LIMITS.insurer),
    insurancePolicy: oneLine(v.insurancePolicy, LIMITS.insurancePolicy),
    insuranceExpiry: cleanDate(v.insuranceExpiry),
    acceptedName: oneLine(v.acceptedName, LIMITS.acceptedName),
    agreed: v.agreed === true,
    agreementVersion: Number.isInteger(v.agreementVersion) ? v.agreementVersion : Number(v.agreementVersion) || 0,
  };
}

// settings: { agreementVersion, requireInsurance, requireLicenceExpiry }.
// Returns { ok, errors: { field: sentence }, value }. Every sentence is one a
// person filling in a form on a phone can act on.
export function checkApplication(input, settings, now) {
  const v = cleanApplication(input);
  const s = settings || {};
  const today = todayIso(now);
  const errors = {};

  if (!v.fullName) errors.fullName = 'Enter your full name.';
  if (!v.businessName) errors.businessName = 'Enter your business or trading name. If you work under your own name, enter that.';
  if (v.abn && v.abn.replace(/\D/g, '').length !== 11) errors.abn = 'An ABN has 11 digits. Check it, or leave it blank.';
  if (v.phone.replace(/\D/g, '').length < 8) errors.phone = 'Enter a phone number the business can reach you on.';
  if (!EMAIL.test(v.email)) errors.email = 'Enter your email address. You will sign in with it.';
  if (v.password.length < LIMITS.passwordMin) errors.password = `Choose a password of at least ${LIMITS.passwordMin} characters.`;
  else if (v.password.length > LIMITS.passwordMax) errors.password = 'That password is too long.';
  if (!v.licenceNumber) errors.licenceNumber = 'Enter your pest management licence number.';

  const rawLicenceExpiry = str(input && input.licenceExpiry).trim();
  if (rawLicenceExpiry && !v.licenceExpiry) errors.licenceExpiry = 'That licence expiry date is not a real date.';
  else if (s.requireLicenceExpiry && !v.licenceExpiry) errors.licenceExpiry = 'Enter the date your licence expires.';
  else if (v.licenceExpiry && v.licenceExpiry < today) errors.licenceExpiry = 'That licence has already expired. Enter your current licence.';

  const rawInsuranceExpiry = str(input && input.insuranceExpiry).trim();
  if (s.requireInsurance) {
    if (!v.insurer) errors.insurer = 'Enter the name of your insurer.';
    if (!v.insurancePolicy) errors.insurancePolicy = 'Enter your insurance policy number.';
  }
  if (rawInsuranceExpiry && !v.insuranceExpiry) errors.insuranceExpiry = 'That insurance expiry date is not a real date.';
  else if (s.requireInsurance && !v.insuranceExpiry) errors.insuranceExpiry = 'Enter the date your insurance expires.';
  else if (v.insuranceExpiry && v.insuranceExpiry < today) errors.insuranceExpiry = 'That insurance has already expired. Enter your current policy.';

  if (!v.agreed) errors.agreed = 'Tick the box to accept the agreement.';
  if (!v.acceptedName) errors.acceptedName = 'Type your full name to sign the agreement.';
  // They must be accepting the wording that is current, not a page left open
  // from before the business changed it.
  if (Number(s.agreementVersion) && v.agreementVersion !== Number(s.agreementVersion)) {
    errors.agreementVersion = 'The agreement was updated while this page was open. Reload the page and read the current one.';
  }

  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

// ---- Licence and insurance dates, once someone is on the list -------------
// 'none' (no date given), 'ok', 'soon' (within warnDays), 'lapsed'.
export function expiryState(dateIso, now, warnDays) {
  const d = cleanDate(dateIso);
  if (!d) return 'none';
  const today = todayIso(now);
  if (d < today) return 'lapsed';
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + (Number.isFinite(warnDays) ? warnDays : 30));
  return d <= limit.toISOString().slice(0, 10) ? 'soon' : 'ok';
}

function niceDate(iso) {
  const d = cleanDate(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[m - 1]} ${y}`;
}

// What needs saying about one subcontractor's paperwork, worst first.
// me: { licenceExpiry, insuranceExpiry }. Returns
// { lapsed: [sentence], soon: [sentence], blocked: boolean }.
// blocked is true when something has lapsed: the app then stops that person
// starting or submitting a report until the date is brought up to date.
export function paperworkState(me, now) {
  const m = me || {};
  const lapsed = [];
  const soon = [];
  const items = [
    ['licence', m.licenceExpiry],
    ['insurance', m.insuranceExpiry],
  ];
  for (const [word, date] of items) {
    const state = expiryState(date, now);
    if (state === 'lapsed') lapsed.push(`The ${word} on record expired on ${niceDate(date)}.`);
    else if (state === 'soon') soon.push(`The ${word} on record expires on ${niceDate(date)}.`);
  }
  return { lapsed, soon, blocked: lapsed.length > 0 };
}

// The page a subcontractor is sent to. base is the folder the app is served
// from, e.g. https://example.github.io/field-inspect/
export function inviteUrl(base, token) {
  const b = str(base).replace(/[^/]*$/, '');
  return validToken(token) ? `${b}join.html?t=${token}` : '';
}
