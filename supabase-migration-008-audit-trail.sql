-- Migration 008 — report audit trail + schema version stamp
--
-- WHY
-- A finalized inspection report is evidence. Until now the app could not
-- answer "was this the answer given on site, or was it changed later?" —
-- because a report row is simply overwritten on every save. These two columns
-- let each report carry its own history:
--
--   audit_log      every field change (old value, new value, who, when, and a
--                  mandatory reason when the report was already finalized),
--                  plus creation and finalization events
--   schema_version which version of the question set the report was answered
--                  against, so later edits to report-schema.js cannot silently
--                  reinterpret an old document
--
-- Both are nullable with sane defaults, so existing rows stay valid and the
-- app keeps working whether or not this has been run — sync.js detects the
-- missing columns and degrades to pushing reports without them.
--
-- RUN THIS with:
--   supabase db push
-- or paste it into the SQL editor in the Supabase dashboard.

alter table public.reports
  add column if not exists audit_log jsonb not null default '[]'::jsonb,
  add column if not exists schema_version integer;

comment on column public.reports.audit_log is
  'Append-only list of change events for this report: field-changed (with from/to and, for post-finalization amendments, a required reason), created, and finalized. Merged as a union across devices by sync.js — never overwritten wholesale, because each device may hold events the others have not seen.';

comment on column public.reports.schema_version is
  'Value of REPORT_SCHEMA_VERSION (report-schema.js) at the time this report was created. Null for reports written before versioning existed.';

-- Amendments made after sign-off are the rows anyone auditing this data will
-- look for first, so make finding them cheap.
create index if not exists reports_audit_log_idx
  on public.reports using gin (audit_log jsonb_path_ops);
