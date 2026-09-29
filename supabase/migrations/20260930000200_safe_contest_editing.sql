-- Safe Contest editing: lifecycle-aware metadata/windows and category guard.
-- This migration is additive and must be applied independently of prior migrations.

create or replace function public.admin_update_contest(
  p_contest_id uuid,
  p_slug text,
  p_name text,
  p_description text default null
)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_result public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  if nullif(btrim(p_slug),'') is null or btrim(p_slug) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode='P0001',message='invalid_contest_slug';
  end if;
  if nullif(btrim(p_name),'') is null then raise exception using errcode='P0001',message='invalid_contest_name'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status='SUBMISSIONS_OPEN'
     and v_contest.submissions_open_at is not null
     and now() >= v_contest.submissions_open_at then
    raise exception using errcode='P0001',message='contest_configuration_started';
  end if;
  if v_contest.status not in ('DRAFT','SUBMISSIONS_OPEN') then
    raise exception using errcode='P0001',message='contest_not_editable';
  end if;
  update public.contests set slug=lower(btrim(p_slug)),name=btrim(p_name),description=nullif(btrim(p_description),''),updated_at=now()
   where id=p_contest_id returning * into v_result;
  return v_result;
exception when unique_violation then raise exception using errcode='P0001',message='contest_slug_exists';
end;
$function$;

create or replace function public.admin_update_contest_configuration(
  p_contest_id uuid,
  p_slug text,
  p_name text,
  p_description text default null,
  p_submissions_open_at timestamptz default null,
  p_submissions_close_at timestamptz default null,
  p_voting_open_at timestamptz default null,
  p_voting_close_at timestamptz default null
)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_result public.contests;
  v_submissions_started boolean;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  if nullif(btrim(p_slug),'') is null or btrim(p_slug) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode='P0001',message='invalid_contest_slug';
  end if;
  if nullif(btrim(p_name),'') is null then raise exception using errcode='P0001',message='invalid_contest_name'; end if;
  if p_submissions_open_at is null or p_submissions_close_at is null
     or p_voting_open_at is null or p_voting_close_at is null then
    raise exception using errcode='P0001',message='contest_windows_required';
  end if;
  if p_submissions_open_at >= p_submissions_close_at
     or p_submissions_close_at > p_voting_open_at
     or p_voting_open_at >= p_voting_close_at then
    raise exception using errcode='P0001',message='invalid_contest_window_order';
  end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status not in ('DRAFT','SUBMISSIONS_OPEN') then
    raise exception using errcode='P0001',message='contest_configuration_closed';
  end if;
  v_submissions_started := v_contest.status='SUBMISSIONS_OPEN'
    and v_contest.submissions_open_at is not null
    and now() >= v_contest.submissions_open_at;
  if v_submissions_started then
    if p_submissions_open_at is distinct from v_contest.submissions_open_at
       or p_submissions_close_at <= now()
       or p_voting_open_at <= now() then
      raise exception using errcode='P0001',message='contest_configuration_started';
    end if;
  elsif p_submissions_open_at <= now() or p_voting_open_at <= now() then
    raise exception using errcode='P0001',message='contest_dates_retroactive';
  end if;
  update public.contests
     set slug=lower(btrim(p_slug)),name=btrim(p_name),description=nullif(btrim(p_description),''),
         submissions_open_at=p_submissions_open_at,submissions_close_at=p_submissions_close_at,
         voting_open_at=p_voting_open_at,voting_close_at=p_voting_close_at,updated_at=now()
   where id=p_contest_id returning * into v_result;
  return v_result;
exception when unique_violation then raise exception using errcode='P0001',message='contest_slug_exists';
end;
$function$;

create or replace function public.admin_set_submission_window(
  p_contest_id uuid,p_open_at timestamptz,p_close_at timestamptz
)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests%rowtype; v_result public.contests;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  if p_open_at is null or p_close_at is null or p_open_at >= p_close_at then raise exception using errcode='P0001',message='invalid_submission_window'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status not in ('DRAFT','SUBMISSIONS_OPEN') or (v_contest.status='SUBMISSIONS_OPEN' and now() >= coalesce(v_contest.submissions_open_at,now())) then
    raise exception using errcode='P0001',message='contest_window_not_editable';
  end if;
  if p_open_at <= now() or (v_contest.voting_open_at is not null and p_close_at > v_contest.voting_open_at) then
    raise exception using errcode='P0001',message='invalid_submission_window';
  end if;
  update public.contests set submissions_open_at=p_open_at,submissions_close_at=p_close_at,updated_at=now() where id=p_contest_id returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.admin_set_voting_window(
  p_contest_id uuid,p_open_at timestamptz,p_close_at timestamptz
)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests%rowtype; v_result public.contests;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  if p_open_at is null or p_close_at is null or p_open_at >= p_close_at then raise exception using errcode='P0001',message='invalid_voting_window'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status not in ('DRAFT','SUBMISSIONS_OPEN') or (v_contest.status='SUBMISSIONS_OPEN' and now() >= coalesce(v_contest.submissions_open_at,now())) then
    raise exception using errcode='P0001',message='voting_window_not_editable';
  end if;
  if p_open_at <= now() or (v_contest.submissions_close_at is not null and v_contest.submissions_close_at > p_open_at) then
    raise exception using errcode='P0001',message='invalid_voting_window';
  end if;
  update public.contests set voting_open_at=p_open_at,voting_close_at=p_close_at,voting_closed_at=null,voting_close_reason=null,updated_at=now() where id=p_contest_id returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public._guard_contest_category_configuration()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests%rowtype; v_contest_id uuid;
begin
  v_contest_id := coalesce(new.contest_id,old.contest_id);
  select c.* into v_contest from public.contests c where c.id=v_contest_id;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status='DRAFT' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if v_contest.status='SUBMISSIONS_OPEN'
     and v_contest.submissions_open_at is not null
     and now() < v_contest.submissions_open_at then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  raise exception using errcode='P0001',message='category_configuration_closed';
end;
$function$;

drop trigger if exists contest_categories_configuration_guard on public.contest_categories;
create trigger contest_categories_configuration_guard
before insert or update or delete on public.contest_categories
for each row execute function public._guard_contest_category_configuration();

revoke all on function public.admin_update_contest_configuration(uuid,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.admin_update_contest_configuration(uuid,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
revoke all on function public._guard_contest_category_configuration() from public,anon,authenticated,service_role;
revoke all on function public.admin_update_contest(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.admin_update_contest(uuid,text,text,text) to authenticated;
revoke all on function public.admin_set_submission_window(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.admin_set_submission_window(uuid,timestamptz,timestamptz) to authenticated;
revoke all on function public.admin_set_voting_window(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.admin_set_voting_window(uuid,timestamptz,timestamptz) to authenticated;
