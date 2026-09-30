-- 027: client portal access
--
-- The first thing in Scope that shows data to somebody who is not the
-- business, so the access model is the whole design and is written down here
-- rather than left implied.
--
-- ONE LINK IS ONE JOB, NOT AN ACCOUNT.
-- The obvious build is client logins. That is a password to reset, an account
-- to support and a standing key to everything that client has ever had done,
-- for somebody who looks at this once a year. A link scoped to a single job
-- has a blast radius of a single job: if it leaks — forwarded, sitting in an
-- inbox, logged by a mail server — what leaks is one report the client
-- already had, not a history.
--
-- THE TOKEN IS THE WHOLE CREDENTIAL, so it is treated like one.
-- Unguessable (32 random bytes), expiring by default, revocable at any time,
-- and every use is stamped so an unexpected pattern is visible. Same reasoning
-- as the calendar feed in migration 010, which cannot log in either.
--
-- WHAT IT CAN NEVER REACH.
-- The Edge Function that serves this runs on the service_role key and
-- therefore bypasses row-level security entirely. It must filter by the
-- token's own job_id, and it returns a fixed, minimal shape: the client's own
-- name and address, the visit date, the next due date, a short-lived signed
-- URL for the finalised report, and the invoice total and status. It does not
-- return technician notes, the audit trail, photographs, other jobs at that
-- address, or anything at all belonging to another client.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.client_access (
  token         text primary key,
  job_id        text not null references public.jobs(id) on delete cascade,
  -- Expiring by default. A link that works forever is a credential nobody
  -- ever takes back, and a report is most useful in the weeks after a visit.
  expires_at    bigint not null,
  revoked_at    bigint,
  -- Stamped on every use. Not analytics: it is how somebody notices a link
  -- being opened months later from somewhere unexpected.
  last_seen_at  bigint,
  view_count    integer not null default 0,
  created_by    uuid,
  created_at    bigint not null,
  updated_at    bigint not null,
  org_id        uuid references public.organisations(id) on delete cascade
);

alter table public.client_access alter column org_id set default public.my_org_id();

do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.client_access set org_id = first_org where org_id is null;
  end if;
end $$;

create index if not exists client_access_job_idx on public.client_access(job_id);
create index if not exists client_access_org_idx on public.client_access(org_id);

alter table public.client_access enable row level security;

-- Dropped before created, every name, every time — 42710 has cost this
-- project a round trip twice already.
drop policy if exists "org can read client access"  on public.client_access;
drop policy if exists "org can write client access" on public.client_access;

-- Note there is no policy for anonymous readers, and that is deliberate. The
-- client never touches this table: the Edge Function reads it on the
-- service_role key and hands back only what the portal is allowed to show.
create policy "org can read client access" on public.client_access
  for select using (org_id = public.my_org_id());

create policy "org can write client access" on public.client_access
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

grant select, insert, update, delete on public.client_access to authenticated;

comment on table public.client_access is
  'One row per client link. Scoped to a single job, expiring, revocable. The '
  'token is the entire credential — see supabase/functions/client-portal.';

-- ---------------------------------------------------------------------------
-- Check it worked, and see anything that has been shared.
select
  count(*)                                                as links,
  count(*) filter (where revoked_at is not null)          as revoked,
  count(*) filter (where expires_at < extract(epoch from now()) * 1000) as expired,
  count(*) filter (where org_id is null)                  as orphaned
from public.client_access;
