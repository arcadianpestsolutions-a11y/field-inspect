-- 049: which optional parts of Scope a business uses ("quiet mode", v174).
--
-- Scope has a screen for everything a pest business might do. A one-person
-- business uses a few of them and was shown all of them. Each optional part
-- is now a switch in Settings (parts.js in the app): invoices, enquiries,
-- followups, referrals, swms, sops, stations, figures, assistant. This column
-- holds the ids a business has switched OFF. Switching a part off only hides
-- its way in; no data is touched.
--
-- A business that exists today keeps everything it has: its list is empty.
-- A business created after this starts with all of them off (the default),
-- and switches on what it uses. create_business (043) inserts the name only,
-- so it picks the default up by itself.
--
-- Nothing else changes: the same row-level rules decide who can read and
-- change the row (only an admin of that business can change it, 022), and a
-- grant on a table covers a column added to it later.
--
-- Safe to run twice: the list is only emptied in the run that adds the column.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organisations' and column_name = 'parts_off'
  ) then
    alter table public.organisations
      add column parts_off text[] not null
      default array['invoices','enquiries','followups','referrals','swms','sops','stations','figures','assistant']::text[];
    update public.organisations set parts_off = '{}'::text[];
  end if;
end
$$;

comment on column public.organisations.parts_off is
  'Ids of the optional parts of Scope this business has switched off (parts.js). Empty = everything on.';
