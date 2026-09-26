-- Migration 019 — automated client messages, and the record of every one sent
--
-- WHY
-- Until now every email to a client was a technician deciding, one job at a
-- time, to press send. Automated comms removes the person from that loop, and
-- that changes the risk completely: a bug no longer sends one wrong email, it
-- sends four hundred. Everything below exists because of that difference.
--
-- THREE PROTECTIONS, all enforced in the database rather than the app:
--
--   1. OPT-OUT IS A COLUMN, NOT A UI STATE. comms_opt_out is checked by the
--      Edge Function before every send. A client who has asked not to be
--      contacted cannot be emailed by a buggy client app, a stale cached
--      build, or a scheduled job nobody is watching.
--
--   2. EVERY SEND IS RECORDED. client_messages is written after a confirmed
--      successful send, with who triggered it. Without this there is no way
--      to answer "did we email this person, and when" — which is the first
--      question asked when a client complains.
--
--   3. SENDING IS DEDUPED BY WHAT IT IS ABOUT, not by time. A booking
--      confirmation is recorded against the scheduled time it confirms, so
--      rescheduling correctly sends a new one and tapping save twice does
--      not.
--
-- NOTE ON THE RECIPIENT ADDRESS. The app never tells the server who to email.
-- It sends a job id; the Edge Function reads client_email from that row
-- itself. That is deliberate — it means no caller can point a client's
-- details at an address of its choosing, and it is why there is no
-- "recipient" input anywhere in this design.
--
-- Run once against the live project. Additive and idempotent.

-- --------------------------------------------------------------- jobs ---

alter table public.jobs
  -- Australian Spam Act 2003: a commercial message needs a functional
  -- unsubscribe. The reminder emails carry a List-Unsubscribe mailto header
  -- and a visible line; when a client uses either, this is the flag that
  -- honours it. Default false = no opt-out recorded, which is the correct
  -- starting state for an existing customer.
  add column if not exists comms_opt_out boolean not null default false,

  -- Dedupe stamps. Each holds the scheduled_at value the message was sent
  -- ABOUT, so a rescheduled job legitimately gets a fresh message while a
  -- double-tap gets nothing.
  add column if not exists confirmation_sent_for_at bigint,
  add column if not exists day_before_sent_for_at bigint;

comment on column public.jobs.comms_opt_out is
  'Client has asked not to receive automated email. Checked server-side '
  'before every automated send, so no client-side bug can override it.';

-- ---------------------------------------------------- client_messages ---

create table if not exists public.client_messages (
  id           text primary key,
  job_id       text references public.jobs(id) on delete cascade,
  kind         text not null check (kind in (
                 'booking_confirmation', 'day_before', 'report_ready', 'due_reminder')),
  recipient    text not null,
  subject      text,
  sent_at      bigint not null,
  provider_id  text,
  status       text not null default 'sent',
  triggered_by uuid
);

comment on table public.client_messages is
  'One row per automated message actually sent to a client. Written after a '
  'confirmed send, never before, so this table is a record of what left the '
  'building rather than what was attempted.';

-- The two questions this table gets asked: "what did we send this client"
-- and "what went out recently".
create index if not exists client_messages_job_idx     on public.client_messages(job_id);
create index if not exists client_messages_sent_at_idx on public.client_messages(sent_at);

alter table public.client_messages enable row level security;

-- Readable by the team: a technician answering a client who says "I never
-- got anything" needs to see what was sent. Writes come from the Edge
-- Function under service_role, never from the app, so there is deliberately
-- no insert policy for authenticated users — a send that did not go through
-- the function cannot fake a row saying it did.
drop policy if exists "team can read client messages" on public.client_messages;
create policy "team can read client messages" on public.client_messages
  for select to authenticated using (true);

grant select on public.client_messages to authenticated;
grant select, insert, update, delete on public.client_messages to service_role;

-- --------------------------------------------------------------- check ---
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name in ('comms_opt_out','confirmation_sent_for_at','day_before_sent_for_at')
  ) as new_job_columns,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'client_messages'
  ) as client_messages_table;
