-- Migration 015 — sync which document a report actually is
--
-- WHY
-- A termite job's single report can represent any one of four document
-- types (inspection, action plan, certificate, service record — see
-- DOCUMENT_TYPES in report.js), stamped in report.documentType the moment
-- it's created. This was never added to the reports table, which matters a
-- lot more than a normal missing column: reports.* is REPLACED wholesale
-- on every pull (not merged field-by-field), so any report pulled down on
-- a second device, or rebuilt locally after a reinstall, silently reverted
-- to no document type at all — exactly the kind of thing that makes a
-- certificate quietly start being treated as a standard inspection.
--
-- Found while wiring up email delivery tracking (migration 014) and fixed
-- immediately rather than left for later, given what it actually risks.
--
-- Run once against the live project. Additive and idempotent.

alter table public.reports
  add column if not exists document_type text;

comment on column public.reports.document_type is
  'Which of a job type''s possible documents this report represents (see '
  'DOCUMENT_TYPES in report.js) — e.g. timber_pest_inspection, '
  'termite_certificate. Stamped once at creation and never inferred '
  'afterwards; report.js treats a report''s schema as fixed by this value.';
