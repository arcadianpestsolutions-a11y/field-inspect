// Two-stage recurring-inspection follow-up, for a standard 12-month termite
// cycle specifically (see WHY below) — NOT a generic "repeat this job"
// scheduler. Nothing here fires on its own; it only ever acts on a due date
// a technician already set by choosing a re-inspection interval when they
// finalized the PREVIOUS report.
//
//   Stage 1, at 9 months (3 months before the 12-month due date): email the
//   client that their re-inspection is coming up. Marks reminder_sent_for_
//   due_at so the same due date is never emailed twice.
//
//   Stage 2, once the due date itself has passed with no rebooking: nothing
//   is emailed again. These jobs are reported back under `needsCall` so a
//   human decides whether and how to chase — the actual flag a technician
//   sees lives in the scheduler's own backlog (see scheduler.js), which
//   already shows overdue jobs and now marks the ones that already got the
//   email and still weren't rebooked distinctly from ones that are simply
//   overdue and haven't been reminded yet.
//
// WHY 12-MONTH ONLY. A 3- or 6-month interval exists because a technician
// judged a specific property higher-risk — a fixed 9-month/12-month rule
// makes no sense grafted onto a 3-month cycle. reinspection_interval_months
// (migration 012) is what makes telling these apart possible; a bare
// next_due_at timestamp alone cannot.
//
// NOT WIRED TO RUN AUTOMATICALLY. This function exists and works, but no
// schedule calls it yet — see the deploy note at the bottom of this file.
// It emails real clients on the business's behalf with no human reading
// each one first, which is a different category of risk to a technician
// tapping "send this report" for one job they're looking at right now.
// Before turning on a schedule:
//   1. Deploy this function and call it once with dryRun: true (the
//      default) to see exactly who it WOULD email and what it would say,
//      with nothing actually sent.
//   2. Read that output. Adjust EMAIL_SUBJECT/emailHtml below if the
//      wording isn't right for the business.
//   3. Only then call it with dryRun: false, or set up a schedule (Supabase
//      dashboard → Edge Functions → this function → Cron) to call it daily.
//
// DELIBERATELY NOT PUBLIC. Unlike calendar-feed, this one changes state
// (marks reminders sent) and sends real email — it stays behind the same
// signed-in-technician auth as every other function except calendar-feed,
// so only someone logged into this business's own account can trigger it.
//
// Required secrets (already set for send-report-email):
//   RESEND_API_KEY, RESEND_FROM_ADDRESS
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

// service_role: this reads and updates every client's job regardless of who
// is logged in, and a scheduled run has no per-user session to scope to.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// How many months before the 12-month due date the email goes out — 3
// months = the "at 9 months" rule, phrased as a countdown from the due date
// rather than a count-up from the inspection, since the due date is what's
// actually stored (next_due_at) and what everything else is computed from.
const EMAIL_MONTHS_BEFORE_DUE = 3;
const EMAIL_SUBJECT = 'Your termite inspection is coming up — Arcadian Pest Solutions';

// Real month arithmetic (setMonth), not a fixed day count — consistent with
// how report.js's computeNextDueAt derives the due date itself. A fixed
// "90 days before" would drift against a due date computed in calendar
// months once months of different lengths are involved.
function monthsBefore(epochMs: number, months: number): number {
  const d = new Date(epochMs);
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

function emailHtml(clientName: string, dueDate: string) {
  return `
    <p>Hi${clientName ? ' ' + clientName : ''},</p>
    <p>Your annual termite re-inspection is due around <strong>${dueDate}</strong>.</p>
    <p>Regular re-inspection is what keeps your termite warranty valid and catches
    activity early, before it becomes expensive. Reply to this email or give us a
    call to book a time that suits.</p>
    <p>Kind regards,<br>Arcadian Pest Solutions</p>
  `;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    // Same gate as every function except calendar-feed: a valid signed-in
    // technician, checked against the anon-key client with the caller's own
    // bearer token — the service_role client above never sees that token,
    // it only exists to do the actual read/write once the caller is verified.
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default TRUE — see the note at the top of this file

    const now = Date.now();

    // jobs has no separate client_name column — job.name is what a
    // technician actually types for who/what the job is (see db.js's
    // addJob), so it's what stands in for a greeting name here.
    // reinspection_interval_months = 12 is the actual gate this whole
    // policy is scoped to — see the WHY note at the top of this file.
    const { data: jobs, error: jobsError } = await admin
      .from('jobs')
      .select('id, name, client_email, next_due_at, reminder_sent_for_due_at, reinspection_interval_months')
      .eq('reinspection_interval_months', 12)
      .not('next_due_at', 'is', null)
      .not('client_email', 'is', null);

    if (jobsError) {
      console.error(jobsError);
      return json({ error: 'Could not read jobs.' }, 500);
    }

    const allJobs = jobs || [];

    // Stage 1: due date is within the 3-month email window and hasn't
    // already been reminded for this exact due date.
    const candidates = allJobs.filter((j) => {
      if (!j.client_email || !j.client_email.trim()) return false;
      if (j.reminder_sent_for_due_at === j.next_due_at) return false;
      return now >= monthsBefore(j.next_due_at as number, EMAIL_MONTHS_BEFORE_DUE);
    });

    // Stage 2: already reminded for this due date, and the due date itself
    // has now passed with no rebooking (rebooking clears next_due_at — see
    // rebookJob in app.js — so a job that's been rebooked simply drops out
    // of this query entirely on the next run). Nothing is sent here; this
    // is reporting only, for visibility into who the scheduler's backlog
    // should be flagging.
    const needsCall = allJobs.filter((j) => (
      j.reminder_sent_for_due_at === j.next_due_at && now >= (j.next_due_at as number)
    ));

    const results: unknown[] = [];

    for (const job of candidates) {
      const dueDate = new Date(job.next_due_at as number).toLocaleDateString('en-AU', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      const recipient = (job.client_email as string).trim();
      const name = (job.name as string) || '';

      if (dryRun) {
        results.push({ jobId: job.id, wouldEmail: recipient, dueDate, sent: false });
        continue;
      }

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: RESEND_FROM_ADDRESS,
            to: [recipient],
            subject: EMAIL_SUBJECT,
            html: emailHtml(name, dueDate),
          }),
        });
        if (!res.ok) throw new Error(`Resend API error (${res.status}): ${await res.text()}`);

        // Mark sent only after a confirmed successful send — if this
        // function is interrupted or the send fails, the next run should
        // still try this job again, not silently skip it forever.
        await admin.from('jobs').update({ reminder_sent_for_due_at: job.next_due_at }).eq('id', job.id);
        results.push({ jobId: job.id, emailed: recipient, dueDate, sent: true });
      } catch (err) {
        console.error(`[send-due-reminders] job ${job.id}:`, err);
        results.push({ jobId: job.id, emailed: recipient, dueDate, sent: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return json({
      dryRun,
      checked: allJobs.length,
      candidates: candidates.length,
      results,
      needsCall: needsCall.map((j) => ({ jobId: j.id, name: j.name, dueDate: j.next_due_at })),
    });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
