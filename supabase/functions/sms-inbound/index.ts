// Receives a text message sent TO the business, from ClickSend, and acts on it.
//
// WHAT IT IS FOR. Every reminder says "Reply STOP to opt out." This is what
// makes that true. A STOP is recorded against the sender's phone number, so
// nothing is sent to them again — not by this reminder, not by the next one,
// and not after they book another job. Every other reply is stored so a person
// reads it, instead of it sitting unseen in the SMS provider's dashboard.
//
// DELIBERATELY NOT BEHIND SUPABASE AUTH. ClickSend is a server calling this,
// and has no Scope login to present. That means "Enforce JWT Verification" is
// OFF for this function (recorded in supabase/config.toml, so it survives a
// redeploy).
//
// WHAT STANDS IN FOR A LOGIN is a secret in the URL: ?k=<SMS_INBOUND_TOKEN>.
// ClickSend does not sign its webhooks, so a shared secret in the address is
// what separates "ClickSend" from "anyone on the internet who found the URL".
// Three rules follow from that, and each is checked by the test suite:
//   1. If the secret is not configured the endpoint REFUSES everything. It never
//      falls back to open, because "I haven't set it up yet" must not mean
//      "anybody may record an opt-out for any number".
//   2. The comparison is constant-time.
//   3. A wrong secret gets one bare answer and nothing else — no hint about
//      whether the secret was close, or whether the function exists.
//
// WHAT A STOLEN SECRET CAN DO, kept small on purpose. This function runs on the
// service_role key, which bypasses row-level security, so what it may touch is
// set by grants, not by policies (migration 032): it can INSERT an opt-out and
// INSERT a message, read the opt-out list, and flag jobs. It cannot remove an
// opt-out, cannot read anybody's messages back, and cannot touch any other
// table. The worst a leaked secret does is silence somebody who did not ask to
// be silenced — visible in the app, and undone with one tap.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMS_INBOUND_TOKEN
//
// To connect it (once, in ClickSend):
//   Dashboard -> SMS -> Inbound SMS Rules -> new rule. Action: URL.
//   URL: https://<project>.supabase.co/functions/v1/sms-inbound?k=<your token>
//   Method: POST (any of POST, JSON or GET works).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normaliseAuMobile } from '../_shared/reminder-sms.js';
import { decideInbound, parseInbound, sameSecret } from '../_shared/sms-inbound.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const INBOUND_TOKEN = Deno.env.get('SMS_INBOUND_TOKEN') || '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

// Postgres "unique violation". On a retry, or a second STOP from somebody who
// has already opted out, this is the database confirming it already has the
// row — which is success, not failure, and must not be answered with an error
// the provider will retry forever.
const isDuplicate = (err: unknown) => String((err as { code?: string })?.code) === '23505';

// Which business this message belongs to. A reply to one of OUR texts carries
// back the job id we attached when we sent it, and the job knows its business.
// Failing that, if exactly one business exists the answer is not in doubt.
// With more than one and no job id there is no honest answer, and guessing
// would record somebody's opt-out against the wrong company — so this returns
// null and the caller says so rather than guessing.
async function resolveBusiness(customString: string) {
  const cs = customString.trim().slice(0, 100);
  if (cs) {
    const { data } = await admin.from('jobs').select('id, org_id').eq('id', cs).maybeSingle();
    if (data && data.org_id) return { orgId: data.org_id as string, jobId: data.id as string };
  }
  const { data: orgs, error } = await admin.from('organisations').select('id').limit(2);
  if (!error && orgs && orgs.length === 1) return { orgId: orgs[0].id as string, jobId: null };
  return { orgId: null, jobId: null };
}

// Every job in this business whose phone number is this person's. Paged,
// because PostgREST silently stops at 1000 rows (max_rows in config.toml): an
// unpaged query would, past a thousand jobs, quietly leave some of this
// person's jobs unflagged — which is a failure that looks exactly like success.
async function jobIdsForNumber(orgId: string, e164: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('jobs')
      .select('id, client_phone')
      .eq('org_id', orgId)
      .not('client_phone', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const j of data || []) {
      if (normaliseAuMobile(j.client_phone).e164 === e164) out.push(j.id as string);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

Deno.serve(async (req) => {
  // Rule 1: not configured means not open.
  if (!INBOUND_TOKEN) return reply({ error: 'not-configured' }, 503);

  const url = new URL(req.url);
  // Rules 2 and 3.
  if (!sameSecret(url.searchParams.get('k') || '', INBOUND_TOKEN)) {
    return reply({ error: 'unauthorised' }, 401);
  }
  if (req.method !== 'POST' && req.method !== 'GET') return reply({ error: 'method' }, 405);

  try {
    const raw = req.method === 'POST' ? await req.text() : '';
    const parsed = parseInbound(req.headers.get('content-type') || '', raw, url.searchParams);
    const decision = decideInbound(parsed);
    if (decision.ignore) return reply({ ok: true, ignored: true });

    const { orgId, jobId } = await resolveBusiness(parsed.customString);
    const now = Date.now();
    let suppressed = false;
    let why: string | null = null;

    if (decision.kind === 'stop') {
      if (!decision.keyable || !decision.e164) {
        // Said stop, but from a number that is not an Australian mobile, so
        // there is nothing to key the suppression on. Kept below, loudly.
        why = 'sender-not-a-mobile';
      } else if (!orgId) {
        why = 'business-unknown';
      } else {
        // FIRST, before the message is stored: if this fails the provider will
        // retry the whole request, and the retry must find the opt-out still
        // to do. Every step below tolerates having already happened.
        const { error } = await admin.from('comms_opt_outs').insert({
          id: newId('oo'),
          phone_e164: decision.e164,
          source: 'sms-reply',
          message: decision.body.slice(0, 200),
          provider_message_id: parsed.messageId.slice(0, 100),
          created_at: now,
          org_id: orgId,
        });
        if (error && !isDuplicate(error)) throw new Error(error.message);
        suppressed = true;

        // Cosmetic, so the app's per-job control shows it at once. The list
        // above is the authority — sync can overwrite this flag from a stale
        // device — so a failure here is logged and does not fail the request.
        try {
          const ids = await jobIdsForNumber(orgId, decision.e164);
          if (ids.length) {
            await admin.from('jobs').update({ comms_opt_out: true, updated_at: now }).in('id', ids);
          }
        } catch (e) {
          console.warn('[sms-inbound] could not flag jobs:', e instanceof Error ? e.message : e);
        }
      }
      if (!suppressed) {
        // The one outcome that must not be quiet: somebody told us to stop and
        // we could not record it by number.
        console.error('[sms-inbound] STOP NOT SUPPRESSED:', why);
      }
    }

    const { error: storeError } = await admin.from('sms_inbound').insert({
      id: newId('in'),
      from_e164: decision.e164 || '',
      from_raw: parsed.from.slice(0, 40),
      body: decision.body,
      kind: decision.kind,
      job_id: jobId,
      provider_message_id: parsed.messageId.slice(0, 100),
      received_at: now,
      org_id: orgId,
    });
    if (storeError && !isDuplicate(storeError)) throw new Error(storeError.message);

    // 200 even when a STOP could not be keyed: the provider retrying will not
    // fix a number that is not a mobile, and the failure is logged and stored.
    return reply({ ok: true, kind: decision.kind, suppressed, ...(why ? { reason: why } : {}) });
  } catch (err) {
    // A real failure. 500 asks the provider to retry, and every step above is
    // safe to repeat.
    console.error('[sms-inbound]', err instanceof Error ? err.message : err);
    return reply({ error: 'unavailable' }, 500);
  }
});
