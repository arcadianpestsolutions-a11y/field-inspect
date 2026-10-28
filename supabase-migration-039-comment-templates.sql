-- 039: the business's own common comments
--
-- comment-templates.js ships ~110 built-in templates drawn from Tal's past
-- reports. This table holds what the business adds itself, shared by
-- everybody in it (Tal and Kate), plus which built-ins it has chosen to hide.
--
--   kind 'custom'  a template the business wrote (label + text)
--   kind 'hidden'  a built-in the business does not want offered; `label`
--                  is the built-in's label, `text` is empty
--
-- Keyed by the report field the comment box belongs to (field_id).
--
-- Run this in the Supabase SQL editor. Safe to run twice.

create table if not exists public.comment_templates (
  id          text primary key,
  field_id    text not null,
  kind        text not null default 'custom' check (kind in ('custom', 'hidden')),
  label       text not null default '' check (char_length(label) <= 60),
  text        text not null default '' check (char_length(text) <= 2000),
  created_by  uuid,
  created_at  bigint not null,
  updated_at  bigint not null,
  org_id      uuid references public.organisations(id) on delete cascade
);

alter table public.comment_templates alter column org_id set default public.my_org_id();
create index if not exists comment_templates_org_idx on public.comment_templates(org_id, field_id);

alter table public.comment_templates enable row level security;

drop policy if exists "org can read comment templates"  on public.comment_templates;
drop policy if exists "org can write comment templates" on public.comment_templates;
create policy "org can read comment templates" on public.comment_templates
  for select using (org_id = public.my_org_id());
create policy "org can write comment templates" on public.comment_templates
  for all using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

-- Granted explicitly: RLS decides which rows, a grant decides whether the
-- role may touch the table at all.
grant select, insert, update, delete on public.comment_templates to authenticated;
revoke truncate, trigger, references on public.comment_templates from authenticated;
revoke all on public.comment_templates from anon;

comment on table public.comment_templates is
  'The business''s own common comments for report comment boxes, and the built-ins it has hidden. See supabase-migration-039.';

select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'comment_templates' and grantee in ('authenticated', 'anon')
group by table_name, grantee;
