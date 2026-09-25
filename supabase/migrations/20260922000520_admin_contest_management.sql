-- Admin-owned Contest setup. Drafts are not exposed by public read RPCs.
create or replace function public.admin_list_contests()
returns setof public.contests
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001', message='admin_required';
  end if;
  return query select c from public.contests c order by c.created_at desc, c.id desc;
end;
$function$;

create or replace function public.admin_create_contest(p_slug text, p_name text, p_description text default null)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare v_result public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001', message='admin_required';
  end if;
  if nullif(btrim(p_slug),'') is null or btrim(p_slug) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode='P0001', message='invalid_contest_slug';
  end if;
  if nullif(btrim(p_name),'') is null then raise exception using errcode='P0001', message='invalid_contest_name'; end if;
  insert into public.contests(slug,name,description,status)
  values (lower(btrim(p_slug)),btrim(p_name),nullif(btrim(p_description),''),'DRAFT')
  returning * into v_result;
  return v_result;
exception when unique_violation then
  raise exception using errcode='P0001', message='contest_slug_exists';
end;
$function$;

create or replace function public.admin_update_contest(p_contest_id uuid, p_slug text, p_name text, p_description text default null)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests; v_result public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001', message='admin_required'; end if;
  if nullif(btrim(p_slug),'') is null or btrim(p_slug) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception using errcode='P0001', message='invalid_contest_slug'; end if;
  if nullif(btrim(p_name),'') is null then raise exception using errcode='P0001', message='invalid_contest_name'; end if;
  select * into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001', message='contest_not_found'; end if;
  if v_contest.status <> 'DRAFT' then raise exception using errcode='P0001', message='contest_not_editable'; end if;
  update public.contests set slug=lower(btrim(p_slug)),name=btrim(p_name),description=nullif(btrim(p_description),''),updated_at=now()
   where id=p_contest_id returning * into v_result;
  return v_result;
exception when unique_violation then raise exception using errcode='P0001', message='contest_slug_exists';
end;
$function$;

create or replace function public.admin_delete_contest(p_contest_id uuid)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001', message='admin_required'; end if;
  select * into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001', message='contest_not_found'; end if;
  if v_contest.status <> 'DRAFT' then raise exception using errcode='P0001', message='contest_not_deletable'; end if;
  if exists (select 1 from public.contest_categories where contest_id=p_contest_id)
     or exists (select 1 from public.contest_participations where contest_id=p_contest_id)
     or exists (select 1 from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id) then
    raise exception using errcode='P0001', message='contest_not_empty';
  end if;
  delete from public.contests where id=p_contest_id returning * into v_contest;
  return v_contest;
end;
$function$;

create or replace function public.admin_open_contest_submissions(p_contest_id uuid)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests; v_result public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001', message='admin_required'; end if;
  select * into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001', message='contest_not_found'; end if;
  if v_contest.status <> 'DRAFT' then raise exception using errcode='P0001', message='contest_not_openable'; end if;
  if not exists (select 1 from public.contest_categories cc where cc.contest_id=p_contest_id and cc.is_active) then raise exception using errcode='P0001', message='contest_category_required'; end if;
  update public.contests set status='SUBMISSIONS_OPEN',submissions_open_at=coalesce(submissions_open_at,now()),updated_at=now()
   where id=p_contest_id returning * into v_result;
  return v_result;
end;
$function$;

revoke execute on function public.admin_list_contests() from public, anon, service_role;
grant execute on function public.admin_list_contests() to authenticated;
revoke execute on function public.admin_create_contest(text,text,text) from public, anon, service_role;
grant execute on function public.admin_create_contest(text,text,text) to authenticated;
revoke execute on function public.admin_update_contest(uuid,text,text,text) from public, anon, service_role;
grant execute on function public.admin_update_contest(uuid,text,text,text) to authenticated;
revoke execute on function public.admin_delete_contest(uuid) from public, anon, service_role;
grant execute on function public.admin_delete_contest(uuid) to authenticated;
revoke execute on function public.admin_open_contest_submissions(uuid) from public, anon, service_role;
grant execute on function public.admin_open_contest_submissions(uuid) to authenticated;
