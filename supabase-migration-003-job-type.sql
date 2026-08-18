-- Field Inspect — migration 003: General Pest Treatment report type
--
-- Run this once against the EXISTING live project (SQL Editor → New query →
-- paste → Run). Additive only — safe to run even if the column already
-- exists, and doesn't touch RLS policies (the existing "team can
-- read/insert/update/delete" policies already cover this new column since
-- they're not column-scoped).
--
-- Adds:
--   public.jobs.job_type  — 'termite' (AS 3660.2 inspection, the default —
--     every job synced before this migration existing implicitly as this
--     type) or 'pest_treatment' (general pest treatment / chemical
--     application). Picked once at job creation and never changed
--     afterwards, so no backfill of existing rows is needed beyond the
--     column default.

alter table public.jobs
  add column if not exists job_type text not null default 'termite';
