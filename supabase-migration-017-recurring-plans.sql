-- Migration 017 — standing service plans
--
-- WHY
-- A property came back only if a report was finalized: that is what set
-- next_due_at, which is what put the job in the backlog, which is what
-- someone had to notice and rebook. Every one of those steps had to happen,
-- in order, for a client to be seen again. Miss the paperwork on one visit
-- and the property left the schedule permanently, with nothing anywhere
-- showing that it had. At twenty clients that gets noticed. At two hundred
-- it does not.
--
-- recurrence_months says the property is on a standing plan regardless of
-- paperwork. The app raises the next visit when a planned job completes, and
-- sweeps for any series that stopped (see DB.catchUpRecurringPlans), so a
-- plan repairs itself rather than needing the one right moment to have gone
-- perfectly months ago.
--
-- Deliberately separate from reinspection_interval_months (migration 012),
-- which records what a REPORT recommended. That is a finding about the
-- property; this is a commitment about the schedule. Finalizing a report
-- adopts its interval as a plan when there is not one already, so existing
-- behaviour upgrades on its own without changing anything for a job that
-- already has one.
--
-- Run once against the live project. Additive and idempotent.

alter table public.jobs
  add column if not exists recurrence_months integer;

comment on column public.jobs.recurrence_months is
  'Standing plan: revisit this property every N months. Null means no plan '
  '— the job comes back only if somebody rebooks it. Distinct from '
  'reinspection_interval_months, which is what a report recommended rather '
  'than what the business has committed to.';
