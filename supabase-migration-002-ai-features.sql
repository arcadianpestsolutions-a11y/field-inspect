-- Field Inspect — migration 002: AI-assisted inspection features
--
-- Run this once against the EXISTING live project (SQL Editor → New query →
-- paste → Run). Additive only — safe to run even if some of these columns
-- already exist, and doesn't touch RLS policies (the existing "team can
-- read/insert/update/delete" policies already cover these new columns since
-- they're not column-scoped).
--
-- Adds:
--   public.jobs.address_lat / address_lng   — geocoded coordinates, captured
--     once when a technician picks an address suggestion, so the aerial
--     mud-map backdrop doesn't need to re-geocode on every device.
--   public.reports.ai_draft                 — AI-generated report draft
--     (transcript + suggested field values + per-timestamp zone notes),
--     text only, no images/video — syncs like the rest of a report.

alter table public.jobs
  add column if not exists address_lat double precision,
  add column if not exists address_lng double precision;

alter table public.reports
  add column if not exists ai_draft jsonb;
