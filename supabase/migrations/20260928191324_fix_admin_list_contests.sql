-- Fix composite-row expansion for the Admin Contest listing.
create or replace function public.admin_list_contests()
returns setof public.contests
language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists(
    select 1 from public.admin_users au where au.user_id=auth.uid()
  ) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  return query
  select c.*
  from public.contests c
  order by (c.archived_at is not null), c.created_at desc, c.id desc;
end;
$function$;

revoke execute on function public.admin_list_contests() from public, anon, service_role;
grant execute on function public.admin_list_contests() to authenticated;
