-- 041: two hardening fixes from Supabase's security advisor (16 Nov 2026).
--
-- 1. rls_auto_enable() is an event-trigger function: the database runs it
--    when a table is created. Nobody calls it, yet it was executable by
--    anyone, signed in or not, as a SECURITY DEFINER function. Event triggers
--    do not need the caller to hold EXECUTE, so taking it away changes nothing
--    that works today.
--
-- 2. owns_job(text) had no search_path set, so the names inside it were
--    resolved against whatever the caller's session said. Pinned to public.
--
-- Deliberately NOT changed: is_admin() and my_org_id() are also flagged, but
-- the row-level-security policies call them for every query, so the roles
-- that query need EXECUTE. For someone not signed in they answer false and
-- null, which gives nothing away.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter function public.owns_job(text) set search_path = public;
