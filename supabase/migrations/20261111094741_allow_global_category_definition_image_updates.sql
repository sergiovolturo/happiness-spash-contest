-- Category definitions are global library records.  Keep the Admin guard and
-- propagate the canonical name/slug to every contest-local association.
create or replace function public.admin_update_category_definition(p_definition_id uuid,p_name text,p_image_path text default null)
returns public.contest_category_definitions
language plpgsql
security definer
set search_path=''
as $$
declare
  d public.contest_category_definitions;
  s text;
begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then
    raise exception 'not_admin';
  end if;
  if nullif(btrim(p_name),'') is null then
    raise exception 'category_name_required';
  end if;
  s:=public.category_definition_slug(p_name);
  if exists(select 1 from public.contest_category_definitions where slug=s and id<>p_definition_id) then
    raise exception 'category_slug_exists';
  end if;
  update public.contest_category_definitions
    set name=btrim(p_name),slug=s,image_path=nullif(btrim(p_image_path),''),updated_at=now()
    where id=p_definition_id
    returning * into d;
  if d.id is null then
    raise exception 'category_definition_not_found';
  end if;
  update public.contest_categories
    set name=d.name,slug=d.slug,updated_at=now()
    where category_definition_id=d.id;
  return d;
end;
$$;
