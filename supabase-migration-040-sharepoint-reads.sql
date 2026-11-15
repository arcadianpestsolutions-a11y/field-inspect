-- 040: let the SharePoint copy read what it copies.
--
-- sharepoint-files (v141) runs as service_role and reads a job's photos
-- (captures) and its client (clients, for the folder name). Neither table
-- granted service_role SELECT, so the first real run on 15 Nov 2026 found no
-- photos, named the folder after the job instead of the client, reported
-- "copied 0" and raised no error. Read-only: the function never writes to
-- either table.

grant select on public.captures to service_role;
grant select on public.clients to service_role;
