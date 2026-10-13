-- 034: the inspection agreement, signed by the client before the visit
--
-- A timber pest inspection starts with "About Our Agreement" (section 3 of
-- the report): the scope, what is not covered, the non-invasive limitation,
-- and the client's signature. Until now that signature could only be taken on
-- the day, on the technician's phone, in the client's hallway. This lets the
-- client read and sign it from the booking confirmation, before anybody turns
-- up.
--
-- It is the same machinery as a quote acceptance (030), on purpose. The rules
-- that made that safe are the rules that make this safe:
--
--   * The public endpoint only INSERTS a row. It never touches the report.
--   * The signature reaches the report when the business applies it from
--     inside the app, as a signed-in user, with an audit entry (the app does
--     this by itself on the next sync, so nobody has to remember to).
--   * `presented` snapshots the exact wording the client saw, with its
--     version, so a later change to the wording cannot change what they
--     agreed to.
--
-- What changes:
--   client_acceptances.kind     'quote' (every existing row) or 'agreement'.
--   the one-live index          now one live row per job PER KIND, so a job
--                               could in principle hold both; in practice an
--                               inspection job holds an agreement and an
--                               action-plan job holds a quote.
--   client_access.agreement_requested_at
--                               whether this link is asking for the
--                               agreement. Explicit, like
--                               acceptance_requested_at: a link sent so
--                               somebody can read a finished report must not
--                               put a contract in front of them.
--
-- No new grants: 030 already gave service_role SELECT and INSERT on
-- client_acceptances and authenticated SELECT, INSERT and UPDATE, and the
-- new columns inherit them. Checked at the bottom.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

alter table public.client_acceptances
  add column if not exists kind text not null default 'quote';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_acceptances_kind_check'
  ) then
    alter table public.client_acceptances
      add constraint client_acceptances_kind_check check (kind in ('quote', 'agreement'));
  end if;
end $$;

drop index if exists public.client_acceptances_one_live_idx;
create unique index if not exists client_acceptances_one_live_per_kind_idx
  on public.client_acceptances(job_id, kind)
  where superseded_at is null;

alter table public.client_access
  add column if not exists agreement_requested_at bigint;

comment on column public.client_acceptances.kind is
  'quote: a client accepting a quote (action plan). agreement: a client '
  'signing the timber pest inspection agreement before the visit. See 034.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  (select count(*) from public.client_acceptances where kind = 'quote')     as quotes,
  (select count(*) from public.client_acceptances where kind = 'agreement') as agreements,
  (select count(*) from pg_indexes
     where indexname = 'client_acceptances_one_live_per_kind_idx')          as new_index,
  (select count(*) from pg_indexes
     where indexname = 'client_acceptances_one_live_idx')                   as old_index_gone_if_0,
  (select count(*) from information_schema.columns
     where table_name = 'client_access' and column_name = 'agreement_requested_at') as access_column;

select table_name, grantee,
       string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('client_acceptances', 'client_access')
  and grantee in ('service_role', 'authenticated')
group by table_name, grantee
order by table_name, grantee;
