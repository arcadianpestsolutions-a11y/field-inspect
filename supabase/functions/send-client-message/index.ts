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
// THE DAY-BEFORE REMINDER GOES BY SMS.
// An email reminder competes with everything else in an inbox on the one
// evening it has to be read. A text does not. So once a texting account is
// configured this kind switches channel; until then it keeps going by email,
// which makes turning it on a switch rather than a cutover. The wording is
// split five ways by what the visit actually is — an inspection needs the
// roof void and subfloor, a station round needs the side gate and nobody
// home, a spray needs the benches clear — because instructions that do not
// match the visit get ignored, and then the van arrives to no access.
// See _shared/reminder-sms.js; the suite covers the wording.
//
// Required secrets:
//   RESEND_API_KEY, RESEND_FROM_ADDRESS   (already set for send-report-email)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Required only for SMS. Absent, day_before quietly stays on email:
//   CLICKSEND_USERNAME, CLICKSEND_API_KEY
// Optional, for SMS:
//   SMS_SENDER_ID      up to 11 characters, shown as the sender (ArcadianPst)
//   BUSINESS_SMS_NAME  the name inside the message (Arcadian Pest)
// Optional, and worth setting — these appear in the sender identification
// block. Left unset, the block still names the business and the reply address,
// it just carries less detail. Nothing here is invented at runtime:
//   BUSINESS_NAME, BUSINESS_ABN, BUSINESS_PHONE, BUSINESS_ADDRESS,
//   BUSINESS_REPLY_TO

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Shared with tests/run-tests.js, which dynamic-imports this same file in a
// browser. The wording a client reads and the rule for what counts as a
// textable number are covered by the suite rather than living only here,
// where nothing on this machine can run them.
import { composeReminder } from '../_shared/reminder-sms.js';

// Read as "string or empty", never with a non-null assertion. The assertion
// does not check anything at runtime — it only stops the compiler asking — so
// a missing secret used to surface as "Cannot read properties of undefined
// (reading 'replace')" from somewhere deep in the send, which tells whoever
// is reading it nothing at all. missingSecrets() below turns the same
// situation into a sentence naming the variable to set.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const RESEND_FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// SMS. Deliberately NOT in missingSecrets() — every other kind of message
// still works without these, and a business that has not set up a texting
// account should get its day-before reminders refused with a sentence saying
// so, not have the whole function refuse to start.
const CLICKSEND_USERNAME = Deno.env.get('CLICKSEND_USERNAME') || '';
const CLICKSEND_API_KEY = Deno.env.get('CLICKSEND_API_KEY') || '';
// What shows up as the sender. Australian carriers allow an alphanumeric
// sender ID of up to 11 characters, which is why a full business name does
// not fit. A client who cannot tell who texted them deletes it.
//
// EMPTY BY DEFAULT, and that is deliberate. An alphanumeric sender ID has to
// be registered with the provider before it will carry anything, and a new
// account has none — so a hardcoded default would have every message
// rejected by a service that was set up correctly, which is about the worst
// first impression a feature can make. Left unset, no `from` is sent at all
// and the provider uses a working number of its own. The message names the
// business in its first three words either way, so nothing is lost while
// this is blank.
const SMS_SENDER_ID = (Deno.env.get('SMS_SENDER_ID') || '').slice(0, 11);
// The name inside the message. Separate from BUSINESS_NAME because every
// character is paid for: "Arcadian Pest Solutions" is 23 of the 306 a
// two-part message gets, and "Arcadian Pest" says the same thing.
const BUSINESS_SMS_NAME = Deno.env.get('BUSINESS_SMS_NAME') || 'Arcadian Pest';

const SMS_CONFIGURED = !!(CLICKSEND_USERNAME && CLICKSEND_API_KEY);

function missingSecrets(): string[] {
  return Object.entries({
    RESEND_API_KEY, RESEND_FROM_ADDRESS,
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  }).filter(([, v]) => !v).map(([k]) => k);
}

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

// Pulls the bare address out of either "Name <a@b.com>" or a plain "a@b.com".
// Returns '' rather than throwing when handed nothing, because the caller
// decides what a missing address means — for a commercial message it is fatal,
// everywhere else it is simply unused.
function bareAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from || '');
  return (match ? match[1] : (from || '')).trim();
}

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
  client_phone: string | null;
  scheduled_at: number | null;
  next_due_at: number | null;
  job_type: string | null;
  // Which of the five things Arcadian turns up to do this is. It decides the
  // access instructions in the reminder, which are different for an
  // inspection, a spray, a station round and a treatment.
  preferred_document_type: string | null;
  recurring_from_id: string | null;
  comms_opt_out: boolean | null;
  org_id: string | null;
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
// The day-before reminder goes out as a text once a texting account is set
// up, because that is what gets read the evening before a visit. Until those
// secrets exist it keeps going by email exactly as it did, so setting this up
// is a switch that gets thrown rather than a feature that has to land all at
// once. Nothing else ever goes by SMS: a report is an attachment, and a
// booking confirmation is sent while the technician is standing there.
function isSmsKind(kind: string): boolean {
  return kind === 'day_before' && SMS_CONFIGURED;
}

function refuse(kind: string, job: JobRow): string | null {
  if (!job) return 'job-not-found';
  if (job.comms_opt_out) return 'opted-out';

  if (isSmsKind(kind)) {
    // A mobile, not an email address, is what has to be on file. The refusal
    // reason distinguishes a landline from a typo, because they mean
    // different things to whoever works through the list afterwards: one is
    // fixable, the other is a client who will always need a phone call.
    const composed = composeReminder({ businessName: BUSINESS_SMS_NAME, job });
    if (!composed.sendable) return composed.reason as string;
  } else {
    const to = (job.client_email || '').trim();
    if (!to) return 'no-email-on-file';
    if (!EMAIL_PATTERN.test(to)) return 'email-not-valid';
  }

  const col = alreadySentColumn(kind);
  if (col) {
    const about = subjectValue(kind, job);
    if (about == null) return 'nothing-to-send-about';
    if ((job as unknown as Record<string, unknown>)[col] === about) return 'already-sent';
  }
  return null;
}

// Marking the job and recording the message, shared by both channels so the
// two can never drift.
//
// org_id is set from the job explicitly. It used to be left to the column
// default, which is public.my_org_id() — and that reads auth.uid(), which is
// null on the service_role key this function runs under. So every row this
// function has ever written landed with a null org_id and belonged to nobody,
// which is exactly the orphan count migration 023 tells you to go and check.
async function markSentAndLog(
  kind: string,
  job: JobRow,
  triggeredBy: string | null,
  entry: { channel: string; recipient: string; subject?: string | null; segments?: number | null; providerId?: string | null },
) {
  // The job is marked BEFORE the row is written. If the insert fails, the
  // worst case is a message that is not in the log, which is a reporting gap.
  // The other order risks sending the same reminder again tomorrow, which the
  // client experiences directly.
  const col = alreadySentColumn(kind);
  if (col) {
    await admin.from('jobs').update({ [col]: subjectValue(kind, job) }).eq('id', job.id);
  }

  await admin.from('client_messages').insert({
    id: crypto.randomUUID(),
    job_id: job.id,
    org_id: job.org_id ?? null,
    kind,
    channel: entry.channel,
    recipient: entry.recipient,
    subject: entry.subject ?? null,
    segments: entry.segments ?? null,
    sent_at: Date.now(),
    provider_id: entry.providerId ?? null,
    status: 'sent',
    triggered_by: triggeredBy,
  });
}

// A recurring program books a NEW job for each visit and links it back with
// recurring_from_id, so the last visit's report hangs off the parent rather
// than off the job being reminded about. Both are looked up, newest first —
// it is the only way to tell a rodent round from a spray, and getting it
// wrong means texting somebody spray instructions for a bait station visit.
async function lastReportFor(job: JobRow): Promise<Record<string, unknown> | null> {
  const row = job as unknown as Record<string, unknown>;
  const ids = [job.id, row.recurring_from_id].filter(Boolean) as string[];
  if (!ids.length) return null;

  const { data, error } = await admin
    .from('reports')
    .select('job_id, sections, document_type, updated_at')
    .in('job_id', ids)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    // Not fatal, on purpose. Without it the wording falls back to general
    // pest, which is wrong for a rodent round and still far better than
    // sending nothing at all.
    console.warn('[send-client-message] could not read the last report:', error.message);
    return null;
  }
  return (data && data[0]) || null;
}

async function sendSmsOne(kind: string, job: JobRow, triggeredBy: string | null) {
  const lastReport = await lastReportFor(job);
  const composed = composeReminder({ businessName: BUSINESS_SMS_NAME, job, lastReport });
  if (!composed.sendable) {
    // refuse() already asked this question. Reaching here means the row
    // changed underneath us between the check and the send.
    return { jobId: job.id, kind, sent: false, reason: composed.reason };
  }

  const message: Record<string, unknown> = {
    source: 'scope',
    to: composed.to,
    body: composed.text,
    custom_string: job.id,
  };
  // Only sent when one has actually been registered. An unregistered sender
  // ID is refused outright by the carrier, so an empty string here would be
  // worse than no field at all.
  if (SMS_SENDER_ID) message.from = SMS_SENDER_ID;

  const auth = btoa(`${CLICKSEND_USERNAME}:${CLICKSEND_API_KEY}`);
  const res = await fetch('https://rest.clicksend.com/v3/sms/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [message] }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`The SMS provider refused the message (${res.status}). `
      + String(JSON.stringify(payload)).slice(0, 300));
  }

  // ClickSend answers 200 with a per-message status inside the body, so an
  // HTTP 200 does not mean the text went anywhere. Anything but SUCCESS is a
  // failure, and treating it as a send would mark the job reminded and leave
  // the client hearing nothing.
  const envelope = payload as { data?: { messages?: Array<Record<string, unknown>> } };
  const first = (envelope.data && envelope.data.messages && envelope.data.messages[0]) || {};
  const status = String(first.status || '').toUpperCase();
  if (status !== 'SUCCESS') {
    throw new Error(`The SMS was not accepted: ${first.status || 'no status returned'} `
      + `${first.error_text || ''}`.trim());
  }

  await markSentAndLog(kind, job, triggeredBy, {
    channel: 'sms',
    recipient: composed.to as string,
    subject: null,
    segments: composed.segments,
    providerId: (first.message_id as string) || null,
  });

  return {
    jobId: job.id,
    kind,
    sent: true,
    channel: 'sms',
    visitKind: composed.visitKind,
    segments: composed.segments,
    providerId: (first.message_id as string) || null,
  };
}

// One business's sweep. org_id is a required argument rather than an optional
// filter, which is the whole point: there is no way to call this and end up
// with a query that spans businesses, however it is reached.
async function sweepOneOrg(
  kind: string,
  orgId: string,
  dryRun: boolean,
  triggeredBy: string | null,
  now: number,
) {
  const windowStart = now + 20 * 60 * 60 * 1000; // ~20h out
  const windowEnd = now + 32 * 60 * 60 * 1000;   // ~32h out

  let query = admin.from('jobs').select(JOB_COLUMNS)
    .eq('org_id', orgId)
    .eq('comms_opt_out', false);
  if (kind === 'day_before') {
    query = query.gte('scheduled_at', windowStart).lte('scheduled_at', windowEnd);
  } else {
    query = query.not('next_due_at', 'is', null);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const jobs = (data || []) as JobRow[];
  const sendable = jobs.filter((j) => refuse(kind, j) === null);
  const sms = isSmsKind(kind);

  if (dryRun) {
    const wouldSend = [];
    for (const j of sendable) {
      const row: Record<string, unknown> = {
        jobId: j.id, name: j.name,
        when: whenText(subjectValue(kind, j)),
      };
      if (sms) {
        // The exact words, the exact number, and what the carrier will bill
        // for. A message that goes to a real client is not something to find
        // out the wording of afterwards.
        const composed = composeReminder({
          businessName: BUSINESS_SMS_NAME, job: j, lastReport: await lastReportFor(j),
        });
        row.channel = 'sms';
        row.to = composed.to;
        row.visitKind = composed.visitKind;
        row.segments = composed.segments;
        row.text = composed.text;
      } else {
        row.channel = 'email';
        row.to = j.client_email;
      }
      wouldSend.push(row);
    }

    // Who is NOT getting one, and why. With a one-way reminder this is the
    // half that needs a human: a landline or a missing mobile means that
    // client hears nothing at all unless somebody rings them. 'already-sent'
    // is left out because it is not a problem, it is the dedupe working.
    const needsAPhoneCall = jobs
      .map((j) => ({ jobId: j.id, name: j.name, phone: j.client_phone || null, reason: refuse(kind, j) }))
      .filter((s) => s.reason !== null && s.reason !== 'already-sent');

    return {
      sweep: kind, dryRun: true, channel: sms ? 'sms' : 'email',
      checked: jobs.length, wouldSend, needsAPhoneCall,
    };
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
  // Even on a live run, whoever could not be reached is the actionable half.
  const needsAPhoneCall = jobs
    .map((j) => ({ jobId: j.id, name: j.name, phone: j.client_phone || null, reason: refuse(kind, j) }))
    .filter((s) => s.reason !== null && s.reason !== 'already-sent');

  return {
    sweep: kind, dryRun: false, channel: sms ? 'sms' : 'email',
    checked: jobs.length, results, needsAPhoneCall,
  };
}

async function sendOne(kind: string, job: JobRow, triggeredBy: string | null) {
  if (isSmsKind(kind)) return sendSmsOne(kind, job, triggeredBy);

  const to = (job.client_email || '').trim();
  const { subject, body } = compose(kind, job);

  const isCommercial = COMMERCIAL.has(kind);

  // Only built when it is actually needed. It used to be computed for every
  // message, so a transactional booking confirmation — which carries no
  // unsubscribe at all — still crashed on a missing from-address.
  //
  // A commercial message without a working unsubscribe is not a slightly
  // worse email, it is a breach of the Spam Act. So if one cannot be built,
  // the send is refused rather than quietly going out non-compliant.
  let unsubMailto = '';
  if (isCommercial) {
    const target = REPLY_TO || bareAddress(RESEND_FROM_ADDRESS);
    if (!target) {
      throw new Error('Refusing to send a commercial message with no unsubscribe '
        + 'address. Set BUSINESS_REPLY_TO, or a valid RESEND_FROM_ADDRESS.');
    }
    unsubMailto = `mailto:${target}?subject=${encodeURIComponent('Unsubscribe')}`;
  }
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
  await markSentAndLog(kind, job, triggeredBy, {
    channel: 'email',
    recipient: to,
    subject,
    providerId: result.id || null,
  });

  return { jobId: job.id, kind, sent: true, channel: 'email', providerId: result.id || null };
}

const JOB_COLUMNS = 'id, name, address, client_email, client_phone, scheduled_at, next_due_at, '
  + 'job_type, preferred_document_type, recurring_from_id, comms_opt_out, '
  + 'confirmation_sent_for_at, day_before_sent_for_at, reminder_sent_for_due_at, org_id';

// ----------------------------------------------------------------- serve ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Checked before anything else, so a missing secret is reported as the
  // setup problem it is rather than as a runtime error from wherever it
  // first gets used.
  const missing = missingSecrets();
  if (missing.length) {
    return json({ error: `Not configured — these secrets are not set: ${missing.join(', ')}` }, 500);
  }

  try {
    // Two legitimate callers, and they authenticate differently. A technician's
    // app carries a user session. A schedule has no user to be, so it presents
    // the service-role key, which only something server-side can hold.
    const authHeader = req.headers.get('Authorization') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isScheduled = bearer.length > 0 && bearer === SERVICE_ROLE_KEY;

    let triggeredBy: string | null = null;
    let callerOrgId: string | null = null;
    if (!isScheduled) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) return json({ error: 'Not authenticated' }, 401);
      triggeredBy = user.id;

      // Which business the caller belongs to. Everything below runs on the
      // service_role key, which bypasses row-level security — so "signed in"
      // is not the same as "allowed to see this job", and without this the
      // function would happily email another business's client on request.
      const { data: role } = await admin
        .from('user_roles').select('org_id').eq('user_id', user.id).maybeSingle();
      callerOrgId = (role && role.org_id) || null;
      if (!callerOrgId) return json({ error: 'Your account is not linked to a business yet.' }, 403);
    }

    const body = await req.json().catch(() => ({}));

    // ---- sweep mode: find everything due for a given kind and send it ----
    // Defaults to a dry run. Turning a sweep loose on a real client list
    // should be something you did on purpose, having first read what it
    // would do.
    if (body.sweep) {
      const kind = String(body.sweep);
      if (!ALL_KINDS.has(kind)) return json({ error: `Unknown kind: ${kind}` }, 400);
      if (kind !== 'day_before' && kind !== 'due_reminder') {
        return json({ error: `${kind} is not a sweepable kind` }, 400);
      }
      const dryRun = body.dryRun !== false;
      const now = Date.now();

      // A signed-in caller sweeps their own business and nothing else.
      if (callerOrgId) {
        return json(await sweepOneOrg(kind, callerOrgId, dryRun, triggeredBy, now));
      }

      // A scheduled run has no user, and therefore no business of its own.
      // This used to fall straight through to a query with no org filter at
      // all — one cron tick, every business's client list, from a single
      // request. It now does the thing a person cannot: it asks which
      // businesses exist and sweeps each one separately, so every query that
      // touches a job is scoped even though nobody is signed in.
      const { data: orgs, error: orgError } = await admin.from('organisations').select('id');
      if (orgError) return json({ error: orgError.message }, 500);
      const orgIds = (orgs || []).map((o) => (o as { id: string }).id).filter(Boolean);
      if (!orgIds.length) return json({ sweep: kind, dryRun, businesses: 0, runs: [] });

      const runs = [];
      for (const id of orgIds) {
        // One business failing is not a reason the rest go unreminded.
        try {
          runs.push({ orgId: id, ...(await sweepOneOrg(kind, id, dryRun, triggeredBy, now)) });
        } catch (err) {
          console.error(`[send-client-message] sweep ${kind} for org ${id}:`, err);
          runs.push({ orgId: id, error: String(err) });
        }
      }
      return json({ sweep: kind, dryRun, businesses: orgIds.length, runs });
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

    // Same answer as a job that does not exist, deliberately. Distinguishing
    // "not yours" from "not found" tells a caller which job ids are real in
    // other businesses, which is information they should not be able to
    // collect one request at a time.
    if (callerOrgId && job.org_id !== callerOrgId) {
      return json({ error: 'job-not-found', sent: false }, 404);
    }

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
// TO TURN ON THE DAY-BEFORE REMINDER, once this is deployed:
//
//   1. Run supabase-migration-024-sms-reminders.sql.
//   2. Set CLICKSEND_USERNAME and CLICKSEND_API_KEY in the dashboard, under
//      Edge Functions → Secrets. Until both exist the reminder keeps going
//      out by email exactly as it did, so this step is the switch.
//   3. Call it once with { "sweep": "day_before" } and nothing else. dryRun
//      defaults to true, so nothing is sent: the reply contains the exact
//      text of every message, the number it would go to, and how many parts
//      the carrier would bill for. Read it.
//   4. It also returns needsAPhoneCall — the clients who get nothing because
//      the number on file is a landline, a typo, or missing. With a one-way
//      reminder that list is the half that needs a person.
//   5. If the wording is right, call again with
//      { "sweep": "day_before", "dryRun": false }.
//   6. Only then set a daily schedule: Supabase dashboard → Edge Functions →
//      send-client-message → Cron. Mid-afternoon is the right time: late
//      enough that the day's bookings have settled, early enough that a
//      client can still ring back. Once a day is enough — the 20-to-32-hour
//      window means a run at any hour still catches tomorrow's jobs, and the
//      dedupe stamp means an accidental second run that day sends nothing.
//
// A scheduled run carries the service-role key and no user, so it has no
// business of its own. It does NOT sweep everything at once: it lists the
// businesses and sweeps each one under its own org_id. Adding a second
// business to this platform therefore changes nothing about what the cron
// does to the first one.
// ---------------------------------------------------------------------------
