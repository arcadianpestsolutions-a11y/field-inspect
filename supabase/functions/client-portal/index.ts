// Serves one client their own report, and takes their acceptance of a quote.
//
// DELIBERATELY NOT BEHIND SUPABASE AUTH, for the same reason calendar-feed is
// not: the person opening this has no account and never will. The token in
// the query string IS the credential.
//
//   THIS FUNCTION MUST HAVE "Enforce JWT Verification" TURNED OFF in its
//   Settings tab after deploying. Every other function in this project except
//   calendar-feed needs that switch ON. Left on, every client's link bounces
//   with 401 before this code runs and the portal simply looks broken.
//
// IT RUNS ON service_role AND THEREFORE BYPASSES ROW-LEVEL SECURITY. Nothing
// in Postgres is protecting this data; the filtering below is. That is why
// every query here is keyed on the token's own job_id, why the response is
// assembled field by field rather than by spreading a row, and why there is a
// test above each query saying what must never come back.
//
// WHAT IT RETURNS: the client's own name and address, the visit date, the
// next due date, a short-lived signed URL for the finalised report, the
// invoice total and status, and — when the link was issued asking for it —
// the quote figures and whether it has been accepted.
//
// WHAT IT MUST NEVER RETURN: technician notes, the audit trail, photographs,
// other jobs at that address, the org id, internal ids beyond the ones needed
// to render, or anything at all belonging to another client. If a field is
// not in the response literal below, it does not go out.
//
// ---------------------------------------------------------------------------
// THE ONE THING THIS FUNCTION WRITES, AND THE ONE THING IT WILL NOT.
//
// POST ?t=<token> {action:'accept'} INSERTS a row into client_acceptances.
// That is the only write of consequence here, and it is an insert: migration
// 030 grants this role SELECT and INSERT on that table and nothing else.
//
// IT DOES NOT TOUCH public.reports. The tempting version of this feature
// drops the client's signature straight into reports.sections.acknowledgement
// so the PDF comes out signed — which would make an endpoint with no login
// the thing that can rewrite a finalised compliance document. The signature
// reaches the document only when the business puts it there from inside the
// app, where there is a user to attribute it to. Migration 030 says this at
// greater length and the grant enforces it.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Shared with the browser test suite, which is where the rules below are
// actually covered — see _shared/acceptance.js.
import {
  checkAcceptance, MAX_NAME_CHARS, quoteFrom, signedOnSite, str,
} from '../_shared/acceptance.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUSINESS_NAME = Deno.env.get('BUSINESS_NAME') || 'Arcadian Pest Solutions';
const BUSINESS_PHONE = Deno.env.get('BUSINESS_PHONE') || '';
const BUSINESS_EMAIL = Deno.env.get('BUSINESS_REPLY_TO') || '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      // Never cached anywhere in between. A report sitting in a proxy is a
      // report that outlives the link's expiry.
      'Cache-Control': 'no-store, private',
    },
  });
}

// One refusal for every reason a link does not work. An expired link and a
// revoked link and a made-up link all get the same sentence on purpose: a
// portal that distinguishes them is a portal that confirms which tokens exist
// to somebody guessing.
const REFUSAL = {
  error: 'not-available',
  message: 'This link is no longer available. Ask us for a new one.',
};

// The number of minutes a report URL stays good once handed out. Short, because
// the URL itself carries no further check — anybody holding it can fetch the
// file until it expires.
const SIGNED_URL_MINUTES = 10;

// Rows come back from PostgREST untyped, and every read of one in this file is
// narrowed by hand immediately below the comment saying what it may contain.
type Row = Record<string, any>;

// The client's own IP, as the platform saw it. Behind a proxy the header is a
// list and the first entry is the client; the rest are hops.
function callerIp(req: Request) {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return (fwd.split(',')[0] || '').trim().slice(0, 64);
}

async function liveAcceptanceFor(jobId: string) {
  const { data } = await admin
    .from('client_acceptances')
    .select('accepted_name, accepted_at')
    .eq('job_id', jobId)
    .is('superseded_at', null)
    .maybeSingle();
  // The signature image is not selected. The page has no use for it and a
  // picture of somebody's signature is not something to hand back out to
  // whoever holds the link next.
  return data ? { name: str(data.accepted_name), at: data.accepted_at } : null;
}

// Everything both verbs need: the token row and its job.
type Gate = {
  fail?: Response;
  token: string;
  access: Row;
  job: Row;
  report: Row | null;
};

// `fail` carries the Response when the request is going no further, so every
// caller starts with the same two lines and cannot forget the check.
const refuse = (res: Response): Gate =>
  ({ fail: res, token: '', access: {}, job: {}, report: null });

async function gate(req: Request): Promise<Gate> {
  const url = new URL(req.url);
  const token = (url.searchParams.get('t') || '').trim();
  // Checked for shape before it is ever used in a query. Tokens are 64 hex
  // characters; anything else is not a token that was ever issued.
  if (!/^[a-f0-9]{64}$/i.test(token)) return refuse(json(REFUSAL, 404));

  const { data: access, error: accessError } = await admin
    .from('client_access')
    .select('token, job_id, expires_at, revoked_at, view_count, acceptance_requested_at')
    .eq('token', token)
    .maybeSingle();

  if (accessError) {
    console.error('[client-portal]', accessError);
    return refuse(json({ error: 'unavailable', message: 'Something went wrong. Try again shortly.' }, 500));
  }
  if (!access) return refuse(json(REFUSAL, 404));
  if (access.revoked_at) return refuse(json(REFUSAL, 404));
  if (!access.expires_at || access.expires_at < Date.now()) return refuse(json(REFUSAL, 404));

  // Keyed on the token's own job. There is no path here where a job id comes
  // from the request.
  const { data: job, error: jobError } = await admin
    .from('jobs')
    // Named columns, not *. A select * here would ship technician notes and
    // every column added to this table in future straight to the client.
    //
    // org_id is read and NEVER returned. It is here because an acceptance row
    // has to be written into the right business: the column's default is
    // public.my_org_id(), which reads auth.uid(), and this function has no
    // signed-in user — so an insert that leaves org_id to the default lands
    // with a null and belongs to nobody. Migration 029's backfill learned
    // this the expensive way.
    .select('id, name, address, job_type, inspection_date, inspection_ended_at, next_due_at, scheduled_at, org_id')
    .eq('id', access.job_id)
    .maybeSingle();

  if (jobError || !job) {
    console.error('[client-portal] job missing for a live token', access.job_id);
    return refuse(json(REFUSAL, 404));
  }

  // Selected together with the report because both verbs need it: GET to show
  // what is being accepted, POST to refuse accepting twice. `sections` goes
  // no further than quoteFrom() and signedOnSite() in this file.
  const { data: report } = await admin
    .from('reports')
    .select('job_id, document_type, finalized_at, sections')
    .eq('job_id', access.job_id)
    .maybeSingle();

  return { token, access: access as Row, job: job as Row, report: (report || null) as Row | null };
}

async function handleGet(req: Request) {
  const g = await gate(req);
  if (g.fail) return g.fail;
  const { token, access, job, report } = g;
  const now = Date.now();

  // A short-lived signed URL for a file in a private bucket. Two expiries
  // stacked on purpose: the link expires in months, this URL in minutes.
  let reportUrl: string | null = null;
  if (report && report.finalized_at) {
    const path = `${access.job_id}/report/report.pdf`;
    const { data: signed } = await admin.storage
      .from('inspection-media')
      .createSignedUrl(path, SIGNED_URL_MINUTES * 60);
    reportUrl = signed ? signed.signedUrl : null;
  }

  const { data: invoices } = await admin
    .from('invoices')
    .select('id, number, status, xero_status, due_date, line_items, gst_registered')
    .eq('job_id', access.job_id);

  // Totalled here rather than shipping line items, which name products and
  // quantities the client has no need for and which are the business's own
  // pricing.
  const GST_RATE = 0.1;
  const invoice = (invoices || [])
    .filter((i) => i.status !== 'draft')
    .map((i) => {
      const gstRegistered = i.gst_registered !== false;
      let cents = 0;
      for (const line of (i.line_items as Array<Record<string, number>>) || []) {
        const sub = Math.round((Number(line.quantity) || 0) * (Number(line.unitAmountCents) || 0));
        cents += sub + (gstRegistered ? Math.round(sub * GST_RATE) : 0);
      }
      return {
        number: i.number,
        totalCents: cents,
        paid: String(i.xero_status || '').toUpperCase() === 'PAID',
        dueDate: i.due_date,
      };
    })[0] || null;

  // Only built when the link was issued asking for acceptance. A link sent
  // purely so somebody can read their report does not put a contract in front
  // of them.
  let acceptance = null;
  if (access.acceptance_requested_at) {
    const sections = report ? (report.sections as Row) : null;
    acceptance = {
      quote: quoteFrom(sections),
      accepted: await liveAcceptanceFor(access.job_id),
      signedOnSite: signedOnSite(sections),
      // Nothing to accept until the document the client is agreeing to
      // actually exists in final form.
      ready: !!(report && report.finalized_at),
    };
  }

  // Best effort. A counter that fails must never stop a client reading their
  // own report.
  admin.from('client_access')
    .update({ last_seen_at: now, view_count: (access.view_count || 0) + 1, updated_at: now })
    .eq('token', token)
    .then(() => {}, (e: unknown) => console.warn('[client-portal] could not stamp view', e));

  // Assembled field by field. Nothing is spread from a row, so a column added
  // to any table above cannot start appearing here by accident.
  return json({
    business: { name: BUSINESS_NAME, phone: BUSINESS_PHONE, email: BUSINESS_EMAIL },
    client: { name: job.name || '', address: job.address || '' },
    visit: {
      jobType: job.job_type === 'pest_treatment' ? 'pest_treatment' : 'termite',
      date: job.inspection_date || null,
      completedAt: job.inspection_ended_at || null,
      nextDueAt: job.next_due_at || null,
      scheduledAt: job.scheduled_at || null,
    },
    report: report && report.finalized_at
      ? { documentType: report.document_type || null, finalizedAt: report.finalized_at, url: reportUrl, urlMinutes: SIGNED_URL_MINUTES }
      : null,
    invoice,
    acceptance,
    expiresAt: access.expires_at,
  });
}

async function handleAccept(req: Request) {
  const g = await gate(req);
  if (g.fail) return g.fail;
  const { token, access, job, report } = g;

  // Not every link is asking for one. A POST to a link that was sent as a
  // read-only copy of a report gets the same refusal as a made-up token.
  if (!access.acceptance_requested_at) return json(REFUSAL, 404);

  let body: Row = {};
  try {
    body = (await req.json()) as Row;
  } catch {
    return json({ error: 'bad-request', message: 'Could not read that. Please try again.' }, 400);
  }
  if (str(body.action) !== 'accept') {
    return json({ error: 'bad-request', message: 'Could not read that. Please try again.' }, 400);
  }

  if (!report || !report.finalized_at) {
    return json({ error: 'not-ready', message: 'This quote is not ready to accept yet. Please get in touch.' }, 409);
  }

  const sections = report.sections as Row;
  if (signedOnSite(sections)) {
    return json({
      error: 'already-signed',
      message: 'This has already been signed. There is nothing more to do.',
    }, 409);
  }

  // Checked here as well as by the unique index, so the ordinary case gets a
  // sentence rather than a constraint violation. The index is what actually
  // guarantees it.
  const existing = await liveAcceptanceFor(access.job_id);
  if (existing) {
    return json({ error: 'already-accepted', accepted: existing }, 409);
  }

  const name = str(body.name).slice(0, MAX_NAME_CHARS);
  const signature = str(body.signature);
  // The rules live in _shared/acceptance.js, which is where the test suite
  // covers them. The same checks already ran on the page; they run again here
  // because that copy is the client's and can be skipped.
  const problem = checkAcceptance({ name, signature });
  if (problem === 'need-name') {
    return json({ error: problem, message: 'Please type your full name.' }, 400);
  }
  if (problem === 'need-signature') {
    return json({ error: problem, message: 'Please sign in the box above.' }, 400);
  }
  if (problem) {
    return json({ error: 'need-signature', message: 'That signature did not come through. Please try again.' }, 400);
  }

  const now = Date.now();
  const row = {
    id: `ac_${crypto.randomUUID().replace(/-/g, '')}`,
    job_id: access.job_id,
    token,
    document_type: str(report.document_type),
    report_finalized_at: report.finalized_at,
    accepted_name: name,
    signature,
    accepted_at: now,
    // The snapshot. What the page showed them, frozen at the moment they
    // agreed — see migration 030 on why this must never become a live lookup.
    presented: {
      quote: quoteFrom(sections),
      documentType: str(report.document_type),
      finalizedAt: report.finalized_at,
      address: str(job.address),
    },
    ip: callerIp(req),
    user_agent: (req.headers.get('user-agent') || '').slice(0, 400),
    // Written explicitly. See the note on the job select in gate().
    org_id: job.org_id,
    created_at: now,
    updated_at: now,
  };

  const { error } = await admin.from('client_acceptances').insert(row);
  if (error) {
    // 23505 is the one-live-acceptance index doing its job — two taps, or two
    // tabs. The client has accepted; telling them it failed would invite them
    // to do it again.
    if (String((error as Row).code) === '23505') {
      return json({ error: 'already-accepted', accepted: await liveAcceptanceFor(access.job_id) }, 409);
    }
    console.error('[client-portal] could not record acceptance', error);
    return json({ error: 'unavailable', message: 'Something went wrong. Please try again shortly.' }, 500);
  }

  return json({ accepted: { name, at: now } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method === 'POST') return handleAccept(req);
  if (req.method === 'GET') return handleGet(req);
  return json({ error: 'bad-request', message: 'Not supported.' }, 405);
});
