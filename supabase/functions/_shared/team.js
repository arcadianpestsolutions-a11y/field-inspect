// Who may be added to a business, and what a valid request to add them is.
//
// Shared with the invite-user Edge Function and the suite, same arrangement as
// the other _shared modules: plain ES module, no dependencies.
//
// THE MODEL IS INVITE-ONLY. A business's admin adds the people who work for
// it; nobody signs themselves up. That is what the login screen already tells
// people ("ask your admin to set one up for you"), and it is the only model
// that does not need a decision about who is allowed to create a business.
// Everything here assumes it.

export const ROLES = ['admin', 'technician'];

// Long enough to resist guessing, short enough to read out over the phone
// while standing in a driveway. Supabase's own minimum is 6; this is not a
// place to be lenient, because the account can read every client's details.
export const MIN_PASSWORD_LENGTH = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns { ok: true, value } with the request cleaned up, or
// { ok: false, error } naming the first thing wrong, in words that can be
// shown to the person who typed it.
export function validateInvite(input) {
  const src = input || {};
  const email = String(src.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'An email address is required.' };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: `"${email}" is not a valid email address.` };

  const role = String(src.role || 'technician').trim().toLowerCase();
  if (!ROLES.includes(role)) return { ok: false, error: `Role must be one of: ${ROLES.join(', ')}.` };

  const displayName = String(src.displayName || '').trim().slice(0, 100);

  // Optional. With one, the account is created ready to use and the admin
  // tells the person the password; without, they are emailed an invitation.
  const hasPassword = src.temporaryPassword != null && String(src.temporaryPassword) !== '';
  const temporaryPassword = hasPassword ? String(src.temporaryPassword) : null;
  if (temporaryPassword !== null && temporaryPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `A temporary password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  return { ok: true, value: { email, role, displayName, temporaryPassword } };
}

// Whether an existing account may be attached to the caller's business.
//   attach  - it has no business yet, or already belongs to this one
//   refuse  - it belongs to a different business; taking it over by inviting
//             its email address would move a person between businesses without
//             their say, and hand this business whatever they can see
// `existing` is that account's user_roles row, or null if it has none.
export function attachDecision(existing, callerOrgId) {
  if (!callerOrgId) return { action: 'refuse', reason: 'no-business' };
  if (!existing || !existing.org_id) return { action: 'attach' };
  if (existing.org_id === callerOrgId) return { action: 'attach' };
  return { action: 'refuse', reason: 'belongs-to-another-business' };
}

// Whether `callerId` may remove `targetRow` from `callerOrgId`. Same-business
// only, and never yourself: removing yourself is how a business ends up with
// no admin and nobody able to add anyone.
export function removalDecision(targetRow, callerId, callerOrgId) {
  if (!callerOrgId) return { ok: false, reason: 'no-business' };
  // Same answer for "does not exist" and "belongs to someone else", so ids
  // from other businesses cannot be probed one request at a time.
  if (!targetRow || targetRow.org_id !== callerOrgId) return { ok: false, reason: 'not-found' };
  if (targetRow.user_id === callerId) return { ok: false, reason: 'cannot-remove-yourself' };
  return { ok: true, reason: null };
}
