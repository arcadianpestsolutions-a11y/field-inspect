-- Field Inspect — migration 004: photo / video / audio backup
--
-- THE PROBLEM THIS SOLVES
-- Until now nothing shot with the camera ever left the phone. sync.js pushed
-- only `jobs` and `reports`, and stripped report photo arrays down to a
-- {__localPhotoCount} placeholder before upload; the `captures` and `footage`
-- stores were never synced at all. A lost, stolen or wiped phone destroyed
-- every piece of photographic evidence held for that job — against the
-- three-year record retention required by AS 3660.2 and by the NSW Pesticides
-- Regulation 2017, and against the photographic record a professional
-- indemnity claim is actually defended with.
--
-- Run once against the live project (SQL Editor → New query → paste → Run).
-- Additive and idempotent — safe to re-run.
--
-- Adds:
--   storage bucket `inspection-media` — the actual image/video/audio bytes.
--   public.captures  — site photo / voice memo metadata (bytes in storage).
--   public.footage   — inspection video + imported footage metadata.
-- Report-section photos keep living inside public.reports.sections, but now
-- store {id, path} pointing into the bucket instead of a placeholder.

-- ---------- Storage bucket ----------
-- Private (public = false): media is only ever reachable through an
-- authenticated client or a signed URL, never a guessable public link.
-- Real client property photos should not be world-readable.
insert into storage.buckets (id, name, public)
values ('inspection-media', 'inspection-media', false)
on conflict (id) do nothing;

-- Same shared-team model as the existing tables: any signed-in technician can
-- read and write any job's media; anonymous requests get nothing.
drop policy if exists "team can read media" on storage.objects;
create policy "team can read media" on storage.objects
  for select to authenticated using (bucket_id = 'inspection-media');

drop policy if exists "team can upload media" on storage.objects;
create policy "team can upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'inspection-media');

drop policy if exists "team can update media" on storage.objects;
create policy "team can update media" on storage.objects
  for update to authenticated using (bucket_id = 'inspection-media');

drop policy if exists "team can delete media" on storage.objects;
create policy "team can delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'inspection-media');

-- ---------- Capture metadata ----------
create table if not exists public.captures (
  id text primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  zone text default '',
  type text default 'photo',          -- 'photo' | 'memo'
  note text default '',
  suggested_zone text default '',
  photo_path text,                    -- object path inside inspection-media
  audio_path text,
  created_at bigint not null,
  updated_at bigint not null,
  created_by uuid references auth.users(id)
);

create index if not exists captures_job_id_idx on public.captures(job_id);

-- ---------- Footage metadata ----------
create table if not exists public.footage (
  id text primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  zone text default '',
  source text default 'live',         -- 'live' | 'imported'
  kind text default 'video',          -- 'video' | 'photo'
  file_name text default '',
  note text default '',
  blob_path text,                     -- object path inside inspection-media
  created_at bigint not null,
  updated_at bigint not null,
  created_by uuid references auth.users(id)
);

create index if not exists footage_job_id_idx on public.footage(job_id);

alter table public.captures enable row level security;
alter table public.footage  enable row level security;

-- Mirrors the existing "team can ..." policies on jobs/reports.
drop policy if exists "team can read captures" on public.captures;
create policy "team can read captures" on public.captures
  for select to authenticated using (true);
drop policy if exists "team can write captures" on public.captures;
create policy "team can write captures" on public.captures
  for all to authenticated using (true) with check (true);

drop policy if exists "team can read footage" on public.footage;
create policy "team can read footage" on public.footage
  for select to authenticated using (true);
drop policy if exists "team can write footage" on public.footage;
create policy "team can write footage" on public.footage
  for all to authenticated using (true) with check (true);
