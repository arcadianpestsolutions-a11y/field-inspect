-- Migration 011 — recurring inspection reminder emails
--
-- WHY
-- A termite job's next re-inspection date (next_due_at) has been tracked
-- since migration 005 — but nothing ever told the CLIENT it was coming up.
-- It became a line in the technician's own scheduler backlog, tracked by
-- the business remembering to look, which is exactly the repeat-revenue
-- gap Formitize-style tools close and this one hadn't.
--
-- This adds the one column needed to send that reminder safely: a record
-- of which due date a reminder was already sent for, so the function that
-- sends them (send-due-reminders) can run on a schedule without ever
-- emailing the same client twice for the same due date.
--
-- Run once against the live project. Additive and idempotent.

alter table public.jobs
  add column if not exists reminder_sent_for_due_at bigint;

comment on column public.jobs.reminder_sent_for_due_at is
  'The next_due_at value a reminder email was already sent for. Compared '
  'against the job''s current next_due_at before sending another — if they '
  'match, a reminder already went out for this due date and send-due-'
  'reminders skips it. NULL means no reminder has ever been sent.';

-- service_role reads and updates jobs from the Edge Function, which has no
-- Supabase session at all (see migration 009''s note on why this needs to
-- be explicit rather than assumed).
grant select, update on public.jobs to service_role;
