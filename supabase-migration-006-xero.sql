-- Field Inspect — migration 006: invoicing + Xero connection
--
-- Run once against the live project. Additive and idempotent.
--
--   public.invoices          — invoice records, synced like jobs and reports.
--   public.xero_connections  — OAuth tokens for the Xero organisation.
--
-- SECURITY NOTE ON xero_connections
-- This table holds live OAuth access and refresh tokens for a real accounting
-- system. RLS is enabled and NO policies are created for it on purpose: with
-- RLS on and no policy, anon and authenticated roles can read nothing at all.
-- Only the service_role key — which lives exclusively inside the Edge
-- Function and is never shipped to the browser — bypasses RLS and can touch
-- these rows. The client can therefore ask the Edge Function to act on Xero,
-- but can never read the tokens themselves, even with a valid login.

create table if not exists public.invoices (
  id text primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  number text,
  issue_date text,
  due_date text,
  client_name text default '',
  client_email text default '',
  property_address text default '',
  reference text default '',
  line_items jsonb not null default '[]'::jsonb,
  gst_registered boolean default true,
  status text default 'draft',            -- draft | sent | paid
  xero_invoice_id text,
  xero_status text,
  created_at bigint not null,
  updated_at bigint not null,
  created_by uuid references auth.users(id)
);

create index if not exists invoices_job_id_idx on public.invoices(job_id);

alter table public.invoices enable row level security;

drop policy if exists "team can read invoices" on public.invoices;
create policy "team can read invoices" on public.invoices
  for select to authenticated using (true);
drop policy if exists "team can write invoices" on public.invoices;
create policy "team can write invoices" on public.invoices
  for all to authenticated using (true) with check (true);

-- ---------- Xero OAuth tokens (service_role only) ----------
create table if not exists public.xero_connections (
  id text primary key default 'default',  -- single shared org connection
  tenant_id text,
  tenant_name text,
  access_token text,
  refresh_token text,
  expires_at bigint,                      -- epoch ms
  connected_by uuid references auth.users(id),
  connected_at bigint,
  updated_at bigint
);

alter table public.xero_connections enable row level security;
-- Deliberately no policies. See the security note above.
