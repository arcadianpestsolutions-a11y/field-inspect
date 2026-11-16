-- 042: wall off the two things that were shared between businesses.
--
-- Found 16 Nov 2026 while checking whether a second pest business could be
-- given a login. Every table was already scoped to the signed-in user's
-- organisation; these two were not.
--
-- 1. STORAGE. The four policies on the inspection-media bucket said only
--    "signed in", so any user of any business could read, overwrite or delete
--    any other business's photos, voice memos and report PDFs.
--    Every object is stored as <job id>/<kind>/<file>, so the wall is the
--    job: a file belongs to whoever owns the job in its first path segment.
--    A deleted job leaves a tombstone in public.deletions; reading and
--    deleting (but not uploading) is also allowed against that, so the
--    clean-up that runs after a job is deleted can still find its files.
--
-- 2. ORGANISATIONS. Anyone signed in could read every business's record, and
--    an admin of one business could edit another's. org.js also loads "the
--    first organisation" (order by created_at limit 1), which with the old
--    read policy would have shown a second business the first one's details.
--    Both policies now name the caller's own organisation.
--
-- The function is SECURITY DEFINER so it can read jobs and deletions without
-- going back through their row-level security from inside a storage policy.
-- It still answers for the CALLER: my_org_id() reads auth.uid().

create or replace function public.media_in_my_org(object_name text, include_deleted boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_org_id() is not null and (
    exists (
      select 1 from public.jobs j
      where j.id = split_part(object_name, '/', 1) and j.org_id = public.my_org_id()
    )
    or (include_deleted and exists (
      select 1 from public.deletions d
      where d.table_name = 'jobs' and d.record_id = split_part(object_name, '/', 1)
        and d.org_id = public.my_org_id()
    ))
  );
$$;

revoke execute on function public.media_in_my_org(text, boolean) from public, anon;
grant execute on function public.media_in_my_org(text, boolean) to authenticated;

drop policy if exists "team can read media" on storage.objects;
drop policy if exists "team can upload media" on storage.objects;
drop policy if exists "team can update media" on storage.objects;
drop policy if exists "team can delete media" on storage.objects;

create policy "team can read media" on storage.objects for select to authenticated
  using (bucket_id = 'inspection-media' and public.media_in_my_org(name, true));

create policy "team can upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspection-media' and public.media_in_my_org(name, false));

create policy "team can update media" on storage.objects for update to authenticated
  using (bucket_id = 'inspection-media' and public.media_in_my_org(name, false))
  with check (bucket_id = 'inspection-media' and public.media_in_my_org(name, false));

create policy "team can delete media" on storage.objects for delete to authenticated
  using (bucket_id = 'inspection-media' and public.media_in_my_org(name, true));

drop policy if exists "signed in can read organisations" on public.organisations;
drop policy if exists "admin can write organisations" on public.organisations;

create policy "members can read their organisation" on public.organisations for select to authenticated
  using (id = public.my_org_id());

create policy "admin can write their organisation" on public.organisations for all to authenticated
  using (public.is_admin() and id = public.my_org_id())
  with check (public.is_admin() and id = public.my_org_id());
