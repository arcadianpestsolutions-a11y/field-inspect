-- 036: the SOP library (standard operating procedures), kept the way ISO 9001
-- clause 7.5 ("control of documented information") expects:
--
--   * each procedure has a code, an owner and a version;
--   * a version only counts once it is APPROVED, and the record says who
--     approved it and when;
--   * it is reviewed on a schedule (next_review_at), and a review that
--     changes nothing is recorded too;
--   * staff sign that they have read the version in force (acknowledgements);
--   * superseded versions are kept word for word (history), never overwritten;
--   * a procedure no longer used is RETIRED, never deleted.
--
-- Being able to show all of that is what an auditor looks for. Scope cannot
-- certify anybody; an accredited certification body does that. This is the
-- record that makes the audit straightforward.
--
-- `history` and `acknowledgements` are JSON arrays of entries that each carry
-- their own id, so two phones adding a signature or a review offline merge
-- rather than one replacing the other (sync-merge.js merges id'd lists).
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.sops (
  id                      text primary key,
  code                    text not null default '',
  title                   text not null default '',
  category                text not null default '',
  owner                   text not null default '',
  status                  text not null default 'draft'
                            check (status in ('draft', 'approved', 'retired')),
  version                 integer not null default 0,
  body                    text not null default '',
  change_note             text not null default '',
  review_interval_months  integer not null default 12 check (review_interval_months between 1 and 60),
  approved_at             bigint,
  approved_by             text not null default '',
  last_reviewed_at        bigint,
  last_reviewed_by        text not null default '',
  next_review_at          bigint,
  -- Changes waiting for approval. The approved text above stays in force
  -- until they are approved.
  draft                   jsonb,
  history                 jsonb not null default '[]'::jsonb,
  acknowledgements        jsonb not null default '[]'::jsonb,
  retired_at              bigint,
  retired_reason          text not null default '',
  -- Which starter draft (sop-templates.js) this began as, so the offer to add
  -- the starters does not come back once they are in.
  template_key            text not null default '',
  created_by              uuid,
  created_at              bigint not null,
  updated_at              bigint not null,
  org_id                  uuid references public.organisations(id) on delete cascade
);

alter table public.sops alter column org_id set default public.my_org_id();
create index if not exists sops_org_idx on public.sops(org_id);

do $$
declare first_org uuid;
begin
  if (select count(*) from public.organisations) = 1 then
    select id into first_org from public.organisations limit 1;
    update public.sops set org_id = first_org where org_id is null;
  end if;
end $$;

alter table public.sops enable row level security;

drop policy if exists "org can read sops"  on public.sops;
drop policy if exists "org can write sops" on public.sops;

create policy "org can read sops" on public.sops
  for select using (org_id = public.my_org_id());

create policy "org can write sops" on public.sops
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- No DELETE, to anybody: controlled documents are retired, not removed.
grant select, insert, update on public.sops to authenticated;
revoke delete, truncate, trigger, references on public.sops from authenticated;
revoke all on public.sops from anon;
revoke all on public.sops from service_role;

comment on table public.sops is
  'SOP library: versioned, approved, reviewed and signed-for procedures. '
  'Retired, never deleted. See supabase-migration-036.';

-- ---------------------------------------------------------------------------
-- Check it worked.
select (select count(*) from public.sops) as sops,
       (select relrowsecurity from pg_class where relname = 'sops') as rls,
       (select count(*) from pg_policies where tablename = 'sops') as policies;

select grantee, string_agg(distinct privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'sops'
group by grantee order by grantee;
