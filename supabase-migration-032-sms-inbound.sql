-- 032: text messages coming IN, and who has asked us to stop
--
-- Every reminder we send ends "Reply STOP to opt out." Until now the reply went
-- to the SMS provider's inbox and nothing in Scope ever saw it, so the promise
-- was being made and not kept: somebody could text STOP and be texted again the
-- next day. This is the half that keeps it.
--
-- TWO TABLES, BECAUSE THEY ARE TWO DIFFERENT THINGS.
--
--   comms_opt_outs   WHO we must not contact. A suppression list, keyed by the
--                    person's phone number.
--   sms_inbound      WHAT came in. Every message, STOP or not, so a reply like
--                    "can we move it to 11?" is read by a person instead of
--                    dying in a provider's dashboard.
--
-- OPT-OUT IS KEYED BY NUMBER, NOT BY JOB. jobs.comms_opt_out already exists and
-- is per job, and a new job defaults it back to false. So a client who texted
-- STOP would be texted again the moment they booked their next visit. The
-- suppression list is keyed by the number itself and survives every new job.
--
-- A SECOND REASON IT IS ITS OWN TABLE: jobs.comms_opt_out is overwritten by
-- whichever device last edited the job (sync pushes the whole row), so a flag
-- set on the server can be silently reset to false by an out-of-date phone.
-- Nothing pushes to this table except the endpoint that records a STOP.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.comms_opt_outs (
  id            text primary key,
  -- Normalised E.164 (+614...), so "0412 345 678" and "+61412345678" are the
  -- same person. Normalised by the same function that decides who gets texted.
  phone_e164    text not null,
  source        text not null default 'sms-reply',
  -- What they actually sent, for the day somebody asks "did they really say
  -- stop?". Clipped by the endpoint.
  message       text not null default '',
  provider_message_id text not null default '',
  created_at    bigint not null,
  org_id        uuid references public.organisations(id) on delete cascade
);

-- One row per business per number. A second STOP from somebody already opted
-- out is a no-op, not an error and not a duplicate.
create unique index if not exists comms_opt_outs_org_phone_idx
  on public.comms_opt_outs(org_id, phone_e164);

create table if not exists public.sms_inbound (
  id            text primary key,
  from_e164     text not null default '',
  from_raw      text not null default '',
  body          text not null default '',
  kind          text not null default 'reply',   -- 'stop' | 'reply'
  -- The job id we attached when we sent, handed back on a reply. It is how a
  -- message is tied to a business at all. Null when the provider did not
  -- return one.
  job_id        text,
  provider_message_id text not null default '',
  received_at   bigint not null,
  read_at       bigint,
  org_id        uuid references public.organisations(id) on delete cascade
);

-- The provider retries a webhook it believes failed. Unique on its own message
-- id, so a retry cannot store the same text twice. Blank ids are exempt:
-- several messages with no id are not the same message.
create unique index if not exists sms_inbound_provider_idx
  on public.sms_inbound(provider_message_id) where provider_message_id <> '';

create index if not exists sms_inbound_org_idx    on public.sms_inbound(org_id, received_at desc);
create index if not exists sms_inbound_unread_idx on public.sms_inbound(org_id) where read_at is null;

alter table public.comms_opt_outs alter column org_id set default public.my_org_id();
alter table public.sms_inbound    alter column org_id set default public.my_org_id();

alter table public.comms_opt_outs enable row level security;
alter table public.sms_inbound    enable row level security;

-- Dropped before created, every name, every time. 42710 "policy already
-- exists" has cost this project a round trip twice (016, 023).
drop policy if exists "org can read opt outs"  on public.comms_opt_outs;
drop policy if exists "org can write opt outs" on public.comms_opt_outs;
drop policy if exists "org can read inbound"   on public.sms_inbound;
drop policy if exists "org can mark inbound"   on public.sms_inbound;

create policy "org can read opt outs" on public.comms_opt_outs
  for select using (org_id = public.my_org_id());

-- Insert and delete, because a person can ask to be added by phone ("please
-- don't text me") and can ask to come back ("yes, text me again"). Both are a
-- deliberate act by somebody signed in, which is the point of the toggle in the
-- app. No update: an opt-out is either there or it is not.
create policy "org can write opt outs" on public.comms_opt_outs
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

create policy "org can read inbound" on public.sms_inbound
  for select using (org_id = public.my_org_id());

-- Update only, for marking a message read. Nothing signed in can write a new
-- message or remove one: an inbound log that the business can edit is not much
-- of a record.
create policy "org can mark inbound" on public.sms_inbound
  for update using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- Granted explicitly: RLS decides WHICH rows, a grant decides whether the role
-- may touch the table at all (the 42501 on captures, footage and invoices).
grant select, insert, delete on public.comms_opt_outs to authenticated;
grant select, update         on public.sms_inbound    to authenticated;

-- service_role is what the sms-inbound endpoint and send-client-message run as.
--   comms_opt_outs: SELECT (send-client-message checks it before every send) and
--                   INSERT (the endpoint records a STOP). No UPDATE, no DELETE:
--                   nothing public may reinstate somebody who opted out.
--   sms_inbound:    INSERT only. The endpoint stores what arrived and reads
--                   nothing back, so a stolen link cannot be used to read
--                   anybody's messages.
grant select, insert on public.comms_opt_outs to service_role;
grant insert         on public.sms_inbound    to service_role;

-- jobs.comms_opt_out is flagged by the endpoint on every job with the number, so
-- the app's existing per-job control shows it straight away. service_role has
-- UPDATE on jobs already (migration 009); nothing to grant.

comment on table public.comms_opt_outs is
  'People who have asked us to stop. Keyed by phone number, so it survives a new job. See sms-inbound.';
comment on table public.sms_inbound is
  'Every text message received, STOP or not. Insert-only from the endpoint.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  (select count(*) from public.comms_opt_outs)                          as opt_outs,
  (select count(*) from public.sms_inbound)                             as inbound,
  (select count(*) from public.comms_opt_outs where org_id is null)     as orphaned_opt_outs,
  (select count(*) from public.sms_inbound where org_id is null)        as orphaned_inbound;

select table_name, grantee,
       string_agg(distinct privilege_type, ',' order by privilege_type) filter
         (where privilege_type in ('SELECT','INSERT','UPDATE','DELETE')) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('comms_opt_outs', 'sms_inbound')
  and grantee in ('authenticated', 'service_role', 'anon')
group by table_name, grantee
order by table_name, grantee;
