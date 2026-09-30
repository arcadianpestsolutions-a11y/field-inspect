// Serves one client their own report, and nothing else.
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
// next due date, a short-lived signed URL for the finalised report, and the
// invoice total and status.
//
// WHAT IT MUST NEVER RETURN: technician notes, the audit trail, photographs,
// other jobs at that address, the org id, internal ids beyond the ones needed
// to render, or anything at all belonging to another client. If a field is
// not in the response literal below, it does not go out.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = (url.searchParams.get('t') || '').trim();
  // Checked for shape before it is ever used in a query. Tokens are 64 hex
  // characters; anything else is not a token that was ever issued.
  if (!/^[a-f0-9]{64}$/i.test(token)) return json(REFUSAL, 404);

  const now = Date.now();

  const { data: access, error: accessError } = await admin
    .from('client_access')
    .select('token, job_id, expires_at, revoked_at, view_count')
    .eq('token', token)
    .maybeSingle();

  if (accessError) {
    console.error('[client-portal]', accessError);
    return json({ error: 'unavailable', message: 'Something went wrong. Try again shortly.' }, 500);
  }
  if (!access) return json(REFUSAL, 404);
  if (access.revoked_at) return json(REFUSAL, 404);
  if (!access.expires_at || access.expires_at < now) return json(REFUSAL, 404);

  // Keyed on the token's own job. There is no path here where a job id comes
  // from the request.
  const { data: job, error: jobError } = await admin
    .from('jobs')
    // Named columns, not *. A select * here would ship technician notes and
    // every column added to this table in future straight to the client.
    .select('id, name, address, job_type, inspection_date, inspection_ended_at, next_due_at, scheduled_at')
    .eq('id', access.job_id)
    .maybeSingle();

  if (jobError || !job) {
    console.error('[client-portal] job missing for a live token', access.job_id);
    return json(REFUSAL, 404);
  }

  // The finalised report, for its date and its document type only. `sections`
  // is deliberately NOT selected: it holds the technician's findings, the
  // photographs and the audit trail, and none of that goes out as data — the
  // client gets the PDF that was signed, not the raw record behind it.
  const { data: report } = await admin
    .from('reports')
    .select('job_id, document_type, finalized_at')
    .eq('job_id', access.job_id)
    .maybeSingle();

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
    expiresAt: access.expires_at,
  });
});
