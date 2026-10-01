-- 029: clients
--
-- Until now a client existed only as four fields repeated on every job:
-- name, address, phone, email. That meant retyping them each time, a client
-- who changed phone number quietly stopped matching their own history, and a
-- commercial customer with four properties was four unrelated jobs.
--
-- A CLIENT IS NOT A PROPERTY. A client is who you talk to and who pays; a
-- property is where the work happens. One client can have four properties and
-- a property can change hands. So the job keeps its address and the client
-- keeps the contact details, and neither tries to be the other.
--
-- THE JOB KEEPS ITS OWN COPY OF THE CLIENT DETAILS, ON PURPOSE.
-- jobs.client_id is a POINTER. It is NOT a replacement for jobs.name,
-- jobs.client_phone and jobs.client_email, and those columns are deliberately
-- left in place. A finalised report is a compliance document and the client
-- block printed on it is part of what was signed — if a job read those
-- details live from this new table, correcting a phone number would silently
-- rewrite the client block on every report ever issued. Edit a client here
-- and yesterday's report still says what it said yesterday.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.clients (
  id         text primary key,
  name       text not null default '',
  phone      text not null default '',
  email      text not null default '',
  -- The billing or postal address, which is NOT where the work happens.
  -- A strata manager in the city has properties all over Macarthur.
  address    text not null default '',
  notes      text not null default '',
  created_by uuid,
  created_at bigint not null,
  updated_at bigint not null,
  org_id     uuid references public.organisations(id) on delete cascade
);

-- ON DELETE SET NULL. Deleting a client must not delete the work, and a job
-- whose client record has gone still has its own copy of who it was for.
alter table public.jobs add column if not exists client_id text
  references public.clients(id) on delete set null;

alter table public.clients alter column org_id set default public.my_org_id();

do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.clients set org_id = first_org where org_id is null;
  end if;
end $$;

create index if not exists clients_org_idx   on public.clients(org_id);
create index if not exists clients_phone_idx on public.clients(org_id, phone);
create index if not exists clients_email_idx on public.clients(org_id, email);
create index if not exists jobs_client_idx   on public.jobs(client_id);

alter table public.clients enable row level security;

drop policy if exists "org can read clients"  on public.clients;
drop policy if exists "org can write clients" on public.clients;

create policy "org can read clients" on public.clients
  for select using (org_id = public.my_org_id());

create policy "org can write clients" on public.clients
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- Granted to `authenticated` because the app reads and writes this, and NOT
-- to service_role, because no Edge Function touches it. Migration 028 exists
-- because 025-027 got the first half of that sentence right and forgot that
-- it has a second half — the rule is to grant what is actually used, to the
-- roles that actually use it, and nothing else.
grant select, insert, update, delete on public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- BACKFILL. Groups the jobs that already exist into clients.
--
-- Same rule the app uses (see clients.js): two jobs belong to the same person
-- if EITHER the digits of their phone match OR their lowercased email matches.
-- Phone is compared digits-only because "0412 345 678" and "(04) 1234 5678"
-- are one number.
--
-- Idempotent: it only ever touches jobs whose client_id is still null, so
-- running it twice creates nothing the second time.
-- ---------------------------------------------------------------------------
do $$
declare
  j record;
  found_id text;
  norm_phone text;
  norm_email text;
  owning_org uuid;
begin
  -- org_id is resolved HERE and written explicitly, rather than left to the
  -- column default. The default is public.my_org_id(), which reads
  -- auth.uid() — and a migration run from the CLI or the SQL editor has no
  -- signed-in user, so every row this loop inserts would land with a null
  -- org_id and belong to nobody. Backfilling afterwards is not enough
  -- either: the fix has to be in the insert, or re-running this on a fresh
  -- database reintroduces the same orphans.
  select id into owning_org from public.organisations limit 1;
  -- Newest first, so where details have changed over the years the client
  -- record ends up holding the most recent version of them.
  for j in
    select id, name, client_phone, client_email, address, created_at
    from public.jobs
    where client_id is null
      and (coalesce(trim(client_phone), '') <> '' or coalesce(trim(client_email), '') <> '')
    order by created_at desc
  loop
    norm_phone := nullif(regexp_replace(coalesce(j.client_phone, ''), '\D', '', 'g'), '');
    norm_email := nullif(lower(trim(coalesce(j.client_email, ''))), '');

    select c.id into found_id
    from public.clients c
    where (norm_phone is not null
             and nullif(regexp_replace(c.phone, '\D', '', 'g'), '') = norm_phone)
       or (norm_email is not null
             and nullif(lower(trim(c.email)), '') = norm_email)
    limit 1;

    if found_id is null then
      found_id := 'cl_' || replace(gen_random_uuid()::text, '-', '');
      insert into public.clients (id, name, phone, email, created_at, updated_at, org_id)
      values (
        found_id,
        coalesce(j.name, ''),
        coalesce(j.client_phone, ''),
        coalesce(j.client_email, ''),
        j.created_at,
        extract(epoch from now()) * 1000,
        coalesce(owning_org, public.my_org_id())
      );
    end if;

    update public.jobs set client_id = found_id where id = j.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Check it worked. `jobs_without_contact` are jobs with neither a phone nor
-- an email — there is nothing to group them by, so they are correctly left
-- unlinked rather than merged into a guess.
select
  (select count(*) from public.clients)                               as clients_created,
  (select count(*) from public.jobs where client_id is not null)       as jobs_linked,
  (select count(*) from public.jobs
     where client_id is null
       and (coalesce(trim(client_phone),'') <> '' or coalesce(trim(client_email),'') <> '')) as jobs_missed,
  (select count(*) from public.jobs
     where coalesce(trim(client_phone),'') = ''
       and coalesce(trim(client_email),'') = '')                       as jobs_without_contact,
  (select count(*) from public.clients where org_id is null)           as orphaned;
