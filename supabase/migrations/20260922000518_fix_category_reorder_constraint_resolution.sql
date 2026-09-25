-- Resolve the deferrable category-order constraint explicitly while the RPC
-- runs with an empty search_path.
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
  set constraints public.contest_categories_contest_display_order_key deferred;
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

revoke execute on function public.admin_reorder_contest_categories(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.admin_reorder_contest_categories(uuid, uuid[]) to authenticated;
