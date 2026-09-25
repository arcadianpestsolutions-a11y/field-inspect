-- Migration 018 — tombstones, so a delete survives a second device
--
-- WHY
-- sync.js pushes any local record the cloud does not have:
--
--   for (const lj of localJobs) {
--     const remote = remoteJobsById.get(lj.id);
--     if (!remote || ...) await pushJob(lj);
--   }
--
-- That rule cannot tell "this was deleted" from "the cloud has not seen this
-- yet". Both are simply absent from the server. So every delete was undone by
-- the next device to sync: a job deleted on the phone came back from the
-- laptop, and 64 rows from a test run five weeks ago reappeared minutes after
-- the whole table was cleared.
--
-- A tombstone supplies the missing half of the information — the absence was
-- deliberate. On pull, a device applies any tombstone it has not seen and
-- deletes its local copy. On push, it skips anything tombstoned instead of
-- resurrecting it.
--
-- NOT pruned on a schedule. Rows are tiny, and pruning too early recreates
-- the exact bug: a device offline for longer than the retention window comes
-- back and re-uploads everything it still holds.
--
-- Run once against the live project. Additive and idempotent.

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
