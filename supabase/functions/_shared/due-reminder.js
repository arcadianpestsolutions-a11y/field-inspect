// When an annual re-inspection reminder is due, and when it is not.
//
// Shared between the send-client-message Edge Function (which runs under Deno)
// and the browser test suite, same arrangement as _shared/reminder-sms.js and
// _shared/acceptance.js. These rules decide whether a real email goes to a
// real client unprompted, so they are worth a test, and a rule that only
// exists inside a Deno handler cannot have one.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL.
//
// There were two functions doing this job. send-due-reminders had the timing
// rules and no org filter — any signed-in technician could make it read and
// email every business's client list. send-client-message had the org filter,
// the opt-out check and the send log, and NO timing rules: its due_reminder
// sweep selected every job with a due date set and would have emailed a client
// whose inspection is eleven months away.
//
// Each had the half the other was missing. The timing rules moved here, into
// the function that was already scoped correctly, and send-due-reminders was
// retired rather than fixed — two functions that email the same clients is a
// standing invitation to fix a rule in one of them.

// Three months before the due date: the "remind at 9 months of a 12-month
// cycle" rule, phrased as a countdown FROM the due date rather than a count-up
// from the inspection, because the due date is what is actually stored
// (next_due_at) and what everything else is computed from.
export const MONTHS_BEFORE_DUE = 3;

// Only a standard annual cycle. A 3- or 6-month interval exists because a
// technician judged a specific property higher-risk, and a fixed
// "remind 3 months early" rule grafted onto a 3-month cycle would fire before
// the previous visit had finished being written up.
export const ANNUAL_INTERVAL_MONTHS = 12;

// Real calendar-month arithmetic, not a fixed day count, because the due date
// itself is computed in calendar months (see computeNextDueAt in report.js).
// "90 days before" drifts against it as soon as months of different lengths
// are involved.
//
// setMonth alone overflows: three months before 31 May is 31 February, which
// becomes 3 March. Clamped to the last day of the target month instead, which
// is what a person means by it.
export function monthsBefore(epochMs, months) {
  const d = new Date(epochMs);
  const targetMonth = d.getMonth() - months;
  const clamped = new Date(d.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(
    d.getFullYear(), targetMonth, Math.min(d.getDate(), clamped),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  ).getTime();
}

// Returns a reason the reminder must NOT go out, or null when it may.
//
// Reasons are codes rather than sentences because they are shown back in the
// dry run next to a job, and whoever reads that list is deciding who to ring.
export function dueReminderTiming(job, now) {
  const due = job && job.next_due_at;
  if (due == null) return 'no-due-date';

  // A null interval is an older job from before migration 012 added the
  // column. Treated as not-annual rather than assumed annual: guessing wrong
  // here sends an unsolicited email about a cycle nobody chose.
  const months = job.reinspection_interval_months;
  if (months !== ANNUAL_INTERVAL_MONTHS) return 'not-an-annual-cycle';

  if (now < monthsBefore(due, MONTHS_BEFORE_DUE)) return 'too-early';
  return null;
}

// Already reminded for this exact due date, and the date has now passed with
// nothing rebooked. Nothing further is emailed — chasing somebody who ignored
// the reminder is a phone call, not a second email — so these are reported so
// a person can work through them.
//
// Rebooking clears next_due_at (see rebookJob in app.js), so a job that has
// been rebooked drops out of here on the next run without anything to undo.
export function needsAPhoneCall(job, now) {
  if (!job || job.next_due_at == null) return false;
  if (job.reminder_sent_for_due_at !== job.next_due_at) return false;
  return now >= job.next_due_at;
}
