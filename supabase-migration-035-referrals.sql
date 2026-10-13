-- 035: the referral register, and knowing when an invoice was paid
--
-- A client who sends someone our way earns $50 off their next service, once
-- the person they referred has PAID for their first job. This is the register
-- of who referred whom and where each one is up to:
--
--   pending   recorded; the referred person has not paid for a job yet
--   earned    they have paid; the $50 is owed to the referrer
--   credited  the $50 is on one of the referrer's invoices (credited_invoice_id)
--   void      cancelled, with a reason. Never deleted: this is money owed to
--             people, and a register that can lose rows is not a register.
--
-- invoices.paid_at: Scope used to learn about payment only from Xero, and only
-- the status at the moment an invoice was sent (always DRAFT), so it never
-- knew anything was paid. v121 asks Xero for the current status, and this
-- column records a payment marked by hand for anything paid outside Xero.
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.referrals (
  id                   text primary key,
  -- Who referred. A pointer, plus the name as it was, so the register still
  -- reads properly if the client record is later deleted.
  referrer_client_id   text references public.clients(id) on delete set null,
  referrer_name        text not null default '',
  -- Who was referred: a client, an enquiry, or both once an enquiry is booked.
  referred_client_id   text references public.clients(id) on delete set null,
  referred_lead_id     text,
  referred_job_id      text,
  referred_name        text not null default '',
  status               text not null default 'pending'
                         check (status in ('pending', 'earned', 'credited', 'void')),
  amount_cents         integer not null default 5000 check (amount_cents >= 0 and amount_cents <= 100000),
  earned_at            bigint,
  earned_invoice_id    text,
  credited_invoice_id  text,
  credited_at          bigint,
  void_reason          text not null default '',
  notes                text not null default '',
  created_by           uuid,
  created_at           bigint not null,
  updated_at           bigint not null,
  org_id               uuid references public.organisations(id) on delete cascade
);

alter table public.referrals alter column org_id set default public.my_org_id();

create index if not exists referrals_org_idx on public.referrals(org_id);
create index if not exists referrals_referrer_idx on public.referrals(referrer_client_id);

do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.referrals set org_id = first_org where org_id is null;
  end if;
end $$;

alter table public.referrals enable row level security;

drop policy if exists "org can read referrals"  on public.referrals;
drop policy if exists "org can write referrals" on public.referrals;

create policy "org can read referrals" on public.referrals
  for select using (org_id = public.my_org_id());

create policy "org can write referrals" on public.referrals
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- No DELETE, to anybody: a referral is voided, never removed. service_role
-- gets nothing; no Edge Function touches this table.
grant select, insert, update on public.referrals to authenticated;
revoke delete, truncate, trigger, references on public.referrals from authenticated;
revoke all on public.referrals from anon;
revoke all on public.referrals from service_role;

alter table public.invoices
  add column if not exists paid_at bigint;

comment on table public.referrals is
  'Referral register: who referred whom, and the $50 credit it earns once the '
  'referred person pays. Voided, never deleted. See supabase-migration-035.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select
  (select count(*) from public.referrals) as referrals,
  (select count(*) from information_schema.columns
     where table_name = 'invoices' and column_name = 'paid_at') as invoices_paid_at;

select table_name, grantee,
       string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'referrals'
group by table_name, grantee
order by grantee;
