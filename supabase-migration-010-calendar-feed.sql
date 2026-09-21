-- Migration 010 — calendar feed token
--
-- WHY
-- Field Inspect has no way to show its bookings on any calendar outside the
-- app itself. This adds the one piece of state needed for a universal fix:
-- a live iCalendar (.ics) feed any calendar app can subscribe to — Google
-- Calendar, Outlook, Apple Calendar — without knowing anything about which
-- one Tal actually uses.
--
-- The feed itself is served by the `calendar-feed` Edge Function, which is
-- deliberately NOT behind Supabase Auth: a calendar app subscribing to a URL
-- cannot log in, so the URL's own unguessable token IS the credential. This
-- table holds that token. Whoever holds the URL can read every booked job's
-- name, address and notes — treat it exactly like a password, and use
-- "Regenerate" if it is ever shared somewhere it shouldn't be.
--
-- Run once against the live project. Additive and idempotent.

create table if not exists public.calendar_feed (
  id text primary key default 'default',  -- single shared team feed, same pattern as xero_connections
  token text not null,
  created_by uuid references auth.users(id),
  created_at bigint,
  updated_at bigint
);

alter table public.calendar_feed enable row level security;

-- Any signed-in technician can see the current token (to copy the link
-- again) and regenerate it (to invalidate a link that leaked). There is
-- nothing here more sensitive than the token itself, which the feed's own
-- design already treats as a shareable secret, not a login credential.
drop policy if exists "team can read calendar feed" on public.calendar_feed;
create policy "team can read calendar feed" on public.calendar_feed
  for select to authenticated using (true);
drop policy if exists "team can write calendar feed" on public.calendar_feed;
create policy "team can write calendar feed" on public.calendar_feed
  for all to authenticated using (true) with check (true);

-- ---------- Table privileges ----------
-- Migration 009 exists because RLS policies alone were never enough on this
-- project — every table since the original schema needed an explicit GRANT
-- or every request came back 42501, permission denied, regardless of how
-- correct the policy above was. That migration also set default privileges
-- for future tables, which should cover this one automatically — but a
-- second explicit grant here costs nothing and removes any doubt.
grant select, insert, update, delete on public.calendar_feed to authenticated;
-- The Edge Function reads this table with the service_role key, since the
-- request that hits it (a calendar app fetching the feed URL) carries no
-- Supabase login at all.
grant select on public.calendar_feed to service_role;
grant select on public.jobs to service_role;
