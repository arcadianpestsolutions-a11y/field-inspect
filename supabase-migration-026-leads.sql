-- 026: leads
--
-- A lead is somebody who asked, and is not yet a job. Separate from
-- public.jobs on purpose: a job is work that exists and a lead is work that
-- might, and putting maybes in the diary is how a diary stops being trusted.
-- A won lead becomes a job and keeps converted_job_id pointing at it, so the
-- enquiry is not lost the moment it turns into real work.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.leads (
  id                text primary key,
  name              text not null default '',
  phone             text not null default '',
  email             text not null default '',
  address           text not null default '',
  address_lat       double precision,
  address_lng       double precision,
  job_type          text not null default 'termite',
  -- Which advertisement, referral or sign this came from. The only way to
  -- decide whether to keep paying for any of them.
  source            text not null default '',
  notes             text not null default '',
  stage             text not null default 'new',
  -- Separate from created_at so "how long has it sat in THIS stage" is
  -- answerable. A lead that arrived last month but was quoted yesterday is
  -- not stale, and a follow-up clock that cannot tell the difference chases
  -- the wrong people.
  stage_changed_at  bigint,
  last_contacted_at bigint,
  last_follow_up_at bigint,
  follow_up_count   integer not null default 0,
  snoozed_until     bigint,
  quoted_cents      bigint,
  lost_reason       text not null default '',
  -- ON DELETE SET NULL, not CASCADE. Deleting a job must not erase the
  -- record of where the work came from.
  converted_job_id  text references public.jobs(id) on delete set null,
  created_by        uuid,
  created_at        bigint not null,
  updated_at        bigint not null,
  org_id            uuid references public.organisations(id) on delete cascade
);

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add  constraint leads_stage_check
  check (stage in ('new', 'contacted', 'quoted', 'won', 'lost'));

-- The database stamps the owner, not the app. Same rule as every other table
-- since migration 023.
alter table public.leads alter column org_id set default public.my_org_id();

do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.leads set org_id = first_org where org_id is null;
  end if;
end $$;

create index if not exists leads_org_idx     on public.leads(org_id);
create index if not exists leads_stage_idx   on public.leads(org_id, stage);
create index if not exists leads_updated_idx on public.leads(updated_at);

alter table public.leads enable row level security;

-- Dropped before created, every name, every time. 42710 "policy already
-- exists" has cost this project a round trip twice — migration 016 and 023.
drop policy if exists "team can read leads"  on public.leads;
drop policy if exists "team can write leads" on public.leads;
drop policy if exists "org can read leads"   on public.leads;
drop policy if exists "org can write leads"  on public.leads;

create policy "org can read leads" on public.leads
  for select using (org_id = public.my_org_id());

create policy "org can write leads" on public.leads
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- Granted explicitly. RLS decides WHICH rows; a grant decides whether the
-- role may touch the table at all, and forgetting it is what produced the
-- 42501 on captures, footage and invoices that took a morning to find.
grant select, insert, update, delete on public.leads to authenticated;

comment on table public.leads is
  'Enquiries that are not yet jobs. A won lead points at the job it became.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  stage,
  count(*)                               as leads,
  count(*) filter (where org_id is null) as orphaned
from public.leads
group by stage;
