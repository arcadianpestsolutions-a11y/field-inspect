-- 050: the server keeps the promises the reports make (audit, 27-28 Nov 2026).
--
-- v185 stopped the APP deleting a signed report within 3 years. The database
-- still let an admin delete one, removed reports silently along with their job,
-- trusted the phone to keep the audit trail, let any member write the deletion
-- markers that every other phone obeys, and let any member wipe the client
-- list. This closes those, on the server, where a modified app can't skip it.
--
-- 1. A signed report can't be deleted for 3 years from signing (same rule as
--    ReportAssurance.retention in the app), including by deleting its job.
--    The way out matches the app: within a day of signing, and only while it
--    has never been emailed. Chemical-register retention stays in the app.
-- 2. report_events: a server-written, append-only record of every report
--    that is signed, unsigned, emailed, changed after signing, or deleted.
--    Nobody can write to it except the database itself.
-- 3. The audit trail inside a report can only grow: an update that leaves
--    entries out gets them merged back in. Unsigning a report needs a
--    "returned" entry for that signature (report.js returnToSubcontractor).
-- 4. Deletion markers for jobs, reports and invoices: admins only, and never
--    for a report that is being kept. Photo markers: admin or the job's owner.
-- 5. Clients, enquiries, SOPs and safety statements: members add and edit;
--    only an admin or whoever created the record deletes it. created_by can't
--    be rewritten by a later edit. A STOP (comms_opt_outs) is removed only by
--    an admin.
-- 6. is_admin / my_org_id / owns_job can't be called without signing in.
--
-- Safe to run twice.

-- ---------- 1. Signed reports are kept ----------

create or replace function public.report_is_kept_row(p_finalized bigint, p_emailed bigint)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_finalized is not null
    and to_timestamp(p_finalized / 1000.0) + interval '3 years' > now()
    and not (p_emailed is null and (extract(epoch from now()) * 1000) - p_finalized < 86400000);
$$;

create or replace function public.report_is_kept(p_job_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.reports r
    where r.job_id = p_job_id and public.report_is_kept_row(r.finalized_at, r.emailed_at)
  );
$$;

create or replace function public.reports_refuse_kept_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.report_is_kept_row(old.finalized_at, old.emailed_at)
     and coalesce(current_setting('scope.allow_kept_delete', true), '') <> 'on' then
    raise exception 'This report is signed and is kept for 3 years from signing (until %).',
      to_char(to_timestamp(old.finalized_at / 1000.0) + interval '3 years', 'DD Mon YYYY')
      using errcode = 'P0001', hint = 'scope-report-kept';
  end if;
  return old;
end;
$$;

drop trigger if exists reports_refuse_kept_delete on public.reports;
create trigger reports_refuse_kept_delete
  before delete on public.reports
  for each row execute function public.reports_refuse_kept_delete();

-- ---------- 2. report_events (append-only, server-written) ----------

create table if not exists public.report_events (
  id bigint generated always as identity primary key,
  org_id uuid,
  job_id text not null,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  op text not null,
  finalized_at bigint,
  prev_finalized_at bigint,
  emailed_at bigint,
  sections_md5 text,
  audit_entries integer
);
create index if not exists report_events_job on public.report_events (job_id, at);
alter table public.report_events enable row level security;

drop policy if exists "org can read report events" on public.report_events;
create policy "org can read report events" on public.report_events
  for select to authenticated using (org_id = public.my_org_id());

revoke all on public.report_events from anon, authenticated;
grant select on public.report_events to authenticated;
grant all on public.report_events to service_role;

create or replace function public.reports_record_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  op text;
  r public.reports;
begin
  if tg_op = 'DELETE' then
    r := old; op := 'deleted';
  else
    r := new;
    if tg_op = 'INSERT' then
      if new.finalized_at is null then return new; end if;
      op := 'signed';
    elsif new.finalized_at is not null and old.finalized_at is null then
      op := 'signed';
    elsif new.finalized_at is null and old.finalized_at is not null then
      op := 'unsigned';
    elsif new.finalized_at is distinct from old.finalized_at then
      op := 're-signed';
    elsif new.emailed_at is distinct from old.emailed_at and new.emailed_at is not null then
      op := 'emailed';
    elsif old.finalized_at is not null and new.sections is distinct from old.sections then
      op := 'changed after signing';
    else
      return new;  -- drafting: not recorded, or every keystroke would be a row
    end if;
  end if;
  insert into public.report_events
    (org_id, job_id, op, finalized_at, prev_finalized_at, emailed_at, sections_md5, audit_entries)
  values
    (r.org_id, r.job_id, op, r.finalized_at,
     case when tg_op = 'UPDATE' then old.finalized_at end,
     r.emailed_at, md5(coalesce(r.sections::text, '')),
     case when jsonb_typeof(r.audit_log) = 'array' then jsonb_array_length(r.audit_log) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists reports_record_event on public.reports;
create trigger reports_record_event
  after insert or update or delete on public.reports
  for each row execute function public.reports_record_event();

-- ---------- 3. The audit trail only grows; unsigning leaves a reason ----------

create or replace function public.reports_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Merge back any entries the update left out (same key as sync.js mergeAuditLogs).
  if jsonb_typeof(old.audit_log) = 'array' and jsonb_array_length(old.audit_log) > 0 then
    if jsonb_typeof(new.audit_log) is distinct from 'array' then
      new.audit_log := '[]'::jsonb;
    end if;
    select coalesce(jsonb_agg(e order by coalesce((e->>'at')::numeric, 0)), '[]'::jsonb)
      into new.audit_log
      from (
        select distinct on (k) e
        from (
          select e, coalesce(e->>'at','')||'|'||coalesce(e->>'event','')||'|'||coalesce(e->>'sectionId','')
                    ||'|'||coalesce(e->>'fieldId','')||'|'||coalesce(e->>'to','') as k, src
          from (
            select e, 0 as src from jsonb_array_elements(new.audit_log) e
            union all
            select e, 1 as src from jsonb_array_elements(old.audit_log) e
          ) both_logs
          where jsonb_typeof(e) = 'object'
        ) keyed
        order by k, src
      ) merged;
  end if;

  -- Unsigning (report.js returnToSubcontractor) must say why, for this signature.
  if old.finalized_at is not null and new.finalized_at is null
     and coalesce(auth.role(), '') <> 'service_role'
     and not exists (
       select 1 from jsonb_array_elements(coalesce(new.audit_log, '[]'::jsonb)) e
       where e->>'event' = 'returned' and (e->>'of')::numeric = old.finalized_at
     ) then
    raise exception 'A signed report can only be reopened by sending it back with a reason.'
      using errcode = 'P0001', hint = 'scope-report-unsign';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard_update on public.reports;
create trigger reports_guard_update
  before update on public.reports
  for each row execute function public.reports_guard_update();

-- ---------- 4. Who may write deletion markers ----------

create or replace function public.can_mark_deleted(p_table text, p_record text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('jobs', 'reports') then public.is_admin() and not public.report_is_kept(p_record)
    when p_table = 'invoices' then public.is_admin()
    when p_table = 'captures' then public.is_admin()
      or not exists (select 1 from public.captures c where c.id = p_record)
      or exists (
        select 1 from public.captures c join public.jobs j on j.id = c.job_id
        where c.id = p_record and j.org_id = public.my_org_id() and public.owns_job(j.assigned_to)
      )
    else true
  end;
$$;

drop policy if exists "org can write deletions" on public.deletions;
drop policy if exists "org can add deletions" on public.deletions;
drop policy if exists "org can update deletions" on public.deletions;
drop policy if exists "org admin can remove deletions" on public.deletions;
create policy "org can add deletions" on public.deletions
  for insert to authenticated
  with check (org_id = public.my_org_id() and public.can_mark_deleted(table_name, record_id));
create policy "org can update deletions" on public.deletions
  for update to authenticated
  using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id() and public.can_mark_deleted(table_name, record_id));
create policy "org admin can remove deletions" on public.deletions
  for delete to authenticated
  using (org_id = public.my_org_id() and public.is_admin());

-- ---------- 5. Shared lists: add and edit, delete only your own (or admin) ----------

create or replace function public.keep_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.created_by is not null then new.created_by := old.created_by; end if;
  return new;
end;
$$;

do $$
declare
  t text;
  label text;
begin
  foreach t in array array['clients', 'leads', 'sops', 'swms'] loop
    label := case t when 'clients' then 'clients' when 'leads' then 'leads' when 'sops' then 'sops' else 'swms' end;
    execute format('drop policy if exists %I on public.%I', 'org can write ' || label, t);
    execute format('drop policy if exists %I on public.%I', 'org can add ' || label, t);
    execute format('drop policy if exists %I on public.%I', 'org can edit ' || label, t);
    execute format('drop policy if exists %I on public.%I', 'org admin or creator can delete ' || label, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id = public.my_org_id())',
      'org can add ' || label, t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id = public.my_org_id()) with check (org_id = public.my_org_id())',
      'org can edit ' || label, t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id = public.my_org_id() and (public.is_admin() or created_by = auth.uid()))',
      'org admin or creator can delete ' || label, t);
    execute format('drop trigger if exists keep_created_by on public.%I', t);
    execute format('create trigger keep_created_by before update on public.%I for each row execute function public.keep_created_by()', t);
  end loop;
end
$$;

drop policy if exists "org can write opt outs" on public.comms_opt_outs;
drop policy if exists "org can add opt outs" on public.comms_opt_outs;
drop policy if exists "org can edit opt outs" on public.comms_opt_outs;
drop policy if exists "org admin can remove opt outs" on public.comms_opt_outs;
create policy "org can add opt outs" on public.comms_opt_outs
  for insert to authenticated with check (org_id = public.my_org_id());
create policy "org can edit opt outs" on public.comms_opt_outs
  for update to authenticated using (org_id = public.my_org_id()) with check (org_id = public.my_org_id());
create policy "org admin can remove opt outs" on public.comms_opt_outs
  for delete to authenticated using (org_id = public.my_org_id() and public.is_admin());

-- ---------- 6. Helpers need a login ----------

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.my_org_id() from public, anon;
revoke execute on function public.owns_job(text) from public, anon;
revoke execute on function public.report_is_kept(text) from public, anon;
revoke execute on function public.can_mark_deleted(text, text) from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.my_org_id() to authenticated, service_role;
grant execute on function public.owns_job(text) to authenticated, service_role;
grant execute on function public.report_is_kept(text) to authenticated, service_role;
grant execute on function public.can_mark_deleted(text, text) to authenticated, service_role;
-- Trigger functions are never called directly.
revoke execute on function public.reports_record_event() from public, anon, authenticated;
revoke execute on function public.reports_guard_update() from public, anon, authenticated;
revoke execute on function public.reports_refuse_kept_delete() from public, anon, authenticated;
revoke execute on function public.keep_created_by() from public, anon, authenticated;
