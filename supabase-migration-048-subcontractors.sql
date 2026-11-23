-- 048: subcontractors.
--
-- A business (the host) gives a subcontractor a link. The subcontractor signs
-- up, accepts the host's agreement, and once the host approves them they fill
-- in the forms for jobs assigned to them. Everything they produce carries the
-- host's name and logo, with their own name and licence as the inspector.
--
-- THE WALL, AND WHY IT IS BUILT THIS WAY
-- A subcontractor is NOT given a row in user_roles. Every existing policy in
-- this database says "org_id = my_org_id()", and my_org_id() reads user_roles,
-- so a login with no row there gets nothing from any table: clients, leads,
-- invoices, follow-ups, the diary, the team, and any table added later.
-- Closed is the default, and no existing policy is changed by this file.
--
-- What a subcontractor may do is then added explicitly, and only this:
--   * read and save the jobs assigned to them, through two functions
--     (sub_my_jobs, sub_save_job) that name every column they may see or
--     change. The client's email, the follow-up notes and the client record
--     are blanked on the way out, and ignored on the way in.
--   * read and write the report and photos of those jobs. A report can be
--     written only while the copy here is not finalised: once they have
--     signed and submitted it, it is the host's to review, send back or send.
-- Their membership is one row in public.subcontractors per host, which the
-- host's admin approves or removes. Removing takes effect on the next request.
--
-- Additive and safe to run twice.

-- ------------------------------------------------------------ the logo ---
-- A small image kept in the row itself (a data: URL), so a report can print
-- it with no signal and without a signed storage link. The app resizes before
-- saving; the limit here is the backstop.
alter table public.organisations
  add column if not exists logo_data_url text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organisations_logo_size') then
    alter table public.organisations
      add constraint organisations_logo_size check (char_length(logo_data_url) <= 200000);
  end if;
end $$;

-- ------------------------------------------- the link and the agreement ---
create table if not exists public.subcontractor_settings (
  org_id                 uuid primary key references public.organisations(id) on delete cascade,
  invite_token           text not null unique,
  invite_enabled         boolean not null default true,
  agreement_text         text not null default '' check (char_length(agreement_text) <= 60000),
  agreement_version      integer not null default 0,
  agreement_updated_at   timestamptz,
  require_insurance      boolean not null default true,
  require_licence_expiry boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.subcontractor_settings is
  'One row per business: the sign-up link for its subcontractors and the '
  'agreement they must accept. The wording is the business''s own.';

alter table public.subcontractor_settings enable row level security;

drop policy if exists "org admin can read subcontractor settings" on public.subcontractor_settings;
create policy "org admin can read subcontractor settings" on public.subcontractor_settings
  for select to authenticated
  using (org_id = public.my_org_id() and public.is_admin());

revoke all on public.subcontractor_settings from anon, authenticated;
grant select on public.subcontractor_settings to authenticated;
grant select on public.subcontractor_settings to service_role;

-- ------------------------------------------------------ the people ---
create table if not exists public.subcontractors (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organisations(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  email                   text not null check (char_length(email) <= 200),
  status                  text not null default 'pending'
                            check (status in ('pending', 'active', 'declined', 'removed')),
  full_name               text not null default '' check (char_length(full_name) <= 120),
  business_name           text not null default '' check (char_length(business_name) <= 160),
  abn                     text not null default '' check (char_length(abn) <= 20),
  phone                   text not null default '' check (char_length(phone) <= 30),
  licence_number          text not null default '' check (char_length(licence_number) <= 60),
  licence_expiry          date,
  insurer                 text not null default '' check (char_length(insurer) <= 120),
  insurance_policy        text not null default '' check (char_length(insurance_policy) <= 80),
  insurance_expiry        date,
  -- What they agreed to, kept word for word: the host can change its
  -- agreement later, and this is the proof of which wording this person saw.
  agreement_text          text not null default '' check (char_length(agreement_text) <= 60000),
  agreement_version       integer not null default 0,
  agreement_accepted_at   timestamptz,
  agreement_accepted_name text not null default '' check (char_length(agreement_accepted_name) <= 120),
  applied_at              timestamptz not null default now(),
  decided_at              timestamptz,
  decided_by              uuid,
  updated_at              timestamptz not null default now(),
  unique (org_id, user_id)
);

comment on table public.subcontractors is
  'A subcontractor''s membership of one host business. status decides '
  'everything: only ''active'' opens any data, and only the jobs assigned to '
  'them. Rows are created by the subcontractor-join function, never by the app.';

create index if not exists subcontractors_user_idx on public.subcontractors (user_id);
create index if not exists subcontractors_org_status_idx on public.subcontractors (org_id, status);

alter table public.subcontractors enable row level security;

-- The host's admin sees their subcontractors; a subcontractor sees their own
-- record. Nobody inserts, updates or deletes through the API: every change
-- goes through a function below, which is where the rules are.
drop policy if exists "host admin or self can read subcontractors" on public.subcontractors;
create policy "host admin or self can read subcontractors" on public.subcontractors
  for select to authenticated
  using ((org_id = public.my_org_id() and public.is_admin()) or user_id = auth.uid());

revoke all on public.subcontractors from anon, authenticated;
grant select on public.subcontractors to authenticated;
grant select, insert on public.subcontractors to service_role;

-- --------------------------------------------- host: link and agreement ---
-- Returns the business's settings row, making it on first use.
create or replace function public.sub_settings()
returns public.subcontractor_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.my_org_id();
  found_row public.subcontractor_settings;
begin
  if org is null or not public.is_admin() then
    raise exception 'Only the business owner can manage subcontractors.';
  end if;
  insert into public.subcontractor_settings (org_id, invite_token)
  values (org, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (org_id) do nothing;
  select * into found_row from public.subcontractor_settings where org_id = org;
  return found_row;
end;
$$;

-- One function for every change, each key optional:
--   agreementText (the version goes up only when the wording changes),
--   inviteEnabled, requireInsurance, requireLicenceExpiry,
--   rotate: true (a new link; the old one stops working at once).
create or replace function public.sub_settings_save(p jsonb)
returns public.subcontractor_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.my_org_id();
  cur public.subcontractor_settings;
  new_text text;
begin
  if org is null or not public.is_admin() then
    raise exception 'Only the business owner can manage subcontractors.';
  end if;
  cur := public.sub_settings();

  if p ? 'agreementText' then
    new_text := btrim(coalesce(p ->> 'agreementText', ''));
    if char_length(new_text) > 60000 then
      raise exception 'That agreement is too long to save. Shorten it, or keep the detail in a separate document you send.';
    end if;
    if new_text is distinct from cur.agreement_text then
      update public.subcontractor_settings
         set agreement_text = new_text,
             agreement_version = cur.agreement_version + 1,
             agreement_updated_at = now(),
             updated_at = now()
       where org_id = org;
    end if;
  end if;

  if p ? 'inviteEnabled' then
    update public.subcontractor_settings
       set invite_enabled = coalesce((p ->> 'inviteEnabled')::boolean, true), updated_at = now()
     where org_id = org;
  end if;
  if p ? 'requireInsurance' then
    update public.subcontractor_settings
       set require_insurance = coalesce((p ->> 'requireInsurance')::boolean, true), updated_at = now()
     where org_id = org;
  end if;
  if p ? 'requireLicenceExpiry' then
    update public.subcontractor_settings
       set require_licence_expiry = coalesce((p ->> 'requireLicenceExpiry')::boolean, true), updated_at = now()
     where org_id = org;
  end if;
  if coalesce((p ->> 'rotate')::boolean, false) then
    update public.subcontractor_settings
       set invite_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
           updated_at = now()
     where org_id = org;
  end if;

  select * into cur from public.subcontractor_settings where org_id = org;
  return cur;
end;
$$;

-- Approve, decline, remove, or let back in. Only the host's admin, and only
-- their own subcontractors.
create or replace function public.sub_decide(p_id uuid, p_status text)
returns public.subcontractors
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.my_org_id();
  cur public.subcontractors;
begin
  if org is null or not public.is_admin() then
    raise exception 'Only the business owner can approve or remove subcontractors.';
  end if;
  if p_status not in ('active', 'declined', 'removed') then
    raise exception 'Unknown status.';
  end if;
  select * into cur from public.subcontractors where id = p_id and org_id = org;
  if not found then
    raise exception 'That subcontractor is not on your list.';
  end if;
  update public.subcontractors
     set status = p_status, decided_at = now(), decided_by = auth.uid(), updated_at = now()
   where id = p_id and org_id = org;
  select * into cur from public.subcontractors where id = p_id;
  return cur;
end;
$$;

-- Names for the host's job lists and the "assign to" picker. Any member of
-- the business may read it; it holds nothing but who is on the list.
create or replace function public.sub_roster()
returns table (email text, full_name text, business_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.email, s.full_name, s.business_name
  from public.subcontractors s
  where public.my_org_id() is not null
    and s.org_id = public.my_org_id()
    and s.status = 'active'
  order by s.full_name;
$$;

-- ------------------------------------------------ subcontractor: myself ---
-- Everything the subcontractor's app needs to know about where it stands:
-- one entry per host. The host's full details (ABN, licence, phone, logo)
-- are only handed over once the host has approved them.
create or replace function public.sub_my_hosts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'subId', s.id,
    'orgId', s.org_id,
    'status', s.status,
    'business', case when s.status = 'active' then jsonb_build_object(
        'name', o.name, 'tradingName', o.trading_name, 'abn', o.abn,
        'licenceNumber', o.licence_number, 'phone', o.phone, 'email', o.email,
        'address', o.address, 'website', o.website, 'logoDataUrl', o.logo_data_url)
      else jsonb_build_object('name', o.name, 'tradingName', o.trading_name) end,
    'me', jsonb_build_object(
        'email', s.email, 'fullName', s.full_name, 'businessName', s.business_name,
        'abn', s.abn, 'phone', s.phone,
        'licenceNumber', s.licence_number, 'licenceExpiry', s.licence_expiry,
        'insurer', s.insurer, 'insurancePolicy', s.insurance_policy,
        'insuranceExpiry', s.insurance_expiry),
    'agreementVersion', s.agreement_version,
    'agreementAcceptedAt', s.agreement_accepted_at,
    'appliedAt', s.applied_at
  ) order by s.applied_at), '[]'::jsonb)
  from public.subcontractors s
  join public.organisations o on o.id = s.org_id
  where s.user_id = auth.uid();
$$;

-- A subcontractor keeps their own licence and insurance details current.
-- Nothing else on the row can be changed from here: not the status, not the
-- host, not the agreement they accepted.
create or replace function public.sub_update_my_profile(p_org uuid, p jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  update public.subcontractors s set
    phone            = case when p ? 'phone' then left(btrim(coalesce(p ->> 'phone', '')), 30) else s.phone end,
    licence_number   = case when p ? 'licenceNumber' and btrim(coalesce(p ->> 'licenceNumber', '')) <> ''
                         then left(btrim(p ->> 'licenceNumber'), 60) else s.licence_number end,
    licence_expiry   = case when p ? 'licenceExpiry' then nullif(p ->> 'licenceExpiry', '')::date else s.licence_expiry end,
    insurer          = case when p ? 'insurer' then left(btrim(coalesce(p ->> 'insurer', '')), 120) else s.insurer end,
    insurance_policy = case when p ? 'insurancePolicy' then left(btrim(coalesce(p ->> 'insurancePolicy', '')), 80) else s.insurance_policy end,
    insurance_expiry = case when p ? 'insuranceExpiry' then nullif(p ->> 'insuranceExpiry', '')::date else s.insurance_expiry end,
    updated_at       = now()
  where s.user_id = auth.uid() and s.org_id = p_org and s.status in ('pending', 'active');
  return found;
end;
$$;

-- ------------------------------------------------- subcontractor: jobs ---
-- The one question every rule below asks: is this job assigned to the caller,
-- in a business where they are an approved subcontractor?
--
-- "Assigned to them" means assigned to the email they applied with, which is
-- the one the host approved, AND that they are still signed in under it. A
-- login whose email has since been changed matches nothing, so changing an
-- address can never pick up somebody else's jobs.
create or replace function public.sub_can_touch_job(p_job_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    join public.subcontractors s on s.org_id = j.org_id
    where j.id = p_job_id
      and s.user_id = auth.uid()
      and s.status = 'active'
      and s.email <> ''
      and lower(j.assigned_to) = lower(s.email)
      and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Their jobs, with what is not theirs to see blanked: the client's email, the
-- client record, the host's follow-up notes and the message stamps.
create or replace function public.sub_my_jobs()
returns setof public.jobs
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public.jobs j
  join public.subcontractors s on s.org_id = j.org_id
  cross join lateral jsonb_populate_record(null::public.jobs,
    to_jsonb(j) || jsonb_build_object(
      'client_email', '',
      'client_id', null,
      'follow_up', null,
      'comms_opt_out', false,
      'recurring_from_id', null,
      'reminder_sent_for_due_at', null,
      'confirmation_sent_for_at', null,
      'day_before_sent_for_at', null)) r
  where s.user_id = auth.uid()
    and s.status = 'active'
    and s.email <> ''
    and lower(j.assigned_to) = lower(s.email)
    and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Saves one job row sent by the subcontractor's app. Returns the job id when
-- it was stored and null when it was refused (not theirs, or not approved).
--
-- An existing job: only what an inspection changes may be written (status,
-- the inspection date, time, weather and timer, the next-due date the report
-- recommends). The name, address, phone, notes and booking belong to the host,
-- unless the subcontractor created the job themselves.
-- A new job: created in the host's business, assigned to the subcontractor,
-- with no client email and no client record. The host sees it straight away.
create or replace function public.sub_save_job(p jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_id text := nullif(btrim(coalesce(p ->> 'id', '')), '');
  cur public.jobs;
  mine boolean;
  host uuid;
  hosts integer;
begin
  if auth.uid() is null or me_email = '' or v_id is null or char_length(v_id) > 80 then
    return null;
  end if;

  select * into cur from public.jobs where id = v_id;
  if found then
    if not public.sub_can_touch_job(v_id) then return null; end if;
    mine := cur.created_by = auth.uid();
    update public.jobs j set
      status = case when p ? 'status' and btrim(coalesce(p ->> 'status', '')) <> ''
                 then left(p ->> 'status', 30) else j.status end,
      inspection_date = case when p ? 'inspection_date' then left(p ->> 'inspection_date', 20) else j.inspection_date end,
      inspection_time = case when p ? 'inspection_time' then left(p ->> 'inspection_time', 20) else j.inspection_time end,
      weather = case when p ? 'weather' then left(coalesce(p ->> 'weather', ''), 200) else j.weather end,
      inspection_started_at = case when p ? 'inspection_started_at' then (p ->> 'inspection_started_at')::bigint else j.inspection_started_at end,
      inspection_ended_at = case when p ? 'inspection_ended_at' then (p ->> 'inspection_ended_at')::bigint else j.inspection_ended_at end,
      next_due_at = case when p ? 'next_due_at' then (p ->> 'next_due_at')::bigint else j.next_due_at end,
      reinspection_interval_months = case when p ? 'reinspection_interval_months'
                 then (p ->> 'reinspection_interval_months')::integer else j.reinspection_interval_months end,
      -- A plan is adopted from the report only when the host has not set one.
      recurrence_months = case when j.recurrence_months is null and p ? 'recurrence_months'
                 then (p ->> 'recurrence_months')::integer else j.recurrence_months end,
      preferred_document_type = case when p ? 'preferred_document_type'
                 then left(coalesce(p ->> 'preferred_document_type', ''), 60) else j.preferred_document_type end,
      -- Theirs to correct only if they made the job.
      name = case when mine and p ? 'name' and btrim(coalesce(p ->> 'name', '')) <> ''
                 then left(btrim(p ->> 'name'), 200) else j.name end,
      address = case when mine and p ? 'address' then left(coalesce(p ->> 'address', ''), 300) else j.address end,
      address_lat = case when mine and p ? 'address_lat' then (p ->> 'address_lat')::double precision else j.address_lat end,
      address_lng = case when mine and p ? 'address_lng' then (p ->> 'address_lng')::double precision else j.address_lng end,
      notes = case when mine and p ? 'notes' then left(coalesce(p ->> 'notes', ''), 4000) else j.notes end,
      client_phone = case when mine and p ? 'client_phone' then left(coalesce(p ->> 'client_phone', ''), 40) else j.client_phone end,
      scheduled_at = case when mine and p ? 'scheduled_at' then (p ->> 'scheduled_at')::bigint else j.scheduled_at end,
      scheduled_duration_mins = case when mine and p ? 'scheduled_duration_mins'
                 then (p ->> 'scheduled_duration_mins')::integer else j.scheduled_duration_mins end,
      updated_at = greatest(coalesce((p ->> 'updated_at')::bigint, 0), coalesce(j.updated_at, 0))
    where j.id = v_id;
    return v_id;
  end if;

  -- A new job. Which host? The one named, if they are approved there;
  -- otherwise their only host. Never a guess between two.
  select count(*) into hosts from public.subcontractors s
   where s.user_id = auth.uid() and s.status = 'active' and lower(s.email) = me_email;
  if hosts = 0 then return null; end if;
  if nullif(p ->> 'org_id', '') is not null then
    select s.org_id into host from public.subcontractors s
     where s.user_id = auth.uid() and s.status = 'active' and lower(s.email) = me_email
       and s.org_id = (p ->> 'org_id')::uuid;
  elsif hosts = 1 then
    select s.org_id into host from public.subcontractors s
     where s.user_id = auth.uid() and s.status = 'active' and lower(s.email) = me_email;
  end if;
  if host is null then return null; end if;
  if btrim(coalesce(p ->> 'name', '')) = '' then return null; end if;

  insert into public.jobs (
    id, org_id, name, address, address_lat, address_lng, notes, client_phone, client_email,
    status, job_type, inspection_date, inspection_time, weather,
    inspection_started_at, inspection_ended_at, scheduled_at, scheduled_duration_mins,
    preferred_document_type, assigned_to, created_by, created_at, updated_at
  ) values (
    v_id, host, left(btrim(p ->> 'name'), 200), left(coalesce(p ->> 'address', ''), 300),
    (p ->> 'address_lat')::double precision, (p ->> 'address_lng')::double precision,
    left(coalesce(p ->> 'notes', ''), 4000), left(coalesce(p ->> 'client_phone', ''), 40), '',
    left(coalesce(nullif(p ->> 'status', ''), 'new'), 30),
    case when p ->> 'job_type' = 'pest_treatment' then 'pest_treatment' else 'termite' end,
    left(p ->> 'inspection_date', 20), left(p ->> 'inspection_time', 20), left(coalesce(p ->> 'weather', ''), 200),
    (p ->> 'inspection_started_at')::bigint, (p ->> 'inspection_ended_at')::bigint,
    (p ->> 'scheduled_at')::bigint, (p ->> 'scheduled_duration_mins')::integer,
    left(coalesce(p ->> 'preferred_document_type', ''), 60),
    me_email, auth.uid(),
    coalesce((p ->> 'created_at')::bigint, (extract(epoch from now()) * 1000)::bigint),
    coalesce((p ->> 'updated_at')::bigint, (extract(epoch from now()) * 1000)::bigint)
  );
  return v_id;
end;
$$;

-- ----------------------------------- subcontractor: reports and photos ---
-- org_id on these tables defaults to my_org_id(), which is empty for a
-- subcontractor. Left alone, their report would be stored belonging to no
-- business and the host would never see it. So for a signed-in caller who is
-- not a member of any business, the row always takes its job's business, and
-- can never be moved to another.
create or replace function public.sub_fix_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and public.my_org_id() is null then
    if tg_op = 'UPDATE' then
      new.org_id := old.org_id;
    else
      select j.org_id into new.org_id from public.jobs j where j.id = new.job_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sub_fix_org_id on public.reports;
create trigger sub_fix_org_id before insert or update on public.reports
  for each row execute function public.sub_fix_org_id();

drop trigger if exists sub_fix_org_id on public.captures;
create trigger sub_fix_org_id before insert or update on public.captures
  for each row execute function public.sub_fix_org_id();

-- Reports. Written only while the stored copy is not finalised: signing and
-- submitting is the last thing a subcontractor can do to a report until the
-- host sends it back.
drop policy if exists "subcontractor can read own reports" on public.reports;
create policy "subcontractor can read own reports" on public.reports
  for select to authenticated using (public.sub_can_touch_job(job_id));

drop policy if exists "subcontractor can insert own reports" on public.reports;
create policy "subcontractor can insert own reports" on public.reports
  for insert to authenticated with check (public.sub_can_touch_job(job_id));

drop policy if exists "subcontractor can update own open reports" on public.reports;
create policy "subcontractor can update own open reports" on public.reports
  for update to authenticated
  using (public.sub_can_touch_job(job_id) and finalized_at is null)
  with check (public.sub_can_touch_job(job_id));

-- Photos and voice notes of their jobs. No delete: photos are evidence, and
-- deleting one is the host admin's decision, as it already is for technicians.
drop policy if exists "subcontractor can read own captures" on public.captures;
create policy "subcontractor can read own captures" on public.captures
  for select to authenticated using (public.sub_can_touch_job(job_id));

drop policy if exists "subcontractor can insert own captures" on public.captures;
create policy "subcontractor can insert own captures" on public.captures
  for insert to authenticated with check (public.sub_can_touch_job(job_id));

drop policy if exists "subcontractor can update own captures" on public.captures;
create policy "subcontractor can update own captures" on public.captures
  for update to authenticated
  using (public.sub_can_touch_job(job_id))
  with check (public.sub_can_touch_job(job_id));

-- The files behind them. Every object is stored as <job id>/<kind>/<file>.
drop policy if exists "subcontractor can read own media" on storage.objects;
create policy "subcontractor can read own media" on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-media' and public.sub_can_touch_job(split_part(name, '/', 1)));

drop policy if exists "subcontractor can upload own media" on storage.objects;
create policy "subcontractor can upload own media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-media' and public.sub_can_touch_job(split_part(name, '/', 1)));

drop policy if exists "subcontractor can update own media" on storage.objects;
create policy "subcontractor can update own media" on storage.objects
  for update to authenticated
  using (bucket_id = 'inspection-media' and public.sub_can_touch_job(split_part(name, '/', 1)))
  with check (bucket_id = 'inspection-media' and public.sub_can_touch_job(split_part(name, '/', 1)));

-- ------------------------------------------- what the caller is ---
-- Asked by the Edge Functions that used to treat "signed in" as "allowed"
-- (report email, the booking assistant, AI drafting, delivery status). A
-- subcontractor is signed in too, and so is one who was never approved.
-- See supabase/functions/_shared/access.js.
create or replace function public.caller_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'orgId', (select r.org_id from public.user_roles r where r.user_id = auth.uid()),
    'role', (select r.role from public.user_roles r where r.user_id = auth.uid()),
    'activeSubcontractor', exists (
      select 1 from public.subcontractors s
      where s.user_id = auth.uid() and s.status = 'active')
  );
$$;

revoke execute on function public.caller_access() from public, anon;
grant execute on function public.caller_access() to authenticated;

-- ------------------------------------------------------------- grants ---
-- Nothing here is callable by someone who is not signed in.
revoke execute on function public.sub_settings() from public, anon;
revoke execute on function public.sub_settings_save(jsonb) from public, anon;
revoke execute on function public.sub_decide(uuid, text) from public, anon;
revoke execute on function public.sub_roster() from public, anon;
revoke execute on function public.sub_my_hosts() from public, anon;
revoke execute on function public.sub_update_my_profile(uuid, jsonb) from public, anon;
revoke execute on function public.sub_can_touch_job(text) from public, anon;
revoke execute on function public.sub_my_jobs() from public, anon;
revoke execute on function public.sub_save_job(jsonb) from public, anon;
revoke execute on function public.sub_fix_org_id() from public, anon, authenticated;

grant execute on function public.sub_settings() to authenticated;
grant execute on function public.sub_settings_save(jsonb) to authenticated;
grant execute on function public.sub_decide(uuid, text) to authenticated;
grant execute on function public.sub_roster() to authenticated;
grant execute on function public.sub_my_hosts() to authenticated;
grant execute on function public.sub_update_my_profile(uuid, jsonb) to authenticated;
grant execute on function public.sub_can_touch_job(text) to authenticated;
grant execute on function public.sub_my_jobs() to authenticated;
grant execute on function public.sub_save_job(jsonb) to authenticated;

-- --------------------------------------------------------------- check ---
select
  (select count(*) from public.subcontractors)         as subcontractors,
  (select count(*) from public.subcontractor_settings) as businesses_with_a_link,
  (select count(*) from pg_policies where policyname like 'subcontractor can %') as subcontractor_policies;
