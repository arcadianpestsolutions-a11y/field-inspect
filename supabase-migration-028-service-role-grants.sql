-- 028: the grant 025-027 forgot
--
-- WHAT WENT WRONG. Migrations 025, 026 and 027 each granted their new table
-- to `authenticated` and stopped there. That is enough for the app, which
-- talks to Postgres as a signed-in user — but Edge Functions run on the
-- service_role key, and a newly created table grants that role nothing.
--
-- So the client-portal function could see public.client_access existed and
-- could not read a row from it: every request answered 42501, which the
-- function correctly turned into "Something went wrong" and which looked
-- from the outside exactly like a broken portal.
--
-- This is the same trap migration 009 exists for, and the same one the 42501
-- on captures, footage and invoices cost a morning to find. RLS decides WHICH
-- rows a role may touch. A grant decides whether it may touch the table at
-- all. Creating a table gives you neither for free.
--
-- WHY THIS IS NOT "GRANT ALL ON EVERYTHING TO service_role".
-- service_role bypasses row-level security completely, so anything it is
-- granted is unprotected by every policy in this database. The existing
-- tables in this project follow least privilege for exactly that reason —
-- public.jobs gives service_role SELECT and UPDATE and nothing else, because
-- reading the diary and stamping a reminder is all any function does with it.
-- So this grants the one table a function actually reads, and the two verbs
-- it actually uses.
--
-- public.swms and public.leads are deliberately NOT granted here. No Edge
-- Function reads either of them; the app syncs both as a signed-in user. When
-- something server-side needs one, it gets its own grant then, named to what
-- it does.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

-- The client-portal function reads the token row, then stamps last_seen_at
-- and view_count on it. SELECT and UPDATE, no INSERT, no DELETE: a link is
-- created and revoked by the business from inside the app, never by the
-- public endpoint that serves it.
grant select, update on public.client_access to service_role;

-- ---------------------------------------------------------------------------
-- Check it worked. Expect client_access to show SELECT and UPDATE for
-- service_role, and swms and leads to show no data privileges for it at all.
select
  table_name,
  grantee,
  string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('client_access', 'swms', 'leads')
  and grantee = 'service_role'
group by table_name, grantee
order by table_name;
