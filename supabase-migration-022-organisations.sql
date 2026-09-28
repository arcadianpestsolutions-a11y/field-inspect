-- Migration 022 — the business becomes data instead of code
--
-- WHY
-- "Arcadian Pest Solutions" is currently written into ten application files
-- and six Edge Functions: report headers, invoice brand lines, provider
-- fields, AI prompts, email templates. The licence number, the office phone
-- and the inspector's own details are constants in report.js.
--
-- That is correct for one business and impossible for two. This is the first
-- of the changes that separate the software from the company running it: the
-- identity moves into a row, the code reads the row, and changing a phone
-- number stops being a deploy.
--
-- It is also worth doing on its own merits for a single operator. A licence
-- number in a source file is a licence number nobody can correct from a
-- phone at a job.
--
-- WHAT THIS IS NOT. This does not make the app multi-tenant. Every job,
-- report and photograph is still readable by anyone signed in — that comes
-- next, and it is the larger half. This migration creates the tenant and
-- attaches people to it; it does not yet scope the data.
--
-- Run once against the live project. Additive and idempotent.

-- --------------------------------------------------- the organisation ---

create table if not exists public.organisations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  trading_name   text default '',
  abn            text default '',
  licence_number text default '',
  phone          text default '',
  email          text default '',
  address        text default '',
  website        text default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.organisations is
  'One row per pest control business using Scope. Everything that used to be '
  'hardcoded as "Arcadian Pest Solutions" is read from here: report headers, '
  'invoice brand, provider fields on every document.';

alter table public.organisations enable row level security;

-- Readable by anyone signed in: the app needs the business details to draw a
-- report header, and every one of those details already appears on documents
-- handed to clients. Writable by admins only — a technician should not be
-- able to change the licence number the company signs under.
drop policy if exists "signed in can read organisations" on public.organisations;
create policy "signed in can read organisations" on public.organisations
  for select to authenticated using (true);

drop policy if exists "admin can write organisations" on public.organisations;
create policy "admin can write organisations" on public.organisations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.organisations to authenticated;
grant select, insert, update, delete on public.organisations to service_role;

-- ------------------------------------------- people, and who they are ---
-- The inspector's own details were a lookup table keyed by email address in
-- report.js. That is the same mistake one level down: adding a second
-- technician meant a deploy. They belong beside the role.

alter table public.user_roles
  add column if not exists org_id uuid references public.organisations(id) on delete set null,
  add column if not exists display_name text default '',
  add column if not exists licence_number text default '',
  add column if not exists phone text default '',
  add column if not exists address text default '';

comment on column public.user_roles.org_id is
  'Which business this person works for. Null means not yet assigned — the '
  'app treats that as the single existing organisation until data is scoped '
  'by org as well.';

-- ------------------------------------------------------------- seeding ---
-- The current business, taken from what the code had hardcoded, so nothing
-- changes on screen when the app starts reading this instead.
insert into public.organisations (name, trading_name, licence_number, phone, email)
select 'Arcadian Pest Solutions', 'Arcadian Pest Solutions', '5095443',
       '0291271320', 'tal@arcadianpestsolutions.com.au'
where not exists (select 1 from public.organisations);

-- Everyone who already has an account belongs to it.
update public.user_roles
   set org_id = (select id from public.organisations order by created_at limit 1)
 where org_id is null;

-- And the one inspector profile that lived in report.js.
update public.user_roles
   set display_name   = coalesce(nullif(display_name, ''), 'Tal Pavlich'),
       licence_number = coalesce(nullif(licence_number, ''), '5095443'),
       phone          = coalesce(nullif(phone, ''), '0291271320'),
       address        = coalesce(nullif(address, ''), 'Ingleburn')
 where lower(email) = lower('talpavlich@hotmail.com');

-- --------------------------------------------------------------- check ---
select
  (select count(*) from public.organisations)                      as organisations,
  (select count(*) from public.user_roles where org_id is not null) as people_attached,
  (select name from public.organisations order by created_at limit 1) as business_name;
