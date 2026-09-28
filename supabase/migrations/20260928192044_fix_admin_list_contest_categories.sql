-- Fix composite-row expansion for the Admin category listing.
create or replace function public.admin_list_contest_categories(p_contest_id uuid)
returns setof public.contest_categories
language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists(
    select 1 from public.admin_users au where au.user_id=auth.uid()
  ) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  return query
  select cc.*
  from public.contest_categories cc
  where cc.contest_id=p_contest_id
  order by cc.display_order,cc.id;
end;
$function$;

revoke execute on function public.admin_list_contest_categories(uuid) from public, anon, service_role;
grant execute on function public.admin_list_contest_categories(uuid) to authenticated;
