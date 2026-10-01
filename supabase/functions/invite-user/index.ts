// Adds a person to the caller's business, or removes one. Admin only.
//
// WHY THIS EXISTS. There was no way to add a second user: the login screen
// says "ask your admin to set one up" and the admin's only means of doing so
// was the Supabase dashboard plus hand-written SQL against user_roles. This is
// that, done safely: the new person is always attached to the CALLER's
// business, never one named in the request, so an admin of business A cannot
// create or take over an account in business B.
//
// THE MODEL IS INVITE-ONLY (see _shared/team.js). Nobody signs themselves up.
// For that to be true the project's own "Allow new users to sign up" setting
// has to be off — see supabase/config.toml and the note beside it.
//
// TWO WAYS TO ADD SOMEONE
//   { action: 'invite', email, role, displayName }
//       Supabase emails them an invitation link.
//   { action: 'invite', email, role, displayName, temporaryPassword }
//       The account is created ready to use and the admin tells them the
//       password. For a technician who is standing next to you, and for a
//       project whose invitation email is not set up yet.
//   { action: 'remove', userId }
//       Detaches them from the business and bans the login. They keep no
//       access to data (no business means every policy fails closed) and can
//       no longer use the functions that only check "signed in".
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// Optional: APP_URL — where an invitation link should land.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { orgAndRoleForUser } from '../_shared/org.js';
import { attachDecision, removalDecision, validateInvite } from '../_shared/team.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const APP_URL = Deno.env.get('APP_URL') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// supabase-js has no lookup by email, only a paged list. A business this size
// has a handful of users, so reading them all is fine; the loop is paged
// anyway because a list that silently stops at the first page would let an
// existing account be "invited" a second time.
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return { id: hit.id };
    if (users.length < perPage) return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: 'Not configured — a Supabase secret is not set.' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    // Admin of a business, or nothing. The role comes from the database, never
    // from the request, and a caller attached to no business is refused rather
    // than treated as an admin of "no business, so all of them".
    const { orgId, role } = await orgAndRoleForUser(admin, user.id);
    if (!orgId) return json({ error: 'Your account is not linked to a business yet.' }, 403);
    if (role !== 'admin') return json({ error: 'Only an admin can add or remove people.' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'invite');

    // ------------------------------------------------------------- remove ---
    if (action === 'remove') {
      const targetId = String(body.userId || '');
      if (!targetId) return json({ error: 'userId is required.' }, 400);

      const { data: target, error: targetError } = await admin
        .from('user_roles').select('user_id, org_id').eq('user_id', targetId).maybeSingle();
      if (targetError) throw new Error(targetError.message);

      const decision = removalDecision(target, user.id, orgId);
      if (!decision.ok) {
        if (decision.reason === 'cannot-remove-yourself') {
          return json({ error: 'You cannot remove yourself — ask another admin.' }, 400);
        }
        return json({ error: 'That person is not in your business.' }, 404);
      }

      // Detach first. If the ban below failed, the account is already unable
      // to read anything; the other order leaves a window where it is banned
      // from nothing and attached to everything.
      const { error: detachError } = await admin
        .from('user_roles')
        .update({ org_id: null, role: 'technician', updated_at: new Date().toISOString() })
        .eq('user_id', targetId).eq('org_id', orgId);
      if (detachError) throw new Error(detachError.message);

      const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: '876000h' });
      if (banError) throw new Error(`Detached, but the login could not be disabled: ${banError.message}`);
      return json({ removed: true });
    }

    if (action !== 'invite') return json({ error: `Unknown action: ${action}` }, 400);

    // ------------------------------------------------------------- invite ---
    const checked = validateInvite(body);
    if (!checked.ok) return json({ error: checked.error }, 400);
    const { email, role: newRole, displayName, temporaryPassword } = checked.value;

    const existing = await findAuthUserByEmail(email);
    let targetId: string;
    let status: 'invited' | 'created' | 'updated';

    if (existing) {
      const { data: existingRole, error: roleError } = await admin
        .from('user_roles').select('user_id, org_id').eq('user_id', existing.id).maybeSingle();
      if (roleError) throw new Error(roleError.message);

      // Deliberately vague. Saying "that account belongs to another business"
      // tells an admin which email addresses are customers of someone else.
      if (attachDecision(existingRole, orgId).action === 'refuse') {
        return json({ error: 'That email address cannot be added.' }, 409);
      }
      targetId = existing.id;
      status = 'updated'; // role and name only — an existing login's password is never touched here
    } else if (temporaryPassword) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: temporaryPassword, email_confirm: true,
      });
      if (error || !data?.user) throw new Error(error?.message || 'Could not create the account.');
      targetId = data.user.id;
      status = 'created';
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(
        email, APP_URL ? { redirectTo: APP_URL } : undefined,
      );
      if (error || !data?.user) throw new Error(error?.message || 'Could not send the invitation.');
      targetId = data.user.id;
      status = 'invited';
    }

    // org_id comes from the caller's own row above — the request has no way to
    // name a business. If this write fails the account exists with no role,
    // which reads nothing; running the same invite again attaches it.
    const { error: upsertError } = await admin.from('user_roles').upsert({
      user_id: targetId,
      email,
      role: newRole,
      org_id: orgId,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (upsertError) throw new Error(upsertError.message);

    return json({ status, userId: targetId, email, role: newRole });
  } catch (err) {
    console.error('[invite-user]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
