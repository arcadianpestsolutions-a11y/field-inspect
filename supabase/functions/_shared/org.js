// Which business is asking, and what it is called.
//
// One file, two consumers: the Edge Functions import it under Deno, and
// tests/run-tests.js pulls it in with a dynamic import() — the same
// arrangement as reminder-sms.js, and for the same reason: a plain ES module
// with no dependencies runs in both places without a build step.
//
// WHY THIS EXISTS
// Every Edge Function except calendar-feed does its real work on the
// service_role key, which bypasses row-level security entirely. "Signed in"
// therefore does not mean "allowed to see this row" there, and each function
// has to work out the caller's business itself and filter by it. This was
// copied into send-client-message inline; this is the same lookup in one
// place, so the next function does not get to forget it.
//
// The second job is the business's name. It was typed into the email
// templates of three functions. It is a row now (migration 022), so the
// templates read the row.
//
// Both lookups take the client as an argument rather than creating one, which
// is what lets the suite drive them with a fake.

// What the business calls itself. The trading name wins because it is what a
// client knows them as; the registered name is the fallback. Never guesses:
// an organisation with neither returns '' and the caller words around it,
// rather than a name from somebody else's business appearing on an email.
export function businessNameOf(org) {
  if (!org) return '';
  const trading = String(org.trading_name || '').trim();
  if (trading) return trading;
  return String(org.name || '').trim();
}

// The org a signed-in user belongs to. Returns null for a user with no role
// row, or one not yet attached to a business — callers treat null as "refuse",
// never as "everything", because null is exactly what a missing org looks like.
export async function orgIdForUser(admin, userId) {
  if (!userId) return null;
  const { data, error } = await admin
    .from('user_roles').select('org_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Could not look up the caller's business: ${error.message}`);
  return (data && data.org_id) || null;
}

// The organisation row itself, or null.
export async function loadOrg(admin, orgId) {
  if (!orgId) return null;
  const { data, error } = await admin
    .from('organisations')
    .select('id, name, trading_name, phone, email')
    .eq('id', orgId).maybeSingle();
  if (error) throw new Error(`Could not read the business details: ${error.message}`);
  return data || null;
}

// Name for a signed-in caller, or '' if it cannot be worked out. A failed
// lookup must not stop a report being emailed to a client, so this swallows
// the error where orgIdForUser does not — the sign-off is the part that can
// degrade, the send is not.
export async function businessNameForUser(admin, userId) {
  try {
    const orgId = await orgIdForUser(admin, userId);
    return businessNameOf(await loadOrg(admin, orgId));
  } catch (err) {
    console.error('[org] could not resolve business name:', err);
    return '';
  }
}

// "Kind regards" block, and a way of saying "from <business>" that still reads
// properly when the name is unknown.
export function signOff(name) {
  return name ? `Kind regards,<br>${escapeHtml(name)}` : 'Kind regards';
}

export function fromBusiness(name) {
  return name ? ` from ${escapeHtml(name)}` : '';
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
