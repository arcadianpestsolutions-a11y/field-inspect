-- Field Inspect — migration 005: recurring inspections
--
-- Annual termite re-inspections (and pest treatment follow-ups) are the
-- recurring revenue in this business, and tracking them was the single
-- largest reason to keep paying for Formitize. Finalizing a report now
-- computes when the property is next due and stores it on the job, so the
-- job list can surface what's falling due instead of it living in someone's
-- memory or a paper diary.
--
-- Run once against the live project. Additive and idempotent.
--
--   next_due_at        — epoch ms the property is next due for attention.
--                        Derived on finalize from the report's recommended
--                        re-inspection interval (termite) or follow-up date
--                        (pest treatment).
--   recurring_from_id  — the job this one was raised from, so a property's
--                        inspection history can be walked backwards.

alter table public.jobs
  add column if not exists next_due_at bigint,
  add column if not exists recurring_from_id text;

create index if not exists jobs_next_due_at_idx on public.jobs(next_due_at);
