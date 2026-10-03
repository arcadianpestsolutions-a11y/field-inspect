-- 031: errors reported by the app itself
--
-- error-log.js records every uncaught error and unhandled rejection on the
-- device, and sends them here whenever there is a session and a connection.
-- The point is to be able to answer "what actually broke?" without anybody
-- copying text out of a phone: the first real job produced "adding a job
-- wasn't working", which could not be reproduced and left no trace.
--
-- WHAT IS AND IS NOT IN HERE. A message, where it came from, a trimmed stack,
-- the build, the screen and the connection state. Nothing the person typed and
-- nothing from a client or a report — the app cuts messages to 300 characters
-- and stacks to 1200 before they leave the device, and reads nothing but the
-- error object itself.
--
-- INSERT AND SELECT ONLY. A device reporting its own errors has no reason to
-- alter or remove them afterwards, and an error log that can be edited by the
-- thing it is logging is not much of one. The app sends with
-- "on conflict do nothing", so a retry after a half-finished send cannot
-- duplicate a row and never needs UPDATE.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.client_errors (
  id           text primary key,
  occurred_at  bigint not null,
  kind         text not null default '',
  message      text not null default '',
  source       text not null default '',
  line         integer,
  col          integer,
  stack        text not null default '',
  app_version  text not null default '',
  screen       text not null default '',
  online       boolean,
  occurrences  integer not null default 1,
  user_id      uuid,
  user_agent   text not null default '',
  received_at  timestamptz not null default now(),
  org_id       uuid references public.organisations(id) on delete cascade
);

-- The database stamps the owner, not the app — same rule as every table since
-- migration 023. A row can only land in the caller's own business.
alter table public.client_errors alter column org_id set default public.my_org_id();

create index if not exists client_errors_org_idx  on public.client_errors(org_id);
create index if not exists client_errors_when_idx on public.client_errors(occurred_at desc);

alter table public.client_errors enable row level security;

-- Dropped before created, every name, every time. 42710 "policy already
-- exists" has cost this project a round trip twice (016, 023).
drop policy if exists "org can read client errors"   on public.client_errors;
drop policy if exists "org can report client errors" on public.client_errors;

create policy "org can read client errors" on public.client_errors
  for select using (org_id = public.my_org_id());

create policy "org can report client errors" on public.client_errors
  for insert with check (org_id = public.my_org_id());

-- Granted explicitly. RLS decides WHICH rows; a grant decides whether the role
-- may touch the table at all, and forgetting it is what produced the 42501 on
-- captures, footage and invoices. No UPDATE, no DELETE, no service_role: no
-- Edge Function reads this, and reading it from the CLI uses the owner role.
grant select, insert on public.client_errors to authenticated;

comment on table public.client_errors is
  'Uncaught errors reported by the app. Insert-only from the client. See error-log.js.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  (select count(*) from public.client_errors)                   as errors,
  (select count(*) from public.client_errors where org_id is null) as orphaned;

select grantee, string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'client_errors'
  and grantee in ('authenticated', 'service_role', 'anon')
group by grantee order by grantee;
