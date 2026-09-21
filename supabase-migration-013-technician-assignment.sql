-- Migration 013 — which technician a job belongs to
--
-- WHY
-- Every job has always been readable and writable by any signed-in
-- technician (the "team can read/write" policies throughout this schema),
-- which was the right call for a solo operator — there was only ever one
-- person to assign anything to. The moment a second technician is added,
-- nothing distinguishes whose job is whose: the scheduler and job list have
-- no way to show "these are mine" versus "these are the whole team's".
--
-- This does NOT change who can see or edit what — every technician still
-- has full read/write access to every job, same as always. It only adds
-- the one piece of data needed to filter and label the existing shared
-- view: who a job is currently assigned to.
--
-- Run once against the live project. Additive and idempotent.

alter table public.jobs
  add column if not exists assigned_to text default '';

comment on column public.jobs.assigned_to is
  'Email of the technician this job is currently assigned to. Set to '
  'whoever creates the job (see db.js addJob), reassignable afterwards. '
  'Empty string, not null, for an unassigned job — matches every other '
  'text field on this table.';
