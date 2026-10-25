-- 038: copies of client files in SharePoint (sharepoint-files Edge Function)
--
-- Every finalised report, invoice and job photo is also copied into the
-- business's own SharePoint site ("Arcadian Clients"), one folder per client.
-- Two reasons: Tal can find a client's paperwork in Microsoft 365 without
-- opening Scope, and Supabase Storage keeps NO backups of photos on any plan
-- (see reference_supabase_backups) - SharePoint is the second copy.
--
-- This table is the memory of what has been copied, so a file is copied once
-- (and again only when it changes - an amended report), and so a client keeps
-- the folder it was first given even if their name is edited later.
--
-- WHO WRITES IT: only the Edge Function (service_role), after Microsoft has
-- confirmed the upload. The app reads it to show "in SharePoint".
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.sharepoint_files (
  id              text primary key,
  job_id          text references public.jobs(id) on delete set null,
  client_id       text,
  -- What was copied: a storage path, or 'invoice:<id>'.
  source          text not null,
  -- Changes when the source does (a report finalised again), so the copy is
  -- refreshed rather than skipped.
  source_version  text not null default '',
  folder          text not null default '',
  sp_path         text not null default '',
  sp_item_id      text not null default '',
  web_url         text not null default '',
  bytes           bigint,
  uploaded_at     bigint not null,
  org_id          uuid references public.organisations(id) on delete cascade
);

create unique index if not exists sharepoint_files_source_idx on public.sharepoint_files(org_id, source);
create index if not exists sharepoint_files_job_idx on public.sharepoint_files(job_id);
create index if not exists sharepoint_files_client_idx on public.sharepoint_files(org_id, client_id);

alter table public.sharepoint_files enable row level security;

drop policy if exists "org can read sharepoint files" on public.sharepoint_files;
create policy "org can read sharepoint files" on public.sharepoint_files
  for select using (org_id = public.my_org_id());

-- Granted explicitly: RLS decides which rows, the grant decides whether the
-- role may touch the table at all.
grant select on public.sharepoint_files to authenticated;
revoke insert, update, delete, truncate on public.sharepoint_files from authenticated;
revoke all on public.sharepoint_files from anon;
grant select, insert, update on public.sharepoint_files to service_role;
revoke delete, truncate on public.sharepoint_files from service_role;

comment on table public.sharepoint_files is
  'What has been copied to the business''s SharePoint site, so nothing is copied twice and each client keeps one folder. Written only by the sharepoint-files Edge Function. See supabase-migration-038.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'sharepoint_files'
  and grantee in ('authenticated', 'service_role', 'anon')
group by table_name, grantee
order by grantee;
