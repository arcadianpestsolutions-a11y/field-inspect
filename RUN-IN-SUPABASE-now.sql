-- ============================================================================
-- RUN THIS ONE FILE. Paste the whole thing into the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query) and press Run. Once.
--
-- It is migration 018 and kill-the-junk joined into a single paste, because
-- the junk cannot be killed permanently until the deletions table exists and
-- getting that order wrong is the whole failure mode.
--
-- Note there is deliberately no BEGIN/COMMIT. A multi-statement script in the
-- SQL editor already runs as ONE transaction, so either all of this lands or
-- none of it does. Adding BEGIN here only produces a "transaction already in
-- progress" warning.
--
-- Everything is already backed up to scope-backup-before-wipe-2026-09-24.json.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PART 1 — migration 018: tombstones, so a delete survives a second device.
--
-- sync.js pushes any local record the cloud does not have. That rule cannot
-- tell "this was deleted" from "the cloud has not seen this yet" — both are
-- simply absent from the server. So every delete was undone by the next
-- device to sync. A tombstone supplies the missing half: the absence was
-- deliberate.
--
-- Additive and idempotent. Safe if it has somehow already been run.
-- ---------------------------------------------------------------------------

create table if not exists public.deletions (
  table_name text not null,
  record_id  text not null,
  deleted_at bigint not null,
  deleted_by uuid,
  primary key (table_name, record_id)
);

comment on table public.deletions is
  'One row per deleted record. Read by sync.js on pull to remove local '
  'copies, and to stop the push-back branch re-uploading something that was '
  'deliberately deleted elsewhere.';

-- Pulled on every sync, filtered by time, so this is the index that matters.
create index if not exists deletions_deleted_at_idx on public.deletions(deleted_at);

alter table public.deletions enable row level security;

-- Same shared-team model as every other table here: any signed-in technician
-- may see and record a deletion. Restricting this would be worse than
-- pointless — a tombstone a device cannot read is a row it will resurrect.
drop policy if exists "team can read deletions" on public.deletions;
create policy "team can read deletions" on public.deletions
  for select to authenticated using (true);

drop policy if exists "team can write deletions" on public.deletions;
create policy "team can write deletions" on public.deletions
  for all to authenticated using (true) with check (true);

-- Explicit, because RLS is not the only thing standing in the way: a missing
-- GRANT shows up as 42501 "permission denied", which reads like a policy
-- problem and is not. This project has already lost time to exactly that.
grant select, insert, update, delete on public.deletions to authenticated;
grant select, insert, update, delete on public.deletions to service_role;


-- ---------------------------------------------------------------------------
-- PART 2 — kill the test junk, permanently.
--
-- The previous attempt deleted all 312 jobs and 64 came straight back, pushed
-- up by a device still holding a copy from a test run five weeks earlier. A
-- plain DELETE cannot win that fight.
--
-- So: tombstone every row BEFORE deleting it. Any device that syncs afterwards
-- reads the tombstones, deletes its own copies, and — since v67 — deletes the
-- row from the server again if some older client pushed it back first.
-- ---------------------------------------------------------------------------

-- Tombstone everything, children included. jobs cascades server-side, but
-- every other device holds its own copies of the reports, photos and invoices
-- and would otherwise push them back as orphans.
insert into public.deletions (table_name, record_id, deleted_at)
select 'jobs', id, (extract(epoch from now()) * 1000)::bigint from public.jobs
on conflict (table_name, record_id) do nothing;

insert into public.deletions (table_name, record_id, deleted_at)
select 'reports', job_id, (extract(epoch from now()) * 1000)::bigint from public.reports
on conflict (table_name, record_id) do nothing;

insert into public.deletions (table_name, record_id, deleted_at)
select 'captures', id, (extract(epoch from now()) * 1000)::bigint from public.captures
on conflict (table_name, record_id) do nothing;

insert into public.deletions (table_name, record_id, deleted_at)
select 'footage', id, (extract(epoch from now()) * 1000)::bigint from public.footage
on conflict (table_name, record_id) do nothing;

insert into public.deletions (table_name, record_id, deleted_at)
select 'invoices', id, (extract(epoch from now()) * 1000)::bigint from public.invoices
on conflict (table_name, record_id) do nothing;

-- Now delete. Reports, captures, footage and invoices cascade off jobs.
delete from public.jobs;


-- ---------------------------------------------------------------------------
-- PART 3 — the receipt. Every *_left column must read 0. The tombstone counts
-- are the record of what was removed, and are what keeps it removed.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.jobs)     as jobs_left,
  (select count(*) from public.reports)  as reports_left,
  (select count(*) from public.captures) as captures_left,
  (select count(*) from public.footage)  as footage_left,
  (select count(*) from public.invoices) as invoices_left,
  (select count(*) from public.deletions where table_name = 'jobs')    as job_tombstones,
  (select count(*) from public.deletions)                              as tombstones_total;
