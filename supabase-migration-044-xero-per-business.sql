-- 044: one Xero connection per business, and a place to keep the sign-in
-- check (v154, 16 Nov 2026, before Xero was ever connected).
--
-- xero_connections was a single shared row (id 'default'). The function now
-- keys the row by the organisation (id = org_id), and stores the OAuth
-- "state" it hands out so the code Xero sends back can be checked against
-- it. The table had no rows, so nothing moves.
--
-- Still RLS with no policies: only the server function (service_role) can
-- read the tokens. That is restated here so it cannot drift.

alter table public.xero_connections
  add column if not exists oauth_state text,
  add column if not exists oauth_state_at bigint;

alter table public.xero_connections alter column id drop default;

delete from public.xero_connections where id = 'default';

alter table public.xero_connections enable row level security;
revoke all on public.xero_connections from anon, authenticated;
grant select, insert, update, delete on public.xero_connections to service_role;
