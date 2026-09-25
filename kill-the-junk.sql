-- Kill the test junk, permanently.
--
-- Run this ONCE, in the Supabase SQL editor, AFTER migration 018 has been run.
--
-- The previous attempt deleted all 312 jobs and 64 came straight back, pushed
-- up by a device still holding a copy from a test run five weeks earlier. A
-- plain DELETE cannot win that fight: to every other device the rows simply
-- went missing from the server, which reads as "not uploaded yet".
--
-- So this writes a tombstone for every row BEFORE deleting it. A tombstone is
-- the app saying the absence was deliberate. Any device that syncs afterwards
-- reads them, deletes its own copies, and — since v67 — deletes the row from
-- the server again if some older client managed to push it back first.
--
-- Everything is already backed up to scope-backup-before-wipe-2026-09-24.json.

begin;

-- 1. Tombstone everything, children included. The jobs table cascades
--    server-side, but every other device holds its own copies of the reports,
--    photos and invoices and would otherwise push them back as orphans.
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

-- 2. Now delete. Reports, captures, footage and invoices cascade off jobs.
delete from public.jobs;

commit;

-- 3. Check it. jobs should be 0, and tombstones should equal what was removed.
select
  (select count(*) from public.jobs)      as jobs_left,
  (select count(*) from public.reports)   as reports_left,
  (select count(*) from public.captures)  as captures_left,
  (select count(*) from public.deletions) as tombstones;
