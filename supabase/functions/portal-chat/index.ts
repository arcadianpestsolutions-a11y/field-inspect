// The client page assistant: answers a client's question on their own report
// page, and passes on what a person has to do.
//
// Every decision is in _shared/portal-chat.js, which the browser suite runs a
// whole conversation through. This file reads rows, calls the model, and
// writes two kinds of row. Nothing else.
//
// A SEPARATE FUNCTION FROM client-portal ON PURPOSE. client-portal serves
// finalised compliance documents to clients today; a change to the assistant
// must never be able to take that page down with it. If this function is
// missing, broken or switched off, the client page simply shows no chat.
//
// DELIBERATELY NOT BEHIND SUPABASE AUTH (supabase/config.toml): the person
// asking has no account. The token in their link is the credential, and it is
// checked exactly as client-portal checks it.
//
// IT RUNS ON service_role, SO ROW-LEVEL SECURITY IS NOT PROTECTING ANYTHING.
// Every query is keyed on the token's own job. No id ever comes from the
// request body, and the model never chooses which job a row lands on.
//
// OFF UNLESS organisations.portal_assistant_enabled IS TRUE. A business that
// has not switched it on answers GET with { enabled: false } and refuses POST.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import { businessFrom } from '../_shared/business.js';
import { quoteFrom } from '../_shared/acceptance.js';
import { needsAgreement, agreementSignedOnSite } from '../_shared/agreement.js';
import {
  BUSY_REPLY, CHAT_MODEL, FALLBACK_REPLY, LIMIT_REPLY, LIMITS, PROMPT_VERSION, runChat,
} from '../_shared/portal-chat.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const BUSINESS_ENV = {
  BUSINESS_NAME: Deno.env.get('BUSINESS_NAME') || '',
  BUSINESS_PHONE: Deno.env.get('BUSINESS_PHONE') || '',
  BUSINESS_REPLY_TO: Deno.env.get('BUSINESS_REPLY_TO') || '',
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type Row = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
  });
}

// The same sentence client-portal gives for every dead link, for the same
// reason: a reply that tells expired from made-up confirms which tokens exist.
const REFUSAL = { error: 'not-available', message: 'This link is no longer available. Ask us for a new one.' };
const OFF = { enabled: false };
const DAY_MS = 24 * 60 * 60 * 1000;

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

type Gate = { fail?: Response; job: Row; access: Row; org: Row | null };

async function gate(req: Request): Promise<Gate> {
  const empty = { job: {}, access: {}, org: null };
  const token = (new URL(req.url).searchParams.get('t') || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return { fail: json(REFUSAL, 404), ...empty };

  const { data: access, error } = await admin
    .from('client_access')
    .select('job_id, expires_at, revoked_at, acceptance_requested_at, agreement_requested_at')
    .eq('token', token)
    .maybeSingle();
  if (error) {
    console.error('[portal-chat] access', error.message);
    return { fail: json({ error: 'unavailable' }, 500), ...empty };
  }
  if (!access || access.revoked_at || !access.expires_at || access.expires_at < Date.now()) {
    return { fail: json(REFUSAL, 404), ...empty };
  }

  // Named columns, never *. org_id and client_id are read to file rows in the
  // right business and never go back out.
  const { data: job } = await admin
    .from('jobs')
    .select('id, name, address, job_type, preferred_document_type, inspection_date, inspection_ended_at, next_due_at, scheduled_at, org_id')
    .eq('id', access.job_id)
    .maybeSingle();
  if (!job) return { fail: json(REFUSAL, 404), ...empty };

  // A missing column (migration 037 not run yet) is an error here, and an
  // error means off. The assistant is never on by accident.
  const { data: org, error: orgError } = await admin
    .from('organisations')
    .select('name, trading_name, phone, email, portal_assistant_enabled, portal_assistant_notes')
    .eq('id', job.org_id)
    .maybeSingle();
  if (orgError) console.warn('[portal-chat] organisation (is migration 037 run?)', orgError.message);

  return { job: job as Row, access: access as Row, org: orgError ? null : (org as Row | null) };
}

const enabled = (org: Row | null) => !!(org && org.portal_assistant_enabled === true && ANTHROPIC_API_KEY);

async function recentMessages(jobId: string) {
  const { data } = await admin
    .from('portal_messages')
    .select('role, body, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(LIMITS.historyMessages);
  return (data || []).reverse().map((m: Row) => ({ role: m.role, body: m.body, at: m.created_at }));
}

async function countSince(table: string, filter: Record<string, string>, since: number) {
  let q = admin.from(table).select('id', { count: 'exact', head: true }).gte('created_at', since);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count, error } = await q;
  // A count that fails is treated as the limit reached: the cost of a wrong
  // "please call us" is small, the cost of an unmetered model bill is not.
  if (error) { console.error('[portal-chat] count', table, error.message); return Number.MAX_SAFE_INTEGER; }
  return count || 0;
}

// What the page already shows its holder, put into the shape factsFor() reads.
async function contextFor(g: Gate) {
  const { job, access, org } = g;
  const biz = businessFrom(org, BUSINESS_ENV);
  const { data: report } = await admin
    .from('reports')
    .select('document_type, finalized_at, sections')
    .eq('job_id', job.id)
    .maybeSingle();

  const { data: invoices } = await admin
    .from('invoices')
    .select('number, status, xero_status, due_date, line_items, gst_registered')
    .eq('job_id', job.id);
  const inv = (invoices || []).filter((i: Row) => i.status !== 'draft')[0];
  let invoice = null;
  if (inv) {
    let cents = 0;
    for (const line of (inv.line_items as Row[]) || []) {
      const sub = Math.round((Number(line.quantity) || 0) * (Number(line.unitAmountCents) || 0));
      cents += sub + (inv.gst_registered !== false ? Math.round(sub * 0.1) : 0);
    }
    invoice = { number: inv.number, totalCents: cents, paid: String(inv.xero_status || '').toUpperCase() === 'PAID', dueDate: inv.due_date };
  }

  let quote = null;
  if (access.acceptance_requested_at && report && report.finalized_at) {
    const q = quoteFrom(report.sections);
    const { data: acc } = await admin.from('client_acceptances').select('id')
      .eq('job_id', job.id).eq('kind', 'quote').is('superseded_at', null).maybeSingle();
    quote = { amount: q ? q.amount : '', accepted: !!acc };
  }

  let agreementWaiting = false;
  if (access.agreement_requested_at && !(report && report.finalized_at)) {
    const doc = (report && report.document_type) || job.preferred_document_type || '';
    if (needsAgreement(job.job_type, doc) && !agreementSignedOnSite(report ? report.sections : null)) {
      const { data: ag } = await admin.from('client_acceptances').select('id')
        .eq('job_id', job.id).eq('kind', 'agreement').is('superseded_at', null).maybeSingle();
      agreementWaiting = !ag;
    }
  }

  return {
    business: { name: biz.name, phone: biz.phone, email: biz.email },
    notes: (org && org.portal_assistant_notes) || '',
    client: { name: job.name || '', address: job.address || '' },
    visit: {
      jobType: job.job_type === 'pest_treatment' ? 'pest_treatment' : 'termite',
      date: job.inspection_date || null,
      completedAt: job.inspection_ended_at || null,
      nextDueAt: job.next_due_at || null,
      scheduledAt: job.scheduled_at || null,
    },
    report: report && report.finalized_at ? { documentType: report.document_type, finalizedAt: report.finalized_at } : null,
    invoice,
    quote,
    agreementWaiting,
  };
}

async function callModel({ system, tools, toolChoice, messages }: Row) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CHAT_MODEL, max_tokens: 600, system, tools, tool_choice: toolChoice, messages }),
  });
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

async function insertRequest(job: Row, value: Row) {
  const now = Date.now();
  const { error } = await admin.from('portal_requests').insert({
    id: newId('pr'),
    job_id: job.id,
    kind: value.kind,
    summary: value.summary || '',
    details: value.details || '',
    preferred_time: value.preferredTime || '',
    contact: value.contact || '',
    referred: value.referred || null,
    status: 'open',
    created_at: now,
    updated_at: now,
    org_id: job.org_id,
  });
  if (error) throw new Error(`could not record request: ${error.message}`);
}

async function insertMessage(job: Row, role: 'client' | 'assistant', body: string, model = '') {
  const { error } = await admin.from('portal_messages').insert({
    id: newId('pm'),
    job_id: job.id,
    role,
    body,
    model: role === 'assistant' ? model : '',
    prompt_version: role === 'assistant' ? PROMPT_VERSION : '',
    created_at: Date.now(),
    org_id: job.org_id,
  });
  if (error) console.error('[portal-chat] could not store message', error.message);
}

async function handleGet(req: Request) {
  const g = await gate(req);
  if (g.fail) return g.fail;
  if (!enabled(g.org)) return json(OFF);
  const biz = businessFrom(g.org, BUSINESS_ENV);
  return json({
    enabled: true,
    business: { name: biz.name, phone: biz.phone },
    messages: await recentMessages(g.job.id),
    maxChars: LIMITS.messageChars,
  });
}

async function handlePost(req: Request) {
  const g = await gate(req);
  if (g.fail) return g.fail;
  if (!enabled(g.org)) return json(OFF, 409);
  const { job } = g;

  let body: Row = {};
  try { body = (await req.json()) as Row; } catch { /* handled below */ }
  const message = String((body && body.message) || '').replace(/\u0000/g, '').trim().slice(0, LIMITS.messageChars);
  if (!message) return json({ error: 'empty', message: 'Type a message first.' }, 400);

  const since = Date.now() - DAY_MS;
  if (await countSince('portal_messages', { job_id: job.id, role: 'client' }, since) >= LIMITS.clientPerDay) {
    return json({ reply: LIMIT_REPLY, logged: [], limited: true });
  }
  if (await countSince('portal_messages', { org_id: job.org_id, role: 'client' }, since) >= LIMITS.orgPerDay) {
    return json({ reply: BUSY_REPLY, logged: [], limited: true });
  }

  const history = await recentMessages(job.id);
  await insertMessage(job, 'client', message);

  const counts = {
    requests: await countSince('portal_requests', { job_id: job.id }, since),
    referrals: await countSince('portal_requests', { job_id: job.id, kind: 'referral' }, since),
  };

  let result;
  try {
    result = await runChat({
      ctx: await contextFor(g),
      history,
      message,
      callModel,
      counts,
      actions: {
        request: (v: Row) => insertRequest(job, v),
        referral: (v: Row) => insertRequest(job, {
          kind: 'referral',
          summary: `Referred ${v.name}`,
          details: v.notes,
          referred: { name: v.name, phone: v.phone, email: v.email, address: v.address, notes: v.notes },
        }),
      },
    });
  } catch (err) {
    // The client's message is never lost: it is kept above, and a request is
    // raised so a person sees it even though nothing answered.
    console.error('[portal-chat] assistant failed', err instanceof Error ? err.message : err);
    await insertRequest(job, { kind: 'unanswered', summary: message.slice(0, 200), details: message }).catch(() => {});
    await insertMessage(job, 'assistant', FALLBACK_REPLY, '');
    return json({ reply: FALLBACK_REPLY, logged: [{ kind: 'unanswered', summary: 'Passed to the team' }] });
  }

  await insertMessage(job, 'assistant', result.reply, result.model);
  return json({ reply: result.reply, logged: result.logged });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    if (req.method === 'GET') return await handleGet(req);
    if (req.method === 'POST') return await handlePost(req);
  } catch (err) {
    console.error('[portal-chat]', err instanceof Error ? err.message : err);
    return json({ error: 'unavailable', message: 'Something went wrong. Please try again shortly.' }, 500);
  }
  return json({ error: 'bad-request' }, 405);
});
