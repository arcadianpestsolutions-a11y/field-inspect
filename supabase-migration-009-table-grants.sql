-- Field Inspect — migration 009: table privileges for the later tables
--
-- Run once against the live project. Idempotent, and grants nothing that the
-- existing RLS policies don't already intend to allow.
--
-- THE BUG THIS FIXES
-- jobs and reports (supabase-schema.sql) sync fine. captures and footage
-- (migration 004) and invoices (migration 006) all fail with Postgres error
-- 42501, "permission denied for table captures". That is a GRANT error, not
-- an RLS one — RLS with no matching policy returns an empty result, never a
-- permission error. The tables exist and their policies are correct; the
-- roles simply have no table privileges on them, so PostgREST is refused
-- before RLS is ever consulted.
--
-- Supabase normally handles this through default privileges on the public
-- schema, which is why the first schema file never needed explicit grants.
-- The later migrations landed without picking them up. Rather than guess at
-- which role owned what, this grants explicitly.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS
-- captures is where every inspection photo's metadata lives. Failing to sync
-- it means photos exist on the technician's phone and nowhere else — a lost
-- or wiped handset takes the evidence for those jobs with it. The sync also
-- aborts at the first failing table, so footage, invoices and the media
-- backup pull that follow it never ran either.

-- ---------- The three tables the browser is meant to reach ----------
-- Row visibility is still decided by the existing "team can read/write"
-- policies (authenticated only, see migrations 004 and 006). These grants
-- only restore the table-level privilege that RLS is evaluated on top of.
grant select, insert, update, delete on public.captures to authenticated;
grant select, insert, update, delete on public.footage  to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;

-- anon is deliberately omitted. Every policy on these tables is scoped to
-- authenticated, so a logged-out client has nothing to read regardless, and
-- granting anon would only widen the surface for no gain.

-- ---------- Server-side role ----------
-- The Edge Functions use the service_role key. It bypasses RLS but still
-- needs table privileges, so the same gap would break the Xero function.
grant select, insert, update, delete on public.captures         to service_role;
grant select, insert, update, delete on public.footage          to service_role;
grant select, insert, update, delete on public.invoices         to service_role;
grant select, insert, update, delete on public.xero_connections to service_role;

-- xero_connections is NOT granted to authenticated, on purpose. It holds live
-- Xero OAuth access and refresh tokens. Migration 006 gives it RLS with no
-- policies precisely so the browser can never read them, and only the
-- service_role key inside the Edge Function can. Granting it here would
-- quietly undo that. See the security note in migration 006.

-- ---------- Stop this recurring ----------
-- Future tables created in public by this role inherit the same privileges,
-- so the next migration doesn't reopen the same hole.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
