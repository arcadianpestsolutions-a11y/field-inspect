// A subcontractor signing up to work under a host business.
//
// DELIBERATELY NOT BEHIND SUPABASE AUTH, for the same reason client-portal is
// not: the person opening the link has no login yet. Making one is the point.
// The token in the link is the credential. The host copies the link out of
// Scope, can switch it off, and can replace it (the old one then stops
// working at once).
//
//   THIS FUNCTION MUST HAVE "Enforce JWT Verification" TURNED OFF. It is
//   recorded in supabase/config.toml so it survives a redeploy.
//
// WHAT IT DOES
//   POST { action: 'invite', token }
//     -> the host's name and logo, the agreement to read, and which details
//        the host requires. Nothing else about the business.
//   POST { action: 'apply', token, application: {...} }
//     -> makes the person a login and files their application as PENDING.
//        A pending application opens nothing: every rule in migration 048
//        asks for status 'active', and only the host's admin can set that.
//
// PUBLIC SIGN-UP STAYS OFF. The project does not allow anybody to create an
// account, and this does not change that: a login is made here only for
// someone holding a link a business chose to hand out, and it can see
// nothing until that business approves them.
//
// THE PASSWORD is the applicant's own. It arrives over HTTPS, goes straight
// to the login service, and is never logged, stored or returned by this code.
//
// IT RUNS ON service_role AND THEREFORE BYPASSES ROW-LEVEL SECURITY. Its
// grants are its limit (migration 048): it can read the settings row and the
// business's name and logo, and read and insert subcontractor applications.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both built in).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
// The rules for a complete application, shared with the sign-up page and the
// browser test suite.
import { checkApplication, LINK_REFUSAL, validToken } from '../_shared/subcontractor.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
  });
}

const refusal = () => json({ ok: false, error: 'not-available', message: LINK_REFUSAL }, 404);
const trouble = () => json({ ok: false, error: 'unavailable', message: 'Something went wrong on our side. Nothing was saved. Try again shortly.' }, 500);

// A business that leaves applications unanswered cannot be flooded through
// its own link: past this many waiting, new ones are turned away until the
// business deals with the ones it has.
const MAX_WAITING = 30;

type Row = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return trouble();

  try {
    const body = (await req.json().catch(() => ({}))) as Row;
    const token = String(body.token || '').trim().toLowerCase();
    // Checked for shape before it is used in any query.
    if (!validToken(token)) return refusal();

    const { data: settings, error: settingsError } = await admin
      .from('subcontractor_settings')
      .select('org_id, invite_enabled, agreement_text, agreement_version, require_insurance, require_licence_expiry')
      .eq('invite_token', token)
      .maybeSingle();
    if (settingsError) { console.error('[subcontractor-join] settings:', settingsError.message); return trouble(); }
    // Switched off, replaced, never issued, or no agreement written yet: one answer.
    if (!settings || !settings.invite_enabled || !String(settings.agreement_text || '').trim()) return refusal();

    const { data: org, error: orgError } = await admin
      .from('organisations')
      .select('name, trading_name, logo_data_url')
      .eq('id', settings.org_id)
      .maybeSingle();
    if (orgError) { console.error('[subcontractor-join] organisation:', orgError.message); return trouble(); }
    if (!org) return refusal();
    const businessName = String(org.trading_name || '').trim() || String(org.name || '').trim();

    const action = String(body.action || 'invite');

    if (action === 'invite') {
      // Field by field. Nothing about the business beyond what its own
      // subcontractors are about to see on every report anyway.
      return json({
        ok: true,
        business: { name: businessName, logoDataUrl: String(org.logo_data_url || '') },
        agreement: { text: String(settings.agreement_text), version: settings.agreement_version },
        requires: { insurance: settings.require_insurance === true, licenceExpiry: settings.require_licence_expiry === true },
      });
    }

    if (action !== 'apply') return json({ ok: false, error: 'unknown-action' }, 400);

    const check = checkApplication(body.application, {
      agreementVersion: settings.agreement_version,
      requireInsurance: settings.require_insurance === true,
      requireLicenceExpiry: settings.require_licence_expiry === true,
    }, Date.now());
    if (!check.ok) return json({ ok: false, error: 'invalid', errors: check.errors }, 400);
    const v = check.value;

    const { count: waiting, error: countError } = await admin
      .from('subcontractors')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', settings.org_id)
      .eq('status', 'pending');
    if (countError) { console.error('[subcontractor-join] count:', countError.message); return trouble(); }
    if ((waiting || 0) >= MAX_WAITING) {
      return json({
        ok: false, error: 'too-many-waiting',
        message: `${businessName} has a lot of applications waiting already. Ask them to go through the ones they have, then try again.`,
      }, 429);
    }

    const { data: already, error: alreadyError } = await admin
      .from('subcontractors')
      .select('id')
      .eq('org_id', settings.org_id)
      .eq('email', v.email)
      .limit(1);
    if (alreadyError) { console.error('[subcontractor-join] lookup:', alreadyError.message); return trouble(); }
    if (already && already.length) {
      return json({
        ok: false, error: 'already-applied',
        message: `You have already applied to ${businessName} with that email address. Sign in to Scope with it to see where your application is up to.`,
      }, 409);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: v.email,
      password: v.password,
      // The host approves each person by name, licence and phone before they
      // can see anything, which is a stronger check than a click in an inbox,
      // and the project's built-in mail cannot reach outside addresses.
      email_confirm: true,
      user_metadata: { scope_kind: 'subcontractor' },
    });
    if (createError || !created || !created.user) {
      const msg = String((createError && createError.message) || '');
      if (/already|registered|exists/i.test(msg)) {
        return json({
          ok: false, error: 'email-in-use',
          message: 'That email address already has a Scope login. Use a different email address to work for this business.',
        }, 409);
      }
      if (/password/i.test(msg)) {
        return json({ ok: false, error: 'invalid', errors: { password: 'That password was not accepted. Choose a longer one that is harder to guess.' } }, 400);
      }
      console.error('[subcontractor-join] create login:', msg);
      return trouble();
    }
    const userId = created.user.id;

    const { error: insertError } = await admin.from('subcontractors').insert({
      org_id: settings.org_id,
      user_id: userId,
      email: v.email,
      status: 'pending',
      full_name: v.fullName,
      business_name: v.businessName,
      abn: v.abn,
      phone: v.phone,
      licence_number: v.licenceNumber,
      licence_expiry: v.licenceExpiry || null,
      insurer: v.insurer,
      insurance_policy: v.insurancePolicy,
      insurance_expiry: v.insuranceExpiry || null,
      // The wording as it stands on the server at this moment, not whatever
      // the page sent back: this is the record of what was agreed to.
      agreement_text: String(settings.agreement_text),
      agreement_version: settings.agreement_version,
      agreement_accepted_at: new Date().toISOString(),
      agreement_accepted_name: v.acceptedName,
    });
    if (insertError) {
      console.error('[subcontractor-join] insert:', insertError.message);
      // A login with no application behind it would block this person from
      // trying again with the same email. Take it back out.
      await admin.auth.admin.deleteUser(userId).catch((e: unknown) => console.error('[subcontractor-join] could not undo login:', String(e)));
      return trouble();
    }

    return json({ ok: true, business: { name: businessName } });
  } catch (err) {
    console.error('[subcontractor-join]', err instanceof Error ? err.message : String(err));
    return trouble();
  }
});
