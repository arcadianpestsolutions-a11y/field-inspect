// Automated client messages — booking confirmation, day-before reminder, and
// "your report is ready". One function for all of them, because they share
// every part that matters: who may trigger a send, who is allowed to receive
// one, and what has to be true before anything leaves.
//
// THE CENTRAL DESIGN DECISION: THE CALLER NEVER NAMES THE RECIPIENT.
// A caller sends a job id. This function reads client_email from that row
// itself. That is the whole reason the request shape looks the way it does,
// and it is not negotiable — the moment an address is an input, any bug,
// stale build, or tampered request can point a client's name, address and
// service history at somewhere it should never go. Compare send-report-email,
// which takes recipientEmail directly: that is acceptable only because a
// technician is looking at the screen and typed it. Nobody is watching these.
//
// OPT-OUT IS CHECKED HERE, NOT IN THE APP.
// jobs.comms_opt_out suppresses every automated send, transactional ones
// included. A client who says "stop emailing me" means all of it, and a rule
// with an exception list is a rule somebody gets wrong later. Manual sends by
// a technician still work; this only governs what happens with no human in
// the loop.
//
// AUSTRALIAN SPAM ACT 2003.
// Two categories, treated differently on purpose:
//   - booking_confirmation, day_before, report_ready are TRANSACTIONAL. The
//     client booked a service; telling them when it is happening is not a
//     commercial message. Sender identification is included anyway, because
//     an email that does not say plainly who sent it is a bad email.
//   - due_reminder is COMMERCIAL. It solicits a booking. It carries full
//     sender identification and a functional unsubscribe: a List-Unsubscribe
//     header and a visible line, both pointing at a mailto. A mailto is a
//     valid unsubscribe facility and needs no public endpoint, which matters
//     because a public endpoint is another thing to secure and keep running.
//
// Required secrets:
//   RESEND_API_KEY, RESEND_FROM_ADDRESS   (already set for send-report-email)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Optional, and worth setting — these appear in the sender identification
// block. Left unset, the block still names the business and the reply address,
// it just carries less detail. Nothing here is invented at runtime:
//   BUSINESS_NAME, BUSINESS_ABN, BUSINESS_PHONE, BUSINESS_ADDRESS,
//   BUSINESS_REPLY_TO

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BUSINESS_NAME = Deno.env.get('BUSINESS_NAME') || 'Arcadian Pest Solutions';
const BUSINESS_ABN = Deno.env.get('BUSINESS_ABN') || '';
const BUSINESS_PHONE = Deno.env.get('BUSINESS_PHONE') || '';
const BUSINESS_ADDRESS = Deno.env.get('BUSINESS_ADDRESS') || '';
const REPLY_TO = Deno.env.get('BUSINESS_REPLY_TO') || '';

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TRANSACTIONAL = new Set(['booking_confirmation', 'day_before', 'report_ready']);
const COMMERCIAL = new Set(['due_reminder']);
const ALL_KINDS = new Set([...TRANSACTIONAL, ...COMMERCIAL]);

// ---------------------------------------------------------------- text ---

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function whenText(epochMs: number | null): string {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney',
  });
}

function dateText(epochMs: number | null): string {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney',
  });
}

// Sender identification. Required on a commercial message and included on
// every message regardless, so a client always knows who is writing and how
// to reach a human. Only states what has actually been configured.
function senderBlock(): string {
  const bits = [esc(BUSINESS_NAME)];
  if (BUSINESS_ABN) bits.push(`ABN ${esc(BUSINESS_ABN)}`);
  if (BUSINESS_ADDRESS) bits.push(esc(BUSINESS_ADDRESS));
  if (BUSINESS_PHONE) bits.push(esc(BUSINESS_PHONE));
  return `<hr style="border:none;border-top:1px solid #d8dde0;margin:26px 0 12px">
    <p style="font-size:12px;color:#6b767e;line-height:1.5;margin:0">
      ${bits.join(' &middot; ')}
    </p>`;
}

function unsubscribeBlock(unsubMailto: string): string {
  return `<p style="font-size:12px;color:#6b767e;line-height:1.5;margin:8px 0 0">
      Don't want reminders like this? <a href="${esc(unsubMailto)}"
      style="color:#6b767e">Unsubscribe</a> and we'll stop sending them.
    </p>`;
}

type JobRow = {
  id: string;
  name: string | null;
  address: string | null;
  client_email: string | null;
  scheduled_at: number | null;
  next_due_at: number | null;
  job_type: string | null;
  comms_opt_out: boolean | null;
};

function serviceLabel(jobType: string | null): string {
  return jobType === 'pest_treatment' ? 'pest treatment' : 'termite inspection';
}

function compose(kind: string, job: JobRow): { subject: string; body: string } {
  const greeting = job.name ? `Hi ${esc(job.name)},` : 'Hi,';
  const where = job.address ? ` at ${esc(job.address)}` : '';
  const service = serviceLabel(job.job_type);

  switch (kind) {
    case 'booking_confirmation':
      return {
        subject: `Your ${service} is booked — ${BUSINESS_NAME}`,
        body: `<p>${greeting}</p>
          <p>Your ${service}${where} is booked for
          <strong>${esc(whenText(job.scheduled_at))}</strong>.</p>
          <p>Someone needs to be home to let us in, and it helps if we can get
          to the meter box, the subfloor access and under the sinks.</p>
          <p>If that time no longer suits, reply to this email or give us a call
          and we'll move it.</p>`,
      };

    case 'day_before':
      return {
        subject: `Reminder: we're coming tomorrow — ${BUSINESS_NAME}`,
        body: `<p>${greeting}</p>
          <p>Just a reminder that we're booked for your ${service}${where}
          <strong>tomorrow, ${esc(whenText(job.scheduled_at))}</strong>.</p>
          <p>Please make sure we can get to the meter box, the subfloor access
          and under the sinks, and that any pets are secured.</p>
          <p>If something has come up, reply to this email or call us.</p>`,
      };

    case 'report_ready':
      return {
        subject: `Your ${service} report — ${BUSINESS_NAME}`,
        body: `<p>${greeting}</p>
          <p>Your ${service} report${where} is finished and attached to a
          separate email from us.</p>
          <p>If anything in it isn't clear, reply and we'll talk you through it.</p>`,
      };

    case 'due_reminder':
      return {
        subject: `Your ${service} is coming up — ${BUSINESS_NAME}`,
        body: `<p>${greeting}</p>
          <p>Your next ${service}${where} is due around
          <strong>${esc(dateText(job.next_due_at))}</strong>.</p>
          <p>Staying on schedule is what keeps a termite warranty valid, and it
          catches activity while it's still cheap to deal with. Reply to this
          email or give us a call and we'll find a time.</p>`,
      };

    default:
      throw new Error(`Unknown message kind: ${kind}`);
  }
}

// --------------------------------------------------------------- guards ---

// Dedupe is per-kind and keyed on what the message is ABOUT, not on when it
// was sent. A rescheduled job has a different scheduled_at, so it correctly
// earns a fresh confirmation; a technician saving the same job twice does not.
function alreadySentColumn(kind: string): string | null {
  if (kind === 'booking_confirmation') return 'confirmation_sent_for_at';
  if (kind === 'day_before') return 'day_before_sent_for_at';
  if (kind === 'due_reminder') return 'reminder_sent_for_due_at';
  return null; // report_ready is sent once per finalize, guarded by the caller
}

function subjectValue(kind: string, job: JobRow): number | null {
  if (kind === 'due_reminder') return job.next_due_at;
  return job.scheduled_at;
}

// Returns a reason string when the job must NOT be emailed, or null when it may.
function refuse(kind: string, job: JobRow): string | null {
  if (!job) return 'job-not-found';
  if (job.comms_opt_out) return 'opted-out';

  const to = (job.client_email || '').trim();
  if (!to) return 'no-email-on-file';
  if (!EMAIL_PATTERN.test(to)) return 'email-not-valid';

  const col = alreadySentColumn(kind);
  if (col) {
    const about = subjectValue(kind, job);
    if (about == null) return 'nothing-to-send-about';
    if ((job as unknown as Record<string, unknown>)[col] === about) return 'already-sent';
  }
  return null;
}

async function sendOne(kind: string, job: JobRow, triggeredBy: string | null) {
  const to = (job.client_email || '').trim();
  const { subject, body } = compose(kind, job);

  const unsubMailto = `mailto:${REPLY_TO || RESEND_FROM_ADDRESS.replace(/.*<|>.*/g, '')}`
    + `?subject=${encodeURIComponent('Unsubscribe')}`;

  const isCommercial = COMMERCIAL.has(kind);
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;
      font-size:15px;line-height:1.6;color:#10161a;max-width:560px">
      ${body}
      <p>Kind regards,<br>${esc(BUSINESS_NAME)}</p>
      ${senderBlock()}
      ${isCommercial ? unsubscribeBlock(unsubMailto) : ''}
    </div>`;

  const payload: Record<string, unknown> = {
    from: RESEND_FROM_ADDRESS,
    to: [to],
    subject,
    html,
  };
  if (REPLY_TO) payload.reply_to = REPLY_TO;
  // A real List-Unsubscribe header is what mail clients surface as a
  // one-click unsubscribe, and it is the difference between complying and
  // looking like you comply.
  if (isCommercial) payload.headers = { 'List-Unsubscribe': `<${unsubMailto}>` };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend API error (${res.status}): ${await res.text()}`);
  const result = await res.json();

  // Mark sent only after a confirmed send. An interrupted run should retry
  // this job next time, not skip it forever believing it was done.
  const col = alreadySentColumn(kind);
  if (col) {
    await admin.from('jobs').update({ [col]: subjectValue(kind, job) }).eq('id', job.id);
  }

  await admin.from('client_messages').insert({
    id: crypto.randomUUID(),
    job_id: job.id,
    kind,
    recipient: to,
    subject,
    sent_at: Date.now(),
    provider_id: result.id || null,
    status: 'sent',
    triggered_by: triggeredBy,
  });

  return { jobId: job.id, kind, sent: true, providerId: result.id || null };
}

const JOB_COLUMNS = 'id, name, address, client_email, scheduled_at, next_due_at, '
  + 'job_type, comms_opt_out, confirmation_sent_for_at, day_before_sent_for_at, '
  + 'reminder_sent_for_due_at';

// ----------------------------------------------------------------- serve ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    // Two legitimate callers, and they authenticate differently. A technician's
    // app carries a user session. A schedule has no user to be, so it presents
    // the service-role key, which only something server-side can hold.
    const authHeader = req.headers.get('Authorization') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isScheduled = bearer.length > 0 && bearer === SERVICE_ROLE_KEY;

    let triggeredBy: string | null = null;
    if (!isScheduled) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) return json({ error: 'Not authenticated' }, 401);
      triggeredBy = user.id;
    }

    const body = await req.json().catch(() => ({}));

    // ---- sweep mode: find everything due for a given kind and send it ----
    // Defaults to a dry run. Turning a sweep loose on a real client list
    // should be something you did on purpose, having first read what it
    // would do.
    if (body.sweep) {
      const kind = String(body.sweep);
      if (!ALL_KINDS.has(kind)) return json({ error: `Unknown kind: ${kind}` }, 400);
      const dryRun = body.dryRun !== false;

      const now = Date.now();
      const windowStart = now + 20 * 60 * 60 * 1000; // ~20h out
      const windowEnd = now + 32 * 60 * 60 * 1000;   // ~32h out

      let query = admin.from('jobs').select(JOB_COLUMNS).eq('comms_opt_out', false);
      if (kind === 'day_before') {
        query = query.gte('scheduled_at', windowStart).lte('scheduled_at', windowEnd);
      } else if (kind === 'due_reminder') {
        query = query.not('next_due_at', 'is', null);
      } else {
        return json({ error: `${kind} is not a sweepable kind` }, 400);
      }

      const { data, error } = await query;
      if (error) return json({ error: error.message }, 500);

      const jobs = (data || []) as JobRow[];
      const sendable = jobs.filter((j) => refuse(kind, j) === null);

      if (dryRun) {
        return json({
          sweep: kind,
          dryRun: true,
          checked: jobs.length,
          wouldSend: sendable.map((j) => ({
            jobId: j.id, name: j.name, to: j.client_email,
            when: whenText(subjectValue(kind, j)),
          })),
        });
      }

      const results = [];
      for (const j of sendable) {
        try {
          results.push(await sendOne(kind, j, triggeredBy));
        } catch (err) {
          console.error(`[send-client-message] ${kind} ${j.id}:`, err);
          results.push({ jobId: j.id, kind, sent: false, error: String(err) });
        }
      }
      return json({ sweep: kind, dryRun: false, checked: jobs.length, results });
    }

    // ---- single mode: one job, one message ----
    const kind = String(body.kind || '');
    const jobId = String(body.jobId || '');
    if (!ALL_KINDS.has(kind)) return json({ error: `Unknown kind: ${kind}` }, 400);
    if (!jobId) return json({ error: 'jobId is required' }, 400);

    const { data, error } = await admin
      .from('jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
    if (error) return json({ error: error.message }, 500);

    const job = data as JobRow | null;
    if (!job) return json({ error: 'job-not-found', sent: false }, 404);

    // A refusal is a normal outcome, not a failure. The app shows these to a
    // technician as plain sentences, so they stay machine-readable here.
    const reason = refuse(kind, job);
    if (reason) return json({ sent: false, reason });

    return json(await sendOne(kind, job, triggeredBy));
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// TO SCHEDULE THE DAY-BEFORE REMINDER, once this is deployed:
//
//   1. Call it once with { "sweep": "day_before" } and nothing else. dryRun
//      defaults to true, so this only reports who it WOULD email.
//   2. Read that list. If it is right, call again with
//      { "sweep": "day_before", "dryRun": false }.
//   3. Only then set a daily schedule: Supabase dashboard → Edge Functions →
//      send-client-message → Cron. Once a day is enough; the 20-to-32-hour
//      window means a run at any hour still catches tomorrow's jobs, and the
//      dedupe stamp means an accidental second run that day sends nothing.
// ---------------------------------------------------------------------------
