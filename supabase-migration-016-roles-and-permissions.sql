-- Migration 016 — roles, and policies that actually enforce them
--
-- WHY
-- Every policy in this project up to now is `to authenticated using (true)`.
-- That was correct for a solo operator: there was one person, and a login was
-- their login. With a second technician it means a login is a master key —
-- anyone signed in can read every client's name, address, phone and
-- inspection photographs, open every invoice, and delete any job. A departing
-- employee keeps all of it until their account is disabled.
--
-- Migration 013 added jobs.assigned_to but deliberately changed no
-- permissions; it is labelling. This is the migration that makes it mean
-- something.
--
-- THE MODEL (chosen deliberately, not by default)
--   Everyone signed in can READ everything. A technician covering a job,
--   answering a client who rang them, or picking up work mid-week needs to
--   look things up; hiding jobs from each other buys little and costs real
--   friction in the field.
--   A technician may only WRITE a job assigned to them (or unassigned —
--   see below). Admins may write anything.
--   Invoices, and deleting jobs or captures, are admin-only outright.
--
-- UNASSIGNED JOBS ARE WRITABLE BY ANYONE, ON PURPOSE. Every job created
-- before migration 013 has an empty assigned_to, which is most of the
-- existing database. Treating those as admin-only would make a technician's
-- app mysteriously refuse to save against historical work. An unassigned job
-- is nobody's yet, so anyone may take it.
--
-- BOOTSTRAPPING — read this before running
-- This migration makes EVERY EXISTING USER AN ADMIN. That is intentional:
-- run it and nothing changes about who can do what, because everyone already
-- could do everything. Roles only start restricting anything the moment you
-- deliberately demote someone to 'technician' (see the bottom of this file).
-- There is therefore no way for this migration to lock you out of your own
-- database, which is the one failure here that would be unrecoverable from
-- the app.
--
-- Run once against the live project. Genuinely idempotent: every policy is
-- dropped by its own name before being created, so a re-run cannot fail with
-- "policy already exists" partway through and leave the table half-governed.

-- ---------------------------------------------------------------- roles ---

create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'technician' check (role in ('admin', 'technician')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_roles is
  'One row per signed-in user. Absence of a row means technician — the '
  'restricted role — so a new account never silently arrives with admin '
  'rights just because nobody got around to adding it here.';

alter table public.user_roles enable row level security;

grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.user_roles to service_role;

-- security definer, so a policy that asks "is this user an admin?" does not
-- itself trigger the policies on user_roles and recurse forever. This is the
-- standard Supabase shape for role checks and the reason the check lives in
-- a function rather than being inlined into every policy below.
create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- assigned_to holds an email (see migration 013), not a uuid, so ownership is
-- an email comparison. Case-insensitive: the address a technician types at
-- the login screen is not reliably the case Postgres stored.
create or replace function public.owns_job(assigned_to text)
  returns boolean
  language sql
  stable
as $$
  select coalesce(assigned_to, '') = ''
      or lower(coalesce(assigned_to, '')) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

comment on function public.owns_job(text) is
  'True when the job is unassigned (nobody owns it yet, so anyone may) or '
  'assigned to the calling user by email.';

-- Everyone may read the roster — the app shows who a job belongs to, and a
-- technician needs to be able to see their own role to know which buttons to
-- offer. Only service_role may change it, so promoting somebody is a
-- deliberate act in the dashboard rather than something the app can do.
drop policy if exists "team can read roles" on public.user_roles;
create policy "team can read roles" on public.user_roles
  for select to authenticated using (true);

-- ----------------------------------------------------------------- jobs ---

drop policy if exists "team can read jobs"   on public.jobs;
drop policy if exists "team can insert jobs" on public.jobs;
drop policy if exists "team can update jobs" on public.jobs;
drop policy if exists "team can delete jobs" on public.jobs;

drop policy if exists "signed in can read jobs" on public.jobs;
create policy "signed in can read jobs" on public.jobs
  for select to authenticated using (true);

-- Anyone may create a job. db.js stamps assigned_to with the creator, so a
-- technician's new job is theirs immediately.
drop policy if exists "signed in can insert jobs" on public.jobs;
create policy "signed in can insert jobs" on public.jobs
  for insert to authenticated with check (true);

-- USING decides which rows may be updated; WITH CHECK decides what they may
-- be updated to. Both are needed: without WITH CHECK a technician could
-- reassign one of their jobs to somebody else and keep editing it through
-- the row they no longer own.
drop policy if exists "own or admin can update jobs" on public.jobs;
create policy "own or admin can update jobs" on public.jobs
  for update to authenticated
  using (public.is_admin() or public.owns_job(assigned_to))
  with check (public.is_admin() or public.owns_job(assigned_to));

drop policy if exists "admin can delete jobs" on public.jobs;
create policy "admin can delete jobs" on public.jobs
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------- reports ---
-- A report's owner is the owner of the job it belongs to. A report is the
-- compliance document a technician signs their name under; one technician
-- silently editing another's finalized report is the specific thing the
-- audit trail exists to make visible, and this stops it happening at all.

drop policy if exists "team can read reports"   on public.reports;
drop policy if exists "team can insert reports" on public.reports;
drop policy if exists "team can update reports" on public.reports;
drop policy if exists "team can delete reports" on public.reports;

drop policy if exists "signed in can read reports" on public.reports;
create policy "signed in can read reports" on public.reports
  for select to authenticated using (true);

drop policy if exists "own or admin can insert reports" on public.reports;
create policy "own or admin can insert reports" on public.reports
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = reports.job_id and public.owns_job(j.assigned_to))
  );

drop policy if exists "own or admin can update reports" on public.reports;
create policy "own or admin can update reports" on public.reports
  for update to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = reports.job_id and public.owns_job(j.assigned_to))
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = reports.job_id and public.owns_job(j.assigned_to))
  );

drop policy if exists "admin can delete reports" on public.reports;
create policy "admin can delete reports" on public.reports
  for delete to authenticated using (public.is_admin());

-- ------------------------------------------------------ captures/footage ---
-- Photographs are evidence. Same ownership rule as the job they belong to,
-- and deletion is admin-only: a deleted capture takes the only copy of what
-- was on site with it.

drop policy if exists "team can read captures"  on public.captures;
drop policy if exists "team can write captures" on public.captures;
drop policy if exists "team can read footage"   on public.footage;
drop policy if exists "team can write footage"  on public.footage;

drop policy if exists "signed in can read captures" on public.captures;
create policy "signed in can read captures" on public.captures
  for select to authenticated using (true);

drop policy if exists "own or admin can insert captures" on public.captures;
create policy "own or admin can insert captures" on public.captures
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = captures.job_id and public.owns_job(j.assigned_to))
  );

drop policy if exists "own or admin can update captures" on public.captures;
create policy "own or admin can update captures" on public.captures
  for update to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = captures.job_id and public.owns_job(j.assigned_to))
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = captures.job_id and public.owns_job(j.assigned_to))
  );

drop policy if exists "admin can delete captures" on public.captures;
create policy "admin can delete captures" on public.captures
  for delete to authenticated using (public.is_admin());

drop policy if exists "signed in can read footage" on public.footage;
create policy "signed in can read footage" on public.footage
  for select to authenticated using (true);

drop policy if exists "own or admin can write footage" on public.footage;
create policy "own or admin can write footage" on public.footage
  for all to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = footage.job_id and public.owns_job(j.assigned_to))
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.jobs j where j.id = footage.job_id and public.owns_job(j.assigned_to))
  );

-- ------------------------------------------------------------- invoices ---
-- Admin-only outright, read included: what a job was charged at is the one
-- thing on this list a technician has no working need to see.

drop policy if exists "team can read invoices"  on public.invoices;
drop policy if exists "team can write invoices" on public.invoices;

drop policy if exists "admin can read invoices" on public.invoices;
create policy "admin can read invoices" on public.invoices
  for select to authenticated using (public.is_admin());

drop policy if exists "admin can write invoices" on public.invoices;
create policy "admin can write invoices" on public.invoices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --------------------------------------------------------- bootstrapping ---
-- Everyone who already has an account becomes an admin, because everyone
-- already had admin power in practice. Running this migration therefore
-- changes nobody's abilities on the day it runs — it only creates the
-- machinery. Restriction begins when you demote someone, deliberately.
insert into public.user_roles (user_id, email, role)
select u.id, u.email, 'admin'
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- TO ADD A TECHNICIAN, once their account exists:
--
--   update public.user_roles
--      set role = 'technician', updated_at = now()
--    where lower(email) = lower('them@example.com');
--
-- TO CHECK WHO IS WHAT:
--
--   select email, role from public.user_roles order by role, email;
--
-- TO UNDO EVERYTHING HERE, if it ever causes trouble in the field, make
-- everyone an admin again — that restores exactly the old behaviour without
-- having to restore old policies:
--
--   update public.user_roles set role = 'admin';
-- ---------------------------------------------------------------------------
