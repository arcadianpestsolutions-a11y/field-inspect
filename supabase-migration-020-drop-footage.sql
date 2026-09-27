-- Migration 020 — drop the footage table
--
-- WHY
-- The app records no video. The camera is a viewfinder for taking
-- photographs and nothing else, Import Footage is gone, and nothing anywhere
-- writes a footage row any more. As of DB v6 the local store is deleted on
-- upgrade too.
--
-- Left in place, this table would be a trap rather than a spare part: the
-- next person to read the schema would reasonably assume video is still a
-- thing the app does, and the sync layer would look incomplete for not
-- touching it.
--
-- BEFORE YOU RUN THIS. It is a DROP, and unlike everything else in this
-- folder it is not reversible by re-running something. Check what is in
-- there first:
--
--   select count(*) from public.footage;
--
-- If that comes back 0, nothing is lost. If it does not, the rows point at
-- files in the inspection-media storage bucket, and both the rows and those
-- files are about to stop being reachable from the app whatever you do —
-- deciding to keep them means downloading them somewhere else first, not
-- leaving this table behind.
--
-- Run once against the live project.

-- Tombstone anything still there before it goes, so a device that is offline
-- today and syncs next week deletes its own copy instead of pushing it back
-- into a table that no longer exists.
insert into public.deletions (table_name, record_id, deleted_at)
select 'footage', id, (extract(epoch from now()) * 1000)::bigint from public.footage
on conflict (table_name, record_id) do nothing;

drop table if exists public.footage;

-- What is left. footage_rows should error as "relation does not exist",
-- which is the point.
select
  (select count(*) from public.deletions where table_name = 'footage') as footage_tombstones,
  (select count(*) from public.captures) as captures_kept;
