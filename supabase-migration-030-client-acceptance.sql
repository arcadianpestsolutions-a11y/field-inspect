-- 030: remote client acceptance
--
-- The Termite Management Action Plan already WAS the quote — it carries the
-- proposed method, the quoted amount, the date the quote lapses, the warranty
-- and its conditions, and a Client Acceptance section with a name, a
-- signature and a date. What it could not do was collect that signature from
-- somebody who was not standing next to the tablet.
--
-- This is that, and only that. There is no payment here and no deposit: the
-- client agrees, and the money is invoiced the way it always was.
--
-- ---------------------------------------------------------------------------
-- THE ACCEPTANCE IS ITS OWN RECORD. IT DOES NOT WRITE INTO THE REPORT.
--
-- The obvious build is to have the portal drop the signature straight into
-- reports.sections.acknowledgement, so the PDF comes out signed. That would
-- mean an endpoint with no login, reachable by anybody holding a link,
-- UPDATING a finalised compliance document. Once that path exists it is the
-- weakest thing in the system and it is attached to the strongest claim the
-- system makes — that a finalised report says what it said when it was
-- signed.
--
-- So the public endpoint can only INSERT here, and the row records what
-- happened rather than altering what was issued. Putting the signature onto
-- the document is a separate, deliberate action taken by the business from
-- inside the app, where there is a logged-in user to attribute it to and an
-- audit trail to carry it. That is what applied_to_report_at records.
--
-- ---------------------------------------------------------------------------
-- WHAT IS KEPT, AND WHY EACH FIELD IS HERE.
--
-- Under the Electronic Transactions Act 2000 (NSW) a signature collected this
-- way stands up on the strength of the evidence around it: that it was the
-- client, that they meant to agree, and that what they agreed to is knowable
-- afterwards. A signature image on its own proves none of that. So:
--
--   token               which credential was used. Links are issued one per
--                       job to one client, so this ties the act to the
--                       message that was sent.
--   report_finalized_at WHICH VERSION was accepted. Quotes get revised. An
--                       acceptance that does not name its version is an
--                       acceptance of nothing in particular.
--   presented           a snapshot of the figures the page actually showed
--                       them — the amount, the method, the warranty. If the
--                       report is later amended, this is still what they saw.
--   ip, user_agent      the ordinary evidentiary bundle every e-signature
--                       service keeps. The portal tells the client plainly
--                       that these are recorded; it is not collected quietly.
--
-- `presented` is a snapshot ON PURPOSE and must never be "improved" into a
-- live lookup of the report. The whole value of it is that it does not change
-- when the report does.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.client_acceptances (
  id                  text primary key,
  job_id              text not null references public.jobs(id) on delete cascade,
  -- Not a foreign key to client_access.token on purpose. The link may be
  -- revoked, or expire and be replaced, long before anybody looks back at
  -- this; the acceptance must outlive the credential that produced it.
  token               text not null default '',
  document_type       text not null default '',
  report_finalized_at bigint,
  accepted_name       text not null,
  -- A PNG data URL, 320x130, the same shape and size the signature pad in the
  -- app produces — so it can be dropped onto the document unchanged rather
  -- than converted at the point it matters most.
  signature           text not null,
  accepted_at         bigint not null,
  presented           jsonb not null default '{}'::jsonb,
  ip                  text not null default '',
  user_agent          text not null default '',
  -- Set when the business pulls this signature onto the report, from inside
  -- the app, as a signed-in user. Null means accepted but not yet on the
  -- document.
  applied_to_report_at bigint,
  -- Set when a revised quote is sent out, so the earlier acceptance is kept
  -- rather than overwritten. What somebody agreed to in March is evidence
  -- even after they agree to something different in April.
  superseded_at       bigint,
  created_at          bigint not null,
  updated_at          bigint not null,
  org_id              uuid references public.organisations(id) on delete cascade
);

alter table public.client_acceptances alter column org_id set default public.my_org_id();

-- One LIVE acceptance per job. A second insert while one stands is refused by
-- the database, not merely by the endpoint — so a client who double-taps, or
-- two tabs open on the same link, cannot produce two acceptances of the same
-- quote. Superseded rows are exempt, which is what lets a revised quote be
-- accepted again without destroying the first answer.
create unique index if not exists client_acceptances_one_live_idx
  on public.client_acceptances(job_id)
  where superseded_at is null;

create index if not exists client_acceptances_org_idx on public.client_acceptances(org_id);

-- Whether this link is ASKING the client to accept, or just showing them
-- their report. Explicit, not inferred from the document type: an action plan
-- is often sent as the record of works already agreed to in person, with the
-- acceptance section already signed in wet ink, and asking a second time
-- muddies which acceptance is the operative one.
alter table public.client_access
  add column if not exists acceptance_requested_at bigint;

do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.client_acceptances set org_id = first_org where org_id is null;
  end if;
end $$;

alter table public.client_acceptances enable row level security;

-- Dropped before created, every name, every time. 42710 "policy already
-- exists" has cost this project a round trip twice (016, 023).
drop policy if exists "org can read client acceptances"  on public.client_acceptances;
drop policy if exists "org can write client acceptances" on public.client_acceptances;

create policy "org can read client acceptances" on public.client_acceptances
  for select using (org_id = public.my_org_id());

create policy "org can write client acceptances" on public.client_acceptances
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- The app reads an acceptance, stamps applied_to_report_at when it puts the
-- signature on the document, and supersedes one when a revised quote goes
-- out. No DELETE: this is evidence, and the way to retire one is to supersede
-- it, which keeps it.
grant select, insert, update on public.client_acceptances to authenticated;

-- ---------------------------------------------------------------------------
-- service_role, which is what the client-portal Edge Function runs as.
--
-- INSERT and SELECT, and deliberately NO UPDATE and NO DELETE. The public
-- endpoint may record an acceptance and may read back the one it recorded, so
-- the page can show "accepted on Tuesday" instead of offering the form again.
-- It cannot alter one and it cannot remove one — so the worst a stolen link
-- can do is accept a quote that was sent to that client anyway, which is
-- visible to the business the moment it happens.
grant select, insert on public.client_acceptances to service_role;

-- The function reads the finalised report to know WHAT it is asking the
-- client to accept: the quoted amount, the warranty, and whether the
-- acceptance section was already signed on site. SELECT only — see the long
-- note at the top about why nothing public updates a report.
grant select on public.reports to service_role;

comment on table public.client_acceptances is
  'A client agreeing to a quote through their own link. Append-only from the '
  'public endpoint; the signature reaches the document only when the business '
  'applies it from inside the app. See supabase/functions/client-portal.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  (select count(*) from public.client_acceptances)                          as acceptances,
  (select count(*) from public.client_acceptances where superseded_at is null) as live,
  (select count(*) from public.client_acceptances where org_id is null)     as orphaned,
  (select count(*) from public.client_access where acceptance_requested_at is not null) as links_asking;

select table_name, grantee,
       string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('client_acceptances', 'reports')
  and grantee = 'service_role'
group by table_name, grantee
order by table_name;
