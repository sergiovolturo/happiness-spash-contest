-- Per-category submission capacity: public aggregate counters and guarded edits.
-- Existing semantics: PENDING, APPROVED and REJECTED occupy a slot;
-- WITHDRAWN and CANCELLED release it.

drop function if exists public.get_public_contest_categories(uuid);
create function public.get_public_contest_categories(p_contest_id uuid)
returns table(
  id uuid,
  contest_id uuid,
  name text,
  slug text,
  display_order integer,
  submission_cap integer,
  category_definition_id uuid,
  image_path text,
  published_video_count bigint,
  occupied_submission_count bigint,
  available_submission_count bigint
)
language sql security definer set search_path=''
as $$
  select
    cc.id,
    cc.contest_id,
    d.name,
    d.slug,
    cc.display_order,
    cc.submission_cap,
    d.id,
    d.image_path,
    (
      select count(*)
      from public.published_submission_media pm
      where pm.contest_id=cc.contest_id and pm.category_id=cc.id
    ) as published_video_count,
    counts.occupied_submission_count,
    greatest(cc.submission_cap::bigint-counts.occupied_submission_count,0::bigint) as available_submission_count
  from public.contest_categories cc
  join public.contest_category_definitions d on d.id=cc.category_definition_id
  join public.contests c on c.id=cc.contest_id
  cross join lateral (
    select count(*)::bigint as occupied_submission_count
    from public.submissions s
    where s.category_id=cc.id
      and s.status in ('PENDING','APPROVED','REJECTED')
  ) counts
  where cc.contest_id=p_contest_id and cc.is_active and c.archived_at is null and c.status<>'DRAFT'
  order by cc.display_order,cc.id
$$;

create or replace function public.admin_update_contest_category(
  p_category_id uuid,
  p_name text,
  p_slug text,
  p_submission_cap integer,
  p_finalists_count integer,
  p_is_active boolean
)
returns public.contest_categories
language plpgsql security definer set search_path=''
as $function$
declare
  v_contest_id uuid;
  v_contest public.contests%rowtype;
  v_category public.contest_categories%rowtype;
  v_definition public.contest_category_definitions%rowtype;
  v_occupied bigint;
  v_slug text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id=auth.uid()
  ) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  select cc.contest_id into v_contest_id
  from public.contest_categories cc
  where cc.id=p_category_id;
  if not found then raise exception using errcode='P0001',message='category_not_found'; end if;
  select c.* into v_contest
  from public.contests c
  where c.id=v_contest_id
  for update;
  select cc.* into v_category
  from public.contest_categories cc
  where cc.id=p_category_id
  for update;
  if v_contest.id is null then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status not in ('DRAFT','SUBMISSIONS_OPEN') then
    raise exception using errcode='P0001',message='category_configuration_closed';
  end if;
  if nullif(btrim(p_name),'') is null or p_name<>btrim(p_name)
     or p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_submission_cap is null or p_submission_cap<1
     or p_finalists_count is null or p_finalists_count<1
     or p_is_active is null then
    raise exception using errcode='P0001',message='invalid_category_configuration';
  end if;
  select count(*) into v_occupied
  from public.submissions s
  where s.category_id=p_category_id
    and s.status in ('PENDING','APPROVED','REJECTED');
  if p_submission_cap<v_occupied then
    raise exception using errcode='P0001',message='category_cap_below_occupied';
  end if;
  if exists (
    select 1 from public.submissions s
    where s.category_id=p_category_id
      and (p_name is distinct from v_category.name or p_slug is distinct from v_category.slug)
  ) then
    raise exception using errcode='P0001',message='category_identity_has_history';
  end if;
  if p_finalists_count is distinct from v_category.finalists_count and exists (
    select 1 from public.contest_result_snapshots crs where crs.category_id=p_category_id
  ) then
    raise exception using errcode='P0001',message='finalists_count_frozen';
  end if;
  if not p_is_active and exists (
    select 1
    from public.submissions s
    join public.submission_publications sp on sp.submission_id=s.id
    where s.category_id=p_category_id and sp.revoked_at is null
  ) then
    raise exception using errcode='P0001',message='category_has_active_publications';
  end if;
  select d.* into v_definition
  from public.contest_category_definitions d
  where d.id=v_category.category_definition_id
  for update;
  if v_definition.id is null then raise exception using errcode='P0001',message='category_definition_not_found'; end if;
  v_slug:=p_slug;
  update public.contest_category_definitions
  set name=btrim(p_name),slug=v_slug,is_active=p_is_active,
      archived_at=case when p_is_active then null else coalesce(archived_at,now()) end,
      updated_at=now()
  where id=v_definition.id;
  update public.contest_categories
  set name=btrim(p_name),slug=v_slug,submission_cap=p_submission_cap,
      finalists_count=p_finalists_count,is_active=p_is_active,updated_at=now()
  where id=p_category_id
  returning * into v_category;
  return v_category;
end;
$function$;

create or replace function public.admin_update_contest_category_settings(
  p_category_id uuid,
  p_submission_cap integer,
  p_finalists_count integer,
  p_display_order integer
)
returns public.contest_categories
language plpgsql security definer set search_path=''
as $function$
declare
  v_category public.contest_categories%rowtype;
  v_occupied bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id=auth.uid()
  ) then raise exception using errcode='P0001',message='admin_required'; end if;
  select cc.* into v_category
  from public.contest_categories cc
  join public.contests c on c.id=cc.contest_id
  where cc.id=p_category_id and c.status='DRAFT'
  for update;
  if v_category.id is null then raise exception using errcode='P0001',message='category_settings_not_editable'; end if;
  if p_submission_cap is null or p_submission_cap<1 or p_finalists_count is null or p_finalists_count<1 or p_display_order is null or p_display_order<0 then
    raise exception using errcode='P0001',message='invalid_category_configuration';
  end if;
  select count(*) into v_occupied from public.submissions s
  where s.category_id=p_category_id and s.status in ('PENDING','APPROVED','REJECTED');
  if p_submission_cap<v_occupied then raise exception using errcode='P0001',message='category_cap_below_occupied'; end if;
  update public.contest_categories
  set submission_cap=p_submission_cap,finalists_count=p_finalists_count,display_order=p_display_order,updated_at=now()
  where id=p_category_id returning * into v_category;
  return v_category;
end;
$function$;

revoke execute on function public.get_public_contest_categories(uuid) from public,anon,service_role;
grant execute on function public.get_public_contest_categories(uuid) to anon,authenticated;
revoke execute on function public.admin_update_contest_category(uuid,text,text,integer,integer,boolean) from public,anon,service_role;
grant execute on function public.admin_update_contest_category(uuid,text,text,integer,integer,boolean) to authenticated;
revoke execute on function public.admin_update_contest_category_settings(uuid,integer,integer,integer) from public,anon,service_role;
grant execute on function public.admin_update_contest_category_settings(uuid,integer,integer,integer) to authenticated;
