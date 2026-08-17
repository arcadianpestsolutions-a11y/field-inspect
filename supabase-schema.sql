-- Field Inspect — Supabase schema & security setup
--
-- This file documents the CURRENT full schema. If you're setting up a brand
-- new Supabase project, run this whole file once (SQL Editor → New query →
-- paste → Run). If you already ran an earlier version of this file against
-- a live project, do NOT re-run this one — the `create policy` statements
-- below aren't idempotent and will error on tables that already have them.
-- Use the incremental migration file instead (e.g. supabase-migration-002-ai-features.sql).
--
-- This creates the two tables the app syncs (jobs, reports) and locks them
-- down with Row Level Security so only signed-in team members can read or
-- write anything — anonymous/public requests are blocked entirely, even
-- though the app's API key is publicly visible in its source code.

create table if not exists public.jobs (
  id text primary key,
  name text not null,
  address text default '',
  address_lat double precision,
  address_lng double precision,
  notes text default '',
  client_phone text default '',
  client_email text default '',
  status text default 'new',
  inspection_date text,
  inspection_time text,
  weather text default '',
  inspection_started_at bigint,
  inspection_ended_at bigint,
  created_by uuid references auth.users(id),
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.reports (
  job_id text primary key references public.jobs(id) on delete cascade,
  sections jsonb not null default '{}'::jsonb,
  ai_draft jsonb,
  finalized_at bigint,
  updated_by uuid references auth.users(id),
  updated_at bigint not null
);

alter table public.jobs enable row level security;
alter table public.reports enable row level security;

-- Any signed-in team member can read/write any job or report — this is a
-- shared team database, not per-technician siloed data, so everyone on the
-- team sees the same jobs. Only signed-out/anonymous requests are blocked.
create policy "team can read jobs" on public.jobs
  for select to authenticated using (true);
create policy "team can insert jobs" on public.jobs
  for insert to authenticated with check (true);
create policy "team can update jobs" on public.jobs
  for update to authenticated using (true) with check (true);
create policy "team can delete jobs" on public.jobs
  for delete to authenticated using (true);

create policy "team can read reports" on public.reports
  for select to authenticated using (true);
create policy "team can insert reports" on public.reports
  for insert to authenticated with check (true);
create policy "team can update reports" on public.reports
  for update to authenticated using (true) with check (true);
create policy "team can delete reports" on public.reports
  for delete to authenticated using (true);
