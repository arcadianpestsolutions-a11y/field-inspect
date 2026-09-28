-- Migration 023 — every row belongs to a business
--
-- THIS IS THE ONE THAT MATTERS. Migration 022 created the tenant; this scopes
-- the data to it. Until now every policy in this project reads
-- `to authenticated using (true)` — any signed-in account sees every job,
-- every client's name, address and phone number, every photograph, every
-- invoice. Correct for one business. A data breach for two.
--
-- THE DESIGN: THE DATABASE STAMPS THE OWNER, NOT THE APP.
--
-- org_id defaults to public.my_org_id(), which resolves from auth.uid(). The
-- client never sends it and cannot set it. That is deliberate — if the app
-- supplied the value, then a bug, a stale cached build or a tampered request
-- could write a row into somebody else's business. Here it is not possible to
-- express: the column takes the caller's own organisation or the insert
-- fails.
--
-- Reads are filtered the same way, so no client code changes at all. An app
-- that knows nothing about organisations simply sees less.
--
-- WHY NULL IS SAFE. my_org_id() returns null for an account attached to no
-- organisation. `org_id = null` is null, which is not true, so that account
-- sees nothing rather than everything. The failure mode of this whole
-- migration is "I can't see my data", which is loud and recoverable — not
-- "I can see someone else's", which is neither.
--
-- ORDER IS LOAD-BEARING. Columns are added nullable, backfilled, and only
-- then made the basis of policy. Reversing those steps locks the existing
-- business out of its own records.
--
-- STILL NOT DONE AFTER THIS. Edge Functions using the service_role key
-- bypass RLS entirely and must filter by organisation themselves —
-- calendar-feed and send-due-reminders both read jobs that way. They are
-- handled separately and are tracked as the remaining leak.
--
-- Run once against the live project.

-- ------------------------------------------------- who am I working for ---

create or replace function public.my_org_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select org_id from public.user_roles where user_id = auth.uid();
$$;

comment on function public.my_org_id() is
  'The calling user''s organisation. security definer so a policy asking the '
  'question does not itself trigger the policies on user_roles and recurse. '
  'Null for an account attached to no organisation, which by design sees '
  'nothing rather than everything.';

grant execute on function public.my_org_id() to authenticated;

-- ------------------------------------------------------- 1. add columns ---
-- Nullable for now. Made the basis of policy only after the backfill below.

alter table public.jobs            add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.reports         add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.captures        add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.invoices        add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.deletions       add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.client_messages add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.calendar_feed   add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.xero_connections add column if not exists org_id uuid references public.organisations(id) on delete cascade;

-- --------------------------------------------------------- 2. backfill ---
-- Everything that exists today belongs to the one organisation that exists
-- today. This must leave no nulls behind: a row with a null org_id after
-- step 4 is a row nobody can see.

do $$
declare first_org uuid;
begin
  select id into first_org from public.organisations order by created_at limit 1;
  if first_org is null then
    raise exception 'No organisation exists. Run migration 022 first.';
  end if;

  update public.jobs             set org_id = first_org where org_id is null;
  update public.reports          set org_id = first_org where org_id is null;
  update public.captures         set org_id = first_org where org_id is null;
  update public.invoices         set org_id = first_org where org_id is null;
  update public.deletions        set org_id = first_org where org_id is null;
  update public.client_messages  set org_id = first_org where org_id is null;
  update public.calendar_feed    set org_id = first_org where org_id is null;
  update public.xero_connections set org_id = first_org where org_id is null;
end $$;

-- --------------------------------------- 3. the database stamps the owner ---
-- The client never sends org_id and cannot set it to anything else.

alter table public.jobs             alter column org_id set default public.my_org_id();
alter table public.reports          alter column org_id set default public.my_org_id();
alter table public.captures         alter column org_id set default public.my_org_id();
alter table public.invoices         alter column org_id set default public.my_org_id();
alter table public.deletions        alter column org_id set default public.my_org_id();
alter table public.client_messages  alter column org_id set default public.my_org_id();
alter table public.calendar_feed    alter column org_id set default public.my_org_id();
alter table public.xero_connections alter column org_id set default public.my_org_id();

-- The calendar feed row was keyed 'default', which is a single-tenant
-- assumption hiding in a primary key: two businesses cannot both be
-- 'default'. Re-keyed to the organisation, which is what it always meant.
update public.calendar_feed set id = org_id::text where id = 'default' and org_id is not null;

-- One feed per business, so the app can look a row up by organisation and
-- get exactly one answer rather than "some row belonging to somebody".
create unique index if not exists calendar_feed_org_uniq on public.calendar_feed(org_id);

-- Queried on every read now, so these are the indexes that matter.
create index if not exists jobs_org_idx            on public.jobs(org_id);
create index if not exists reports_org_idx         on public.reports(org_id);
create index if not exists captures_org_idx        on public.captures(org_id);
create index if not exists invoices_org_idx        on public.invoices(org_id);
create index if not exists deletions_org_idx       on public.deletions(org_id);
create index if not exists client_messages_org_idx on public.client_messages(org_id);

-- ------------------------------------------------------- 4. the policies ---
-- Every one of these replaces a policy that said `using (true)`.
--
-- The ownership rules from migration 016 are kept and narrowed: a technician
-- still may only write their own jobs, an admin still may delete — but both
-- are now inside their own organisation first.

-- jobs
drop policy if exists "signed in can read jobs"   on public.jobs;
drop policy if exists "signed in can insert jobs" on public.jobs;
drop policy if exists "own or admin can update jobs" on public.jobs;
drop policy if exists "admin can delete jobs"     on public.jobs;

drop policy if exists "org can read jobs" on public.jobs;
create policy "org can read jobs" on public.jobs
  for select to authenticated using (org_id = public.my_org_id());

drop policy if exists "org can insert jobs" on public.jobs;
create policy "org can insert jobs" on public.jobs
  for insert to authenticated with check (org_id = public.my_org_id());

drop policy if exists "org own or admin can update jobs" on public.jobs;
create policy "org own or admin can update jobs" on public.jobs
  for update to authenticated
  using (org_id = public.my_org_id() and (public.is_admin() or public.owns_job(assigned_to)))
  with check (org_id = public.my_org_id() and (public.is_admin() or public.owns_job(assigned_to)));

drop policy if exists "org admin can delete jobs" on public.jobs;
create policy "org admin can delete jobs" on public.jobs
  for delete to authenticated
  using (org_id = public.my_org_id() and public.is_admin());

-- reports
drop policy if exists "signed in can read reports"        on public.reports;
drop policy if exists "own or admin can insert reports"   on public.reports;
drop policy if exists "own or admin can update reports"   on public.reports;
drop policy if exists "admin can delete reports"          on public.reports;

drop policy if exists "org can read reports" on public.reports;
create policy "org can read reports" on public.reports
  for select to authenticated using (org_id = public.my_org_id());

drop policy if exists "org own or admin can insert reports" on public.reports;
create policy "org own or admin can insert reports" on public.reports
  for insert to authenticated
  with check (org_id = public.my_org_id() and (public.is_admin()
    or exists (select 1 from public.jobs j where j.id = reports.job_id and public.owns_job(j.assigned_to))));

drop policy if exists "org own or admin can update reports" on public.reports;
create policy "org own or admin can update reports" on public.reports
  for update to authenticated
  using (org_id = public.my_org_id() and (public.is_admin()
    or exists (select 1 from public.jobs j where j.id = reports.job_id and public.owns_job(j.assigned_to))))
  with check (org_id = public.my_org_id() and (public.is_admin()
    or exists (select 1 from public.jobs j where j.id = reports.job_id and public.owns_job(j.assigned_to))));

drop policy if exists "org admin can delete reports" on public.reports;
create policy "org admin can delete reports" on public.reports
  for delete to authenticated
  using (org_id = public.my_org_id() and public.is_admin());

-- captures
drop policy if exists "signed in can read captures"      on public.captures;
drop policy if exists "own or admin can insert captures" on public.captures;
drop policy if exists "own or admin can update captures" on public.captures;
drop policy if exists "admin can delete captures"        on public.captures;

drop policy if exists "org can read captures" on public.captures;
create policy "org can read captures" on public.captures
  for select to authenticated using (org_id = public.my_org_id());

drop policy if exists "org can insert captures" on public.captures;
create policy "org can insert captures" on public.captures
  for insert to authenticated
  with check (org_id = public.my_org_id() and (public.is_admin()
    or exists (select 1 from public.jobs j where j.id = captures.job_id and public.owns_job(j.assigned_to))));

drop policy if exists "org can update captures" on public.captures;
create policy "org can update captures" on public.captures
  for update to authenticated
  using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

drop policy if exists "org admin can delete captures" on public.captures;
create policy "org admin can delete captures" on public.captures
  for delete to authenticated
  using (org_id = public.my_org_id() and public.is_admin());

-- invoices — admin-only stays admin-only, now within the organisation
drop policy if exists "admin can read invoices"  on public.invoices;
drop policy if exists "admin can write invoices" on public.invoices;

drop policy if exists "org admin can read invoices" on public.invoices;
create policy "org admin can read invoices" on public.invoices
  for select to authenticated using (org_id = public.my_org_id() and public.is_admin());

drop policy if exists "org admin can write invoices" on public.invoices;
create policy "org admin can write invoices" on public.invoices
  for all to authenticated
  using (org_id = public.my_org_id() and public.is_admin())
  with check (org_id = public.my_org_id() and public.is_admin());

-- deletions — the most dangerous table to leave unscoped. A tombstone is an
-- instruction to delete, and enforceTombstones acts on it by deleting the row
-- from the server. Shared across organisations, one business's tombstone
-- would delete another business's record.
drop policy if exists "team can read deletions"  on public.deletions;
drop policy if exists "team can write deletions" on public.deletions;

drop policy if exists "org can read deletions" on public.deletions;
create policy "org can read deletions" on public.deletions
  for select to authenticated using (org_id = public.my_org_id());

drop policy if exists "org can write deletions" on public.deletions;
create policy "org can write deletions" on public.deletions
  for all to authenticated
  using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- client messages
drop policy if exists "team can read client messages" on public.client_messages;

drop policy if exists "org can read client messages" on public.client_messages;
create policy "org can read client messages" on public.client_messages
  for select to authenticated using (org_id = public.my_org_id());

-- calendar feed
drop policy if exists "team can read calendar feed"  on public.calendar_feed;
drop policy if exists "team can write calendar feed" on public.calendar_feed;

drop policy if exists "org can read calendar feed" on public.calendar_feed;
create policy "org can read calendar feed" on public.calendar_feed
  for select to authenticated using (org_id = public.my_org_id());

drop policy if exists "org can write calendar feed" on public.calendar_feed;
create policy "org can write calendar feed" on public.calendar_feed
  for all to authenticated
  using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- user_roles — the roster is how the app turns an email into a name, so it
-- stays readable, but only for your own colleagues.
drop policy if exists "team can read roles" on public.user_roles;

drop policy if exists "org can read roles" on public.user_roles;
create policy "org can read roles" on public.user_roles
  for select to authenticated
  using (org_id = public.my_org_id() or user_id = auth.uid());

-- ------------------------------------------------------------- 5. check ---
-- Every count must be zero. A row with a null org_id is a row that has just
-- become invisible to everyone.
select
  (select count(*) from public.jobs            where org_id is null) as jobs_orphaned,
  (select count(*) from public.reports         where org_id is null) as reports_orphaned,
  (select count(*) from public.captures        where org_id is null) as captures_orphaned,
  (select count(*) from public.invoices        where org_id is null) as invoices_orphaned,
  (select count(*) from public.deletions       where org_id is null) as deletions_orphaned,
  (select count(*) from public.client_messages where org_id is null) as messages_orphaned,
  (select public.my_org_id())                                        as your_org,
  (select count(*) from public.jobs)                                 as jobs_you_can_see;
