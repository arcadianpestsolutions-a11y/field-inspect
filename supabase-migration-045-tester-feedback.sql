-- Migration 045: trial businesses — what a tester did, and what they thought.
--
-- A business trialling Scope is marked organisations.tester = true. Only then
-- does the app (tester.js) record which buttons and steps get used, and ask
-- after each finalised report what was liked and what could be better.
-- Arcadian's own business is never marked, so nothing here touches its use.
--
-- WHAT IS RECORDED: button and step names, job ids, document types, the app
-- version and the screen. Never a client's name, address, phone or email —
-- tester.js only sends ids and labels, and the tester is told this on the
-- first day.
--
-- Read by the platform owner through .tools/tester-report.ps1 (service role,
-- across businesses). Inside the app a business sees only its own rows.

alter table public.organisations add column if not exists tester boolean not null default false;

create table if not exists public.tester_activity (
  id           text primary key,
  org_id       uuid not null default public.my_org_id() references public.organisations(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  occurred_at  bigint not null,
  event        text not null check (char_length(event) <= 60),
  job_id       text check (char_length(job_id) <= 80),
  detail       jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 2000),
  app_version  text check (char_length(app_version) <= 20),
  screen       text check (char_length(screen) <= 60)
);
create index if not exists tester_activity_org_time on public.tester_activity (org_id, occurred_at);

create table if not exists public.tester_feedback (
  id             text primary key,
  org_id         uuid not null default public.my_org_id() references public.organisations(id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  created_at     bigint not null,
  job_id         text check (char_length(job_id) <= 80),
  document_type  text check (char_length(document_type) <= 60),
  report_title   text check (char_length(report_title) <= 120),
  rating         smallint check (rating between 1 and 5),
  liked          text check (char_length(liked) <= 4000),
  better         text check (char_length(better) <= 4000),
  app_version    text check (char_length(app_version) <= 20)
);
create index if not exists tester_feedback_org_time on public.tester_feedback (org_id, created_at);

alter table public.tester_activity enable row level security;
alter table public.tester_feedback enable row level security;

drop policy if exists "org reads its trial activity" on public.tester_activity;
drop policy if exists "tester records trial activity" on public.tester_activity;
drop policy if exists "org reads its trial feedback" on public.tester_feedback;
drop policy if exists "tester sends trial feedback" on public.tester_feedback;

create policy "org reads its trial activity" on public.tester_activity
  for select to authenticated using (org_id = public.my_org_id());
-- Only into your own business, as yourself, and only while it is on trial.
create policy "tester records trial activity" on public.tester_activity
  for insert to authenticated with check (
    org_id = public.my_org_id() and user_id = auth.uid()
    and exists (select 1 from public.organisations o where o.id = org_id and o.tester)
  );
create policy "org reads its trial feedback" on public.tester_feedback
  for select to authenticated using (org_id = public.my_org_id());
create policy "tester sends trial feedback" on public.tester_feedback
  for insert to authenticated with check (
    org_id = public.my_org_id() and user_id = auth.uid()
    and exists (select 1 from public.organisations o where o.id = org_id and o.tester)
  );

-- Granted explicitly (see migration 031): RLS picks the rows, a grant decides
-- whether the role may ask at all. No update or delete: a record of a trial
-- is added to, never rewritten.
revoke all on public.tester_activity from anon, authenticated;
revoke all on public.tester_feedback from anon, authenticated;
grant select, insert on public.tester_activity to authenticated;
grant select, insert on public.tester_feedback to authenticated;
grant all on public.tester_activity to service_role;
grant all on public.tester_feedback to service_role;
