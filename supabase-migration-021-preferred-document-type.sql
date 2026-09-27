-- Migration 021 — which document a job was booked to produce
--
-- WHY
-- Termite work is several different documents off one job type. An
-- inspection and a monitoring station visit are both jobType 'termite', so
-- the job type alone cannot say which report should open.
--
-- New Job now asks — Termite Inspection, Monitoring Station Visit, or
-- General Pest Treatment — and this is where that answer lives, so a job
-- booked as a monitoring visit opens a monitoring report instead of making
-- somebody pick it a second time on the job screen.
--
-- A preference, not a lock. The document picker on the job screen still
-- changes it, because a property can carry an inspection this year and a
-- monitoring visit the next without needing a new job.
--
-- Run once against the live project. Additive and idempotent.

alter table public.jobs
  add column if not exists preferred_document_type text default '';

comment on column public.jobs.preferred_document_type is
  'Document type chosen at New Job, e.g. timber_pest_inspection or '
  'termite_monitoring. Sets which report opens by default; the job screen '
  'can still override it.';

select count(*) as jobs_with_column
from information_schema.columns
where table_schema = 'public' and table_name = 'jobs'
  and column_name = 'preferred_document_type';
