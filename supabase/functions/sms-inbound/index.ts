// Receives replies to Scope's SMS reminders from the SMS provider and
// honours "STOP".
//
// WHY THIS EXISTS. Every reminder says "Reply STOP to opt out." Replies used
// to land in the provider's inbox and nowhere else, so a client who did exactly
// what the message told them to do was texted again. See
// _shared/sms-optout.js for what counts as a STOP and why, and migration 030
// for where the opt-out is kept.
//
// DELIBERATELY NOT BEHIND SUPABASE AUTH, and the credential is a secret in
// the URL, the same arrangement as calendar-feed. The provider calling this
// has no way to hold a user's login.
//
//   THIS FUNCTION MUST HAVE "Enforce JWT Verification" TURNED OFF (it is also
//   set in supabase/config.toml, which the CLI honours on deploy). If it is
//   on, every reply bounces with 401 before this code runs and the failure
//   looks like replies are simply not arriving.
//
// SET UP, in order:
//   1. Run supabase-migration-030-sms-opt-outs.sql.
//   2. Set a secret:  SMS_INBOUND_TOKEN  = a long random string.
//   3. Deploy this function.
//   4. In ClickSend: SMS -> Settings -> Inbound SMS Rules -> add a rule for
//      the number the reminders come from, action "URL", and point it at
//        https://<project>.supabase.co/functions/v1/sms-inbound?token=<SMS_INBOUND_TOKEN>
//      Check the payload format ClickSend offers matches what is parsed
//      below (it reads `from` and `body` or `message`, from JSON, a form or
//      the query string).
//   5. Text the reminder number from your own phone with STOP, then look at
//      the function's logs and at public.sms_opt_outs. Do this BEFORE trusting
//      it with a real client.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMS_INBOUND_TOKEN

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  classifyReply, inboundFields, phoneKey, tokensMatch,
} from '../_shared/sms-optout.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SMS_INBOUND_TOKEN = Deno.env.get('SMS_INBOUND_TOKEN') || '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Accepts JSON, a form post, or query parameters, whichever the provider is
// configured to send, and merges them. Body fields win over the query string.
async function readPayload(req: Request): Promise<Record<string, unknown>> {
  const url = new URL(req.url);
  const merged: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => { if (k !== 'token') merged[k] = v; });
  if (req.method !== 'POST') return merged;

  const type = (req.headers.get('content-type') || '').toLowerCase();
  try {
    if (type.includes('application/json')) {
      Object.assign(merged, await req.json());
    } else if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const form = await req.formData();
      form.forEach((v, k) => { merged[k] = typeof v === 'string' ? v : ''; });
    }
  } catch (err) {
    console.error('[sms-inbound] could not read the body:', err);
  }
  return merged;
}

Deno.serve(async (req) => {
  // Not configured is a refusal, never "accept anything": with no secret set
  // tokensMatch() is false for every input, including an empty one.
  if (!SMS_INBOUND_TOKEN) {
    return reply({ error: 'Not configured — SMS_INBOUND_TOKEN is not set.' }, 500);
  }
  const given = new URL(req.url).searchParams.get('token') || '';
  if (!tokensMatch(given, SMS_INBOUND_TOKEN)) return reply({ error: 'Not authorised' }, 401);

  try {
    const { from, body, messageId } = inboundFields(await readPayload(req));
    const key = phoneKey(from);
    const kind = classifyReply(body);

    // From here on this answers 200 whatever happens, or the provider retries
    // the same reply for hours. What was done is in the body and the logs.
    if (!key) {
      console.warn('[sms-inbound] reply from a number that is not an AU mobile; ignored');
      return reply({ handled: false, reason: 'not-a-mobile' });
    }
    if (kind !== 'opt_out') {
      // A person wrote back and it was not a STOP. Nothing here reads it, so
      // at least leave a trace that it arrived, without storing their number
      // in a log in full.
      console.log(`[sms-inbound] reply from ${key.slice(0, 6)}***${key.slice(-2)} is not an opt-out; left for a human`);
      return reply({ handled: false, reason: 'not-an-opt-out' });
    }

    // Which businesses have texted this number? A STOP is addressed to them,
    // and only them: the opt-out is written against each business that has
    // actually sent to it, never against one that has not.
    const { data: sent, error: sentError } = await admin
      .from('client_messages').select('org_id')
      .eq('channel', 'sms').eq('recipient', key);
    if (sentError) throw new Error(sentError.message);

    const orgIds = [...new Set((sent || []).map((r) => (r as { org_id: string | null }).org_id).filter(Boolean))] as string[];
    if (!orgIds.length) {
      console.warn('[sms-inbound] STOP from a number no business has texted; nothing to record');
      return reply({ handled: false, reason: 'no-business-has-texted-this-number' });
    }

    let jobsFlagged = 0;
    for (const orgId of orgIds) {
      const { data, error } = await admin.rpc('record_sms_opt_out', {
        p_org: orgId, p_phone: key, p_body: body, p_message_id: messageId || null,
      });
      if (error) throw new Error(error.message);
      jobsFlagged += Number(data) || 0;
    }
    return reply({ handled: true, businesses: orgIds.length, jobsFlagged });
  } catch (err) {
    // A real failure is the one case worth a non-200: the provider retrying
    // is what we want, because the opt-out has NOT been recorded.
    console.error('[sms-inbound]', err);
    return reply({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
