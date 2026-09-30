-- 024: day-before reminders by SMS
--
-- client_messages was built when email was the only way a client heard from
-- Scope. It records what left the building, and from here some of that leaves
-- as a text message, so a row has to say which. Without it, "did we remind
-- them?" and "what is the SMS bill" are both unanswerable from this table.
--
-- segments is stored because an SMS is billed per 160-character part, not per
-- message. Two reminders that look identical on screen can cost different
-- amounts, and the difference is usually one character that quietly pushed
-- the message out of the 7-bit alphabet. Storing the count is what makes that
-- visible before it shows up on an invoice.
--
-- Run this in the Supabase SQL editor. It is safe to run twice.

alter table public.client_messages
  add column if not exists channel  text not null default 'email',
  add column if not exists segments integer;

-- Dropped before it is added, every time. A bare `add constraint` fails with
-- 42710 on a second run, and this project has already lost a round trip to
-- exactly that in migration 016 and again in 023.
alter table public.client_messages drop constraint if exists client_messages_channel_check;
alter table public.client_messages add  constraint client_messages_channel_check
  check (channel in ('email', 'sms'));

comment on column public.client_messages.channel is
  'How the message left: email or sms. Defaults to email so every row written '
  'before SMS existed stays true.';
comment on column public.client_messages.segments is
  'For sms only: how many 160-character parts the carrier billed for. Null for email.';

-- "What did this cost me last month, and how much of it was the phone bill?"
create index if not exists client_messages_channel_idx
  on public.client_messages(org_id, channel, sent_at);

-- ---------------------------------------------------------------------------
-- Check it worked. Every row should be email, and none should be orphaned.
-- A non-zero orphaned count means an Edge Function wrote a row without
-- stamping org_id, which migration 023 warned about and send-client-message
-- now sets explicitly.
select
  channel,
  count(*)                                  as messages,
  count(*) filter (where org_id is null)    as orphaned
from public.client_messages
group by channel;
