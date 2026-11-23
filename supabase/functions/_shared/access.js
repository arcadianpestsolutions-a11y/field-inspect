// Who is calling, and what they may use.
//
// "Signed in" used to be the whole test for four Edge Functions (report
// email, the booking assistant, AI drafting, delivery status). That was fine
// while the only logins were a business's own people. A subcontractor is a
// login too, and one that has applied but not been approved, or has been
// removed, is still a login. So each function now asks the database what the
// caller actually is (public.caller_access, migration 048) and this file
// turns the answer into yes or no.
//
// Shared with the browser test suite, so no imports and no platform calls
// outside callerAccess itself.

// row is what public.caller_access() returned (or null).
export function accessFrom(row) {
  const r = row || {};
  const orgId = r.orgId ? String(r.orgId) : '';
  return {
    member: !!orgId,
    orgId,
    role: orgId ? (r.role === 'admin' ? 'admin' : 'technician') : '',
    activeSubcontractor: r.activeSubcontractor === true,
  };
}

// 'business': things only a business's own people do (send a report to a
//             client, the booking assistant, delivery status).
// 'forms':    filling in a report, which an approved subcontractor also does
//             (AI drafting from photos).
export function mayUse(access, what) {
  const a = access || {};
  if (what === 'business') return a.member === true;
  if (what === 'forms') return a.member === true || a.activeSubcontractor === true;
  return false;
}

export const ACCESS_REFUSAL = {
  business: 'Your login cannot do this. It is not part of a business in Scope.',
  forms: 'Your login cannot do this yet. The business you work for has to approve you first.',
  unknown: 'Could not check what your login is allowed to do. Nothing was done. Try again shortly.',
};

// userClient: a supabase client carrying the caller's own token. Returns the
// access object, or null when the check itself failed (treat as refused).
export async function callerAccess(userClient) {
  try {
    const { data, error } = await userClient.rpc('caller_access');
    if (error) return null;
    return accessFrom(data);
  } catch (_e) {
    return null;
  }
}
