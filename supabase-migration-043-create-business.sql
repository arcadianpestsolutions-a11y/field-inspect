-- 043: one safe way to add a second business.
--
-- Until now there was exactly one organisation and one user, both made by
-- hand. user_roles has no insert policy on purpose (nobody can give
-- themselves a role), so adding a business is a platform-owner act.
--
-- create_business(name, owner email) makes the organisation and makes the
-- named person its first admin. The person must already have a login
-- (invite them from Supabase > Authentication first), and must not already
-- belong to a business: one login, one business.
--
-- Nobody signed in to the app can call this. EXECUTE is taken from everyone,
-- so it runs only as the database owner: from the SQL editor, or through
-- .tools/new-business.ps1.

create or replace function public.create_business(business_name text, owner_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := btrim(coalesce(business_name, ''));
  clean_email text := lower(btrim(coalesce(owner_email, '')));
  owner_id uuid;
  new_org uuid;
begin
  if clean_name = '' then raise exception 'A business name is needed.'; end if;
  if clean_email = '' then raise exception 'The owner''s email is needed.'; end if;

  select u.id into owner_id from auth.users u where lower(u.email) = clean_email;
  if owner_id is null then
    raise exception 'No login exists for %. Invite them in Supabase > Authentication first.', clean_email;
  end if;
  if exists (select 1 from public.user_roles r where r.user_id = owner_id) then
    raise exception '% already belongs to a business.', clean_email;
  end if;
  if exists (select 1 from public.organisations o where lower(o.name) = lower(clean_name)) then
    raise exception 'A business called "%" already exists.', clean_name;
  end if;

  insert into public.organisations (name) values (clean_name) returning id into new_org;
  insert into public.user_roles (user_id, email, role, org_id) values (owner_id, clean_email, 'admin', new_org);
  return new_org;
end;
$$;

revoke execute on function public.create_business(text, text) from public, anon, authenticated;
