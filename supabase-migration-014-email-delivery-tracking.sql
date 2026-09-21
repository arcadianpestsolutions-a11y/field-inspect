-- Migration 014 — did the client actually receive the report/invoice?
--
-- WHY
-- Emailing a report or invoice has always been fire-and-forget: the send
-- either throws (and the technician sees that) or it doesn't, and from
-- that point on nobody knows if it actually arrived, bounced, or landed in
-- spam. Resend hands back an id for every email it sends; this is the one
-- piece of state needed to ask Resend later "what happened to this one" —
-- see the check-email-status Edge Function.
--
-- Run once against the live project. Additive and idempotent.

alter table public.reports
  add column if not exists email_provider_id text,
  add column if not exists emailed_at bigint,
  add column if not exists email_status text;

alter table public.invoices
  add column if not exists email_provider_id text,
  add column if not exists emailed_at bigint,
  add column if not exists email_status text;

comment on column public.reports.email_provider_id is
  'The id Resend returned when this report was last emailed. Used to look '
  'up delivery status on demand via check-email-status — nothing is pushed '
  'here automatically, see that function''s own header for why.';
comment on column public.invoices.email_provider_id is
  'Same as reports.email_provider_id, for an emailed invoice.';
