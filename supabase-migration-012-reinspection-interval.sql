-- Migration 012 — remember which re-inspection cycle a due date came from
--
-- WHY
-- jobs.next_due_at has existed since migration 005, but only as a bare
-- timestamp — nothing recorded whether it came from a 3, 6, or 12-month
-- termite re-inspection cycle, or a pest-treatment follow-up date. The
-- planned reminder-email policy (send-due-reminders) only applies to a
-- standard 12-month termite cycle — a 3-month cycle exists specifically
-- because a technician judged a property higher-risk, and a bare due-date
-- timestamp gives no way to tell that apart from a 6-month cycle two visits
-- in. This column is what makes that distinction possible.
--
-- Run once against the live project. Additive and idempotent.

alter table public.jobs
  add column if not exists reinspection_interval_months integer;

comment on column public.jobs.reinspection_interval_months is
  'The re-inspection interval (3, 6, or 12) that produced next_due_at, set '
  'at report finalization. NULL for pest-treatment follow-ups and any job '
  'with no due date. Lets send-due-reminders apply its 9-month-email / '
  '12-month-call-flag rule only to genuine 12-month termite cycles.';
