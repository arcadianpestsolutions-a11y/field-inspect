-- Migration 047: how a hand-marked invoice was paid (cash, card, bank
-- transfer). Asked for by the usability test: "Mark as paid" talked only about
-- Xero and had nowhere to say it was cash. Inherits the invoices grants.
alter table public.invoices add column if not exists paid_method text;
alter table public.invoices drop constraint if exists invoices_paid_method_len;
alter table public.invoices add constraint invoices_paid_method_len check (paid_method is null or char_length(paid_method) <= 40);
