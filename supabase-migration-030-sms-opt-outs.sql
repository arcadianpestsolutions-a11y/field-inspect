-- 030: STOP replies
--
-- Every SMS reminder says "Reply STOP to opt out." Until now a reply landed in
-- the SMS provider's inbox and nowhere else, so the next reminder went out
-- anyway. The sms-inbound Edge Function now receives those replies; this is
-- where it records them.
--
-- TWO THINGS, NOT ONE.
-- jobs.comms_opt_out (migration 019) already suppresses every automated
-- message for a job, and a STOP sets it on that client's existing jobs so the
-- app shows it. But a flag on today's jobs does nothing for the job booked
-- next spring for the same person, and "I told you to stop" does not expire
-- when the job does. So the opt-out is also kept against the PHONE NUMBER, per
-- business, and send-client-message checks it before every send.
--
-- PER BUSINESS. A STOP means "stop texting me from this business". It is
-- recorded against each business that has actually texted that number, and
-- never against one that has not.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.sms_opt_outs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  -- E.164, e.g. +61412345678. The same form reminder-sms.js sends to.
  phone       text not null,
  -- What they actually wrote, kept so "why did we stop texting her?" has an
  -- answer that is not a guess.
  body        text not null default '',
  provider_message_id text,
  created_at  bigint not null,
  unique (org_id, phone)
);

alter table public.sms_opt_outs enable row level security;

-- The business can read its own opt-outs. Nobody but the Edge Function writes
-- them: a technician un-ticking a box in the app must not be able to
-- quietly re-subscribe a client who asked to be left alone.
drop policy if exists "org can read sms opt-outs" on public.sms_opt_outs;
create policy "org can read sms opt-outs" on public.sms_opt_outs
  for select to authenticated using (org_id = public.my_org_id());

-- Grants, both halves (see 028). The app reads; the function reads and writes.
-- No DELETE for anyone: an opt-out is removed by a person looking at it, not
-- by a code path.
grant select on public.sms_opt_outs to authenticated;
grant select, insert, update on public.sms_opt_outs to service_role;

create index if not exists sms_opt_outs_org_idx on public.sms_opt_outs(org_id);

-- Records one STOP for one business and flags that client's existing jobs.
-- Returns how many jobs it flagged.
--
-- A function rather than three round trips from the Edge Function so the
-- opt-out and the flag cannot half-happen. The phone is matched on its last
-- nine digits, because jobs store a number however it was typed ("0412 345
-- 678", "+61 412 345 678") and an Australian mobile is 9 digits once the
-- leading 0 or +61 is gone.
--
-- updated_at is bumped so two-way sync pulls the change down to the phone
-- instead of the app's older copy overwriting it.
create or replace function public.record_sms_opt_out(
  p_org uuid, p_phone text, p_body text, p_message_id text
) returns integer
language plpgsql
as $$
declare
  flagged integer;
  tail text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
begin
  if p_org is null or length(tail) < 9 then
    return 0;
  end if;

  insert into public.sms_opt_outs (org_id, phone, body, provider_message_id, created_at)
  values (p_org, p_phone, coalesce(p_body, ''), p_message_id,
          (extract(epoch from now()) * 1000)::bigint)
  on conflict (org_id, phone) do nothing;

  update public.jobs
     set comms_opt_out = true,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where org_id = p_org
     and comms_opt_out = false
     and right(regexp_replace(coalesce(client_phone, ''), '\D', '', 'g'), 9) = tail;
  get diagnostics flagged = row_count;
  return flagged;
end;
$$;

-- Callable by the Edge Function and nobody else. A function is executable by
-- PUBLIC unless that is revoked, and this one can switch off a client's
-- reminders for any business whose id the caller can name.
revoke all on function public.record_sms_opt_out(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_sms_opt_out(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Check it worked. Expect service_role to hold SELECT, INSERT, UPDATE and
-- authenticated to hold SELECT only.
select
  grantee,
  string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'sms_opt_outs'
  and grantee in ('service_role', 'authenticated')
group by grantee
order by grantee;
