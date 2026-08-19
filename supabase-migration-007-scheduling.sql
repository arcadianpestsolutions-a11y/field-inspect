-- Field Inspect — migration 007: job scheduling
--
-- The app knew when a property was DUE (next_due_at, migration 005) but had
-- no idea when a job was actually BOOKED. That is the difference between a
-- reminder list and a diary, and it was the last large gap against ServiceM8.
--
-- Run once against the live project. Additive and idempotent.
--
--   scheduled_at            — epoch ms of the booked appointment start.
--                             Null means the job exists but is not booked yet,
--                             which is a real and useful state: it is the
--                             backlog the scheduler surfaces separately.
--   scheduled_duration_mins — how long to allow, so a day can be read at a
--                             glance and double-bookings are visible.

alter table public.jobs
  add column if not exists scheduled_at bigint,
  add column if not exists scheduled_duration_mins integer;

create index if not exists jobs_scheduled_at_idx on public.jobs(scheduled_at);
