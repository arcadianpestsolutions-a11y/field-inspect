-- 033: privilege audit - three grants that were missing, and the over-broad ones
--
-- Found by reading the LIVE catalogue and comparing it with what the code actually
-- does, rather than trusting the migrations. This project has been bitten by the
-- same defect before (009, 028): a table, and a policy that says who may use it,
-- but no table-level GRANT, so Postgres refuses with 42501 "permission denied"
-- before row-level security is ever consulted. It fails quietly in places that do
-- not check the error object, which is why none of these were noticed.
--
-- HOW EACH WAS FOUND. For the server: every supabase.from('table') chain in
-- supabase/functions/*/index.ts was parsed for the verbs it uses (select, insert,
-- update, delete) and tested against has_table_privilege('service_role', ...). For
-- the browser: the same over every .js file, tested against 'authenticated'.
--
-- ---------------------------------------------------------------------------
-- A. MISSING. Each of these is a feature that could not work.
-- ---------------------------------------------------------------------------

-- The Business details screen saves with UPDATE on organisations. Migration 022
-- wrote an admin-only write policy ("admin can write organisations") and then
-- granted authenticated only SELECT, so the policy could never apply: every admin's
-- Save failed with 42501. Proved before this fix by impersonating the admin inside
-- a rolled-back transaction. UPDATE only: creating or deleting a business is done
-- server-side, never from the browser, and the policy limits it to admins.
grant update on public.organisations to authenticated;

-- client-portal reads invoice totals for the client's page. Without this the query
-- was refused, the error was not checked, and the portal quietly never showed an
-- invoice. SELECT only: the portal never writes one.
grant select on public.invoices to service_role;

-- The xero function stores and reads the OAuth tokens here and disconnects by
-- deleting the row. Migration 009 granted this and the live database does not have
-- it; nothing in any migration revokes it. Without it, connecting Xero would appear
-- to succeed and then report "not connected". authenticated is deliberately NOT
-- granted (these are live access and refresh tokens; see migration 006).
grant select, insert, update, delete on public.xero_connections to service_role;

-- ---------------------------------------------------------------------------
-- B. TOO BROAD. service_role bypasses row-level security, so whatever it is granted
--    is unprotected by every policy. Nothing below is used by any function.
-- ---------------------------------------------------------------------------

-- Functions only READ these.
revoke insert, update, delete on public.organisations from service_role;
revoke insert, update, delete on public.user_roles    from service_role;
-- send-client-message only INSERTS into the send log.
revoke select, update, delete on public.client_messages from service_role;
-- The tombstone table is used by the browser only.
revoke select, insert, update, delete on public.deletions from service_role;

-- ---------------------------------------------------------------------------
-- C. HYGIENE. Supabase gives anon, authenticated and service_role these on every
--    table by default. None is reachable through the REST API (it only issues
--    SELECT, INSERT, UPDATE and DELETE) and nothing here uses them, but TRUNCATE in
--    particular is NOT governed by row-level security, so it should not be there.
--    Checked first: TRUNCATE appears nowhere in the code or the migrations, and no
--    trigger is created by anything running as these roles.
-- ---------------------------------------------------------------------------
revoke truncate, trigger, references, maintain
  on all tables in schema public
  from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Check it worked. Every row should say ok.
-- ---------------------------------------------------------------------------
with expect(role_name, tbl, privilege, should_have) as (values
  ('authenticated', 'organisations',     'update',   true),
  ('service_role',  'invoices',          'select',   true),
  ('service_role',  'xero_connections',  'select',   true),
  ('service_role',  'xero_connections',  'insert',   true),
  ('service_role',  'xero_connections',  'update',   true),
  ('service_role',  'xero_connections',  'delete',   true),
  ('authenticated', 'xero_connections',  'select',   false),
  ('service_role',  'organisations',     'update',   false),
  ('service_role',  'user_roles',        'insert',   false),
  ('service_role',  'client_messages',   'update',   false),
  ('service_role',  'deletions',         'select',   false),
  ('anon',          'jobs',              'truncate', false),
  ('authenticated', 'jobs',              'truncate', false),
  ('service_role',  'jobs',              'truncate', false),
  -- things that must STILL work after the revokes
  ('service_role',  'organisations',     'select',   true),
  ('service_role',  'client_messages',   'insert',   true),
  ('service_role',  'jobs',              'update',   true),
  ('service_role',  'comms_opt_outs',    'insert',   true),
  ('service_role',  'sms_inbound',       'insert',   true)
)
select role_name, tbl, privilege,
       case when has_table_privilege(role_name, 'public.' || tbl, privilege) = should_have
            then 'ok' else 'WRONG' end as result
from expect
order by result desc, role_name, tbl, privilege;
