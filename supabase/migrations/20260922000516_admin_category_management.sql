-- Admin-only, integrity-preserving category management.
-- Existing public read surfaces and Contest lifecycle are unchanged.

alter table public.contest_categories
  drop constraint contest_categories_contest_id_display_order_key;

alter table public.contest_categories
  add constraint contest_categories_contest_display_order_key
  unique (contest_id, display_order)
  deferrable initially deferred;

revoke insert, update, delete on table public.contest_categories
  from public, anon, authenticated;

create or replace function public.admin_create_contest_category(
  p_contest_id uuid,
  p_name text,
  p_slug text,
  p_submission_cap integer,
  p_finalists_count integer default 4
)
returns public.contest_categories
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_category public.contest_categories%rowtype;
  v_next_order integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select c.* into v_contest from public.contests c
   where c.id = p_contest_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'contest_not_found'; end if;
  if v_contest.status not in ('DRAFT', 'SUBMISSIONS_OPEN') then
    raise exception using errcode = 'P0001', message = 'category_configuration_closed';
  end if;
  if nullif(btrim(p_name), '') is null or p_name <> btrim(p_name)
     or p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_submission_cap is null or p_submission_cap < 1
     or p_finalists_count is null or p_finalists_count < 1 then
    raise exception using errcode = 'P0001', message = 'invalid_category_configuration';
  end if;
  select coalesce(max(cc.display_order), -1) + 1 into v_next_order
    from public.contest_categories cc where cc.contest_id = p_contest_id;
  insert into public.contest_categories
    (contest_id, name, slug, display_order, submission_cap, finalists_count)
  values (p_contest_id, btrim(p_name), p_slug, v_next_order, p_submission_cap, p_finalists_count)
  returning * into v_category;
  return v_category;
end;
$function$;

create or replace function public.admin_update_contest_category(
  p_category_id uuid,
  p_name text,
  p_slug text,
  p_submission_cap integer,
  p_finalists_count integer,
  p_is_active boolean
)
returns public.contest_categories
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contest_id uuid;
  v_contest public.contests%rowtype;
  v_category public.contest_categories%rowtype;
  v_occupied bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select cc.contest_id into v_contest_id from public.contest_categories cc
   where cc.id = p_category_id;
  if not found then raise exception using errcode = 'P0001', message = 'category_not_found'; end if;
  select c.* into v_contest from public.contests c
   where c.id = v_contest_id for update;
  select cc.* into v_category from public.contest_categories cc
   where cc.id = p_category_id for update;
  if v_contest.status not in ('DRAFT', 'SUBMISSIONS_OPEN') then
    raise exception using errcode = 'P0001', message = 'category_configuration_closed';
  end if;
  if nullif(btrim(p_name), '') is null or p_name <> btrim(p_name)
     or p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_submission_cap is null or p_submission_cap < 1
     or p_finalists_count is null or p_finalists_count < 1
     or p_is_active is null then
    raise exception using errcode = 'P0001', message = 'invalid_category_configuration';
  end if;
  if exists (select 1 from public.submissions s where s.category_id = p_category_id)
     and (p_name is distinct from v_category.name or p_slug is distinct from v_category.slug) then
    raise exception using errcode = 'P0001', message = 'category_identity_has_history';
  end if;
  select count(*) into v_occupied from public.submissions s
   where s.category_id = p_category_id
     and s.status in ('PENDING', 'APPROVED', 'REJECTED');
  if p_submission_cap < v_occupied then
    raise exception using errcode = 'P0001', message = 'category_cap_below_occupied';
  end if;
  if p_finalists_count is distinct from v_category.finalists_count and exists (
    select 1 from public.contest_result_snapshots crs where crs.category_id = p_category_id
  ) then
    raise exception using errcode = 'P0001', message = 'finalists_count_frozen';
  end if;
  if not p_is_active and exists (
    select 1 from public.submissions s
    join public.submission_publications sp on sp.submission_id = s.id
    where s.category_id = p_category_id and sp.revoked_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'category_has_active_publications';
  end if;
  update public.contest_categories cc
     set name = btrim(p_name), slug = p_slug,
         submission_cap = p_submission_cap, finalists_count = p_finalists_count,
         is_active = p_is_active, updated_at = now()
   where cc.id = p_category_id returning * into v_category;
  return v_category;
end;
$function$;

create or replace function public.admin_reorder_contest_categories(
  p_contest_id uuid,
  p_category_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
  v_changed integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  perform 1 from public.contests c where c.id = p_contest_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'contest_not_found'; end if;
  perform 1 from public.contest_categories cc
   where cc.contest_id = p_contest_id order by cc.id for update;
  select count(*) into v_count from public.contest_categories cc where cc.contest_id = p_contest_id;
  if p_category_ids is null
     or cardinality(p_category_ids) <> v_count
     or (select count(distinct x.id) from unnest(p_category_ids) as x(id)) <> v_count
     or exists (
       select 1 from unnest(p_category_ids) as requested(id)
       left join public.contest_categories cc
         on cc.id = requested.id and cc.contest_id = p_contest_id
       where cc.id is null
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_category_order';
  end if;
  set constraints contest_categories_contest_display_order_key deferred;
  with requested as (
    select item.id, (item.ordinality - 1)::integer as new_order
      from unnest(p_category_ids) with ordinality as item(id, ordinality)
  )
  update public.contest_categories cc
     set display_order = requested.new_order, updated_at = now()
    from requested
   where cc.id = requested.id and cc.contest_id = p_contest_id;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$function$;

create or replace function public.admin_delete_contest_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contest_id uuid;
  v_contest public.contests%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select cc.contest_id into v_contest_id from public.contest_categories cc
   where cc.id = p_category_id;
  if not found then raise exception using errcode = 'P0001', message = 'category_not_found'; end if;
  select c.* into v_contest from public.contests c
   where c.id = v_contest_id for update;
  if v_contest.status not in ('DRAFT', 'SUBMISSIONS_OPEN') then
    raise exception using errcode = 'P0001', message = 'category_configuration_closed';
  end if;
  if exists (select 1 from public.submissions s where s.category_id = p_category_id)
     or exists (select 1 from public.contest_votes cv where cv.category_id = p_category_id)
     or exists (select 1 from public.contest_result_snapshots crs where crs.category_id = p_category_id)
     or exists (select 1 from public.contest_finalists cf where cf.category_id = p_category_id)
     or exists (select 1 from public.contest_tie_resolutions ctr where ctr.category_id = p_category_id) then
    raise exception using errcode = 'P0001', message = 'category_has_history';
  end if;
  delete from public.contest_categories cc where cc.id = p_category_id;
end;
$function$;

revoke execute on function public.admin_create_contest_category(uuid, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.admin_create_contest_category(uuid, text, text, integer, integer) to authenticated;
revoke execute on function public.admin_update_contest_category(uuid, text, text, integer, integer, boolean) from public, anon, service_role;
grant execute on function public.admin_update_contest_category(uuid, text, text, integer, integer, boolean) to authenticated;
revoke execute on function public.admin_reorder_contest_categories(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.admin_reorder_contest_categories(uuid, uuid[]) to authenticated;
revoke execute on function public.admin_delete_contest_category(uuid) from public, anon, service_role;
grant execute on function public.admin_delete_contest_category(uuid) to authenticated;
