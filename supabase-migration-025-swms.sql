-- 025: Safe Work Method Statements
--
-- Its own table, and the reason is worth stating once here because it is the
-- whole design decision. public.reports is keyed by job_id, so a job holds
-- exactly one report — an inspection, an action plan, a certificate or a
-- monitoring visit, which really are alternatives to each other. A SWMS is
-- not an alternative to an inspection: it accompanies one, a builder wants it
-- before anybody turns up, and a statement written once for subfloor work is
-- reused across a season. None of that fits a table keyed by job.
--
-- So job_id here is a nullable reference, not the key.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.swms (
  id            text primary key,
  -- Nullable: a standing statement for an activity belongs to no single job.
  -- ON DELETE SET NULL rather than CASCADE — deleting a job must not destroy
  -- the safety document that was in force when the work was done.
  job_id        text references public.jobs(id) on delete set null,
  title         text not null default 'Safe Work Method Statement',
  site_address  text not null default '',
  sections      jsonb not null default '{}'::jsonb,
  signed_at     bigint,
  review_due_at bigint,
  schema_version integer,
  created_by    uuid,
  created_at    bigint not null,
  updated_at    bigint not null,
  org_id        uuid references public.organisations(id) on delete cascade
);

-- The database stamps the owner, not the app. Same rule as every other table
-- since migration 023: org_id is never something a client gets to choose, so
-- a row can only ever be written into the caller's own organisation.
alter table public.swms alter column org_id set default public.my_org_id();

-- Backfill, for anything created before this column had a default. Only
-- meaningful if a single organisation exists; with more than one it is left
-- alone deliberately, because guessing which business owns a safety document
-- is exactly the wrong thing to do.
do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.swms set org_id = first_org where org_id is null;
  end if;
end $$;

create index if not exists swms_org_idx     on public.swms(org_id);
create index if not exists swms_job_idx     on public.swms(job_id);
create index if not exists swms_updated_idx on public.swms(updated_at);

alter table public.swms enable row level security;

-- Dropped before created, every name, every time. This project has lost a
-- round trip to 42710 "policy already exists" twice now — migration 016 and
-- again in 023 — both times because a rename left the old drop behind.
drop policy if exists "team can read swms"     on public.swms;
drop policy if exists "team can write swms"    on public.swms;
drop policy if exists "org can read swms"      on public.swms;
drop policy if exists "org can write swms"     on public.swms;

create policy "org can read swms" on public.swms
  for select using (org_id = public.my_org_id());

create policy "org can write swms" on public.swms
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- Granted explicitly. RLS decides WHICH rows; a grant decides whether the
-- role may touch the table at all, and forgetting it is what produced the
-- 42501 "permission denied" on captures, footage and invoices that took a
-- morning to find.
grant select, insert, update, delete on public.swms to authenticated;

comment on table public.swms is
  'Safe Work Method Statements. Separate from reports because a job holds one '
  'report but may need a safety statement alongside it, and because a statement '
  'written once for an activity is reused across many jobs.';
comment on column public.swms.job_id is
  'Nullable. Null means a standing statement for an activity rather than one '
  'written for a single job.';

-- ---------------------------------------------------------------------------
-- Check it worked. Expect the table to exist, RLS on, two policies, and no
-- orphaned rows.
select
  (select count(*) from public.swms)                        as statements,
  (select count(*) from public.swms where org_id is null)   as orphaned,
  (select relrowsecurity from pg_class where relname = 'swms') as rls_enabled,
  (select count(*) from pg_policies where tablename = 'swms') as policies;
