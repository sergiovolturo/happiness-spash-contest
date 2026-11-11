-- Image-only edits are safe for definitions used by historical Contests.
-- Canonical name/slug edits still require every attached Contest to be in the
-- same configuration window enforced by contest_categories' trigger.
create or replace function public.admin_update_category_definition(p_definition_id uuid,p_name text,p_image_path text default null)
returns public.contest_category_definitions
language plpgsql
security definer
set search_path=''
as $$
declare
  d public.contest_category_definitions;
  s text;
  canonical_name text;
  identity_changed boolean;
begin
  if not exists(select 1 from public.admin_users where user_id=auth.uid()) then
    raise exception 'not_admin';
  end if;
  canonical_name:=nullif(btrim(p_name),'');
  if canonical_name is null then
    raise exception 'category_name_required';
  end if;
  s:=public.category_definition_slug(canonical_name);
  if exists(select 1 from public.contest_category_definitions where slug=s and id<>p_definition_id) then
    raise exception 'category_slug_exists';
  end if;
  select * into d
    from public.contest_category_definitions
    where id=p_definition_id
    for update;
  if d.id is null then
    raise exception 'category_definition_not_found';
  end if;
  identity_changed:=d.name is distinct from canonical_name or d.slug is distinct from s;
  if identity_changed and exists(
    select 1
      from public.contest_categories cc
      join public.contests c on c.id=cc.contest_id
     where cc.category_definition_id=d.id
       and not (
         c.status='DRAFT'
         or (c.status='SUBMISSIONS_OPEN' and c.submissions_open_at is not null and now()<c.submissions_open_at)
       )
  ) then
    raise exception 'category_definition_rename_not_allowed';
  end if;
  update public.contest_category_definitions
     set name=canonical_name,
         slug=s,
         image_path=nullif(btrim(p_image_path),''),
         updated_at=now()
   where id=d.id
   returning * into d;
  if identity_changed then
    update public.contest_categories
       set name=d.name,slug=d.slug,updated_at=now()
     where category_definition_id=d.id;
  end if;
  return d;
end;
$$;
