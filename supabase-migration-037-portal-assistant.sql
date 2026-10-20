-- 037: the client page assistant (chatbot)
--
-- A client on their own report page can ask a question and get an answer
-- from an assistant that knows only what that page already shows them. What
-- it cannot do itself (a call back, a booking, a referral) it writes down for
-- the business. See supabase/functions/_shared/portal-chat.js.
--
-- OFF UNTIL THE BUSINESS TURNS IT ON. organisations.portal_assistant_enabled
-- defaults to false: it answers the business's own clients in the business's
-- name, and costs money per message, so nobody gets it by deploying.
--
-- TWO TABLES:
--   portal_messages   every message, both sides, so the business can read
--                     exactly what its assistant said to its clients.
--   portal_requests   what a person has to act on. Open until marked done.
--
-- WHO WRITES WHAT. The portal-chat Edge Function (service_role) may only
-- INSERT into these two tables and read them. It does not touch leads or the
-- referral register: a referral the assistant collects arrives here as a
-- request, and becomes an enquiry and a register entry only when somebody in
-- the app taps "Add as enquiry" (migration 035: no Edge Function writes the
-- register, and that stays true).
--
-- Run this in the Supabase SQL editor. Safe to run twice.

alter table public.organisations
  add column if not exists portal_assistant_enabled boolean not null default false,
  add column if not exists portal_assistant_notes   text    not null default '';

create table if not exists public.portal_messages (
  id              text primary key,
  job_id          text not null references public.jobs(id) on delete cascade,
  role            text not null check (role in ('client', 'assistant')),
  body            text not null default '',
  -- What answered, for an assistant message: the model the API says served
  -- it and the prompt version, the same stamps analyze-inspection keeps.
  model           text not null default '',
  prompt_version  text not null default '',
  created_at      bigint not null,
  org_id          uuid references public.organisations(id) on delete cascade
);

create index if not exists portal_messages_job_idx on public.portal_messages(job_id, created_at);
create index if not exists portal_messages_org_idx on public.portal_messages(org_id, created_at);

create table if not exists public.portal_requests (
  id              text primary key,
  job_id          text not null references public.jobs(id) on delete cascade,
  kind            text not null check (kind in
                    ('callback', 'booking', 'reschedule', 'question', 'complaint', 'other', 'referral', 'unanswered')),
  summary         text not null default '',
  details         text not null default '',
  preferred_time  text not null default '',
  contact         text not null default '',
  -- For a referral: who was referred, as the client gave it.
  referred        jsonb,
  status          text not null default 'open' check (status in ('open', 'done')),
  -- Set when "Add as enquiry" turns a referral into a lead.
  lead_id         text,
  done_at         bigint,
  done_by         uuid,
  created_at      bigint not null,
  updated_at      bigint not null,
  org_id          uuid references public.organisations(id) on delete cascade
);

create index if not exists portal_requests_org_idx on public.portal_requests(org_id, status, created_at);
create index if not exists portal_requests_job_idx on public.portal_requests(job_id);

alter table public.portal_messages enable row level security;
alter table public.portal_requests enable row level security;

drop policy if exists "org can read portal messages"  on public.portal_messages;
drop policy if exists "org can read portal requests"  on public.portal_requests;
drop policy if exists "org can update portal requests" on public.portal_requests;

create policy "org can read portal messages" on public.portal_messages
  for select using (org_id = public.my_org_id());

create policy "org can read portal requests" on public.portal_requests
  for select using (org_id = public.my_org_id());

create policy "org can update portal requests" on public.portal_requests
  for update using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- Granted explicitly: RLS decides WHICH rows, a grant decides whether the
-- role may touch the table at all, and a missing grant fails as "permission
-- denied" rather than as anything that points here.
--
-- The team reads both and marks requests done. Nobody in the app writes a
-- message: what the assistant and the client said is a record, not a draft.
grant select         on public.portal_messages to authenticated;
grant select, update on public.portal_requests to authenticated;
revoke insert, delete, truncate on public.portal_messages from authenticated;
revoke insert, delete, truncate on public.portal_requests from authenticated;
revoke all on public.portal_messages from anon;
revoke all on public.portal_requests from anon;

-- The Edge Function: read and insert, nothing else.
grant select, insert on public.portal_messages to service_role;
grant select, insert on public.portal_requests to service_role;
revoke update, delete, truncate on public.portal_messages from service_role;
revoke update, delete, truncate on public.portal_requests from service_role;

comment on table public.portal_messages is
  'Client page assistant: every message, both sides. Insert-only for the Edge Function, read-only for the team. See supabase-migration-037.';
comment on table public.portal_requests is
  'Client page assistant: what a person has to act on (call backs, bookings, referrals). See supabase-migration-037.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'organisations'
       and column_name in ('portal_assistant_enabled', 'portal_assistant_notes')) as org_columns,
  (select count(*) from public.portal_messages) as messages,
  (select count(*) from public.portal_requests) as requests;

select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('portal_messages', 'portal_requests')
  and grantee in ('authenticated', 'service_role', 'anon')
group by table_name, grantee
order by table_name, grantee;
