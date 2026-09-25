-- Explicit, monotonic Admin lifecycle transitions; readiness reuses Step 4 rules.
create or replace function public._contest_voting_readiness(p_contest_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select
    exists (
      select 1 from public.submissions s
      join public.contest_categories cc on cc.id=s.category_id
      join public.contest_participations cp on cp.id=s.participation_id
      where (cc.contest_id=p_contest_id or cp.contest_id=p_contest_id) and s.status='APPROVED'
    )
    and not exists (
      select 1 from public.submissions s
      join public.contest_categories cc on cc.id=s.category_id
      join public.contest_participations cp on cp.id=s.participation_id
      where cc.contest_id=p_contest_id and cp.contest_id=p_contest_id and s.status='PENDING'
    )
    and not exists (
      select 1 from public.submissions s
      join public.contest_categories cc on cc.id=s.category_id
      join public.contest_participations cp on cp.id=s.participation_id
      where (cc.contest_id=p_contest_id or cp.contest_id=p_contest_id)
        and s.status in ('PENDING','APPROVED','REJECTED','WITHDRAWN','CANCELLED')
        and (cc.contest_id<>p_contest_id or cp.contest_id<>p_contest_id)
    )
    and not exists (
      select 1 from public.submissions s
      join public.contest_categories cc on cc.id=s.category_id
      join public.contest_participations cp on cp.id=s.participation_id
      where s.status='APPROVED' and cc.contest_id=p_contest_id and cp.contest_id=p_contest_id
        and (select count(*) from public.submission_media sm
             where sm.submission_id=s.id and sm.status='FINALIZED' and sm.is_current)<>1
    );
$function$;

create or replace function public.admin_close_contest_submissions(p_contest_id uuid)
returns public.contests language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests%rowtype; v_result public.contests; v_auth_user_id uuid:=auth.uid();
begin
  if v_auth_user_id is null or not exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id) then raise exception using errcode='P0001',message='admin_required'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status='SUBMISSIONS_CLOSED' then return v_contest; end if;
  if v_contest.status<>'SUBMISSIONS_OPEN' then raise exception using errcode='P0001',message='invalid_contest_transition'; end if;
  -- Serialize with submission RPCs, which take category row locks.
  perform 1 from public.contest_categories cc where cc.contest_id=p_contest_id order by cc.id for update;
  update public.contests c set status='SUBMISSIONS_CLOSED',updated_at=now() where c.id=p_contest_id returning c.* into v_result;
  return v_result;
end;
$function$;

create or replace function public.admin_start_contest_moderation(p_contest_id uuid)
returns public.contests language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests%rowtype; v_result public.contests; v_auth_user_id uuid:=auth.uid();
begin
  if v_auth_user_id is null or not exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id) then raise exception using errcode='P0001',message='admin_required'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status='MODERATION' then return v_contest; end if;
  if v_contest.status<>'SUBMISSIONS_CLOSED' then raise exception using errcode='P0001',message='invalid_contest_transition'; end if;
  update public.contests c set status='MODERATION',updated_at=now() where c.id=p_contest_id returning c.* into v_result;
  return v_result;
end;
$function$;

create or replace function public.admin_mark_contest_ready_for_voting(p_contest_id uuid)
returns public.contests language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests%rowtype; v_result public.contests; v_auth_user_id uuid:=auth.uid();
begin
  if v_auth_user_id is null or not exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id) then raise exception using errcode='P0001',message='admin_required'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status not in ('MODERATION','READY_FOR_VOTING') then raise exception using errcode='P0001',message='invalid_contest_transition'; end if;
  -- Lock submissions before readiness evaluation to serialize concurrent moderation.
  perform 1 from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id
    join public.contest_participations cp on cp.id=s.participation_id
   where cc.contest_id=p_contest_id or cp.contest_id=p_contest_id order by s.id for update of s;
  if not public._contest_voting_readiness(p_contest_id) then raise exception using errcode='P0001',message='contest_not_ready'; end if;
  if v_contest.status='READY_FOR_VOTING' then return v_contest; end if;
  update public.contests c set status='READY_FOR_VOTING',updated_at=now() where c.id=p_contest_id returning c.* into v_result;
  return v_result;
end;
$function$;

-- Keep Step 4's atomic publication gate; require the explicit READY state.
create or replace function public.open_contest_voting(p_contest_id uuid)
returns public.contests language plpgsql security definer set search_path = ''
as $function$
declare v_auth_user_id uuid:=auth.uid(); v_contest public.contests%rowtype; v_result public.contests;
begin
  if v_auth_user_id is null or not exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id) then raise exception using errcode='P0001',message='admin_required'; end if;
  select c.* into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status='VOTING_OPEN' then return v_contest; end if;
  if v_contest.status<>'READY_FOR_VOTING' then raise exception using errcode='P0001',message='contest_not_ready_state'; end if;
  perform 1 from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id
    join public.contest_participations cp on cp.id=s.participation_id
   where cc.contest_id=p_contest_id or cp.contest_id=p_contest_id order by s.id for update of s;
  if not public._contest_voting_readiness(p_contest_id) then raise exception using errcode='P0001',message='contest_not_ready'; end if;
  insert into public.submission_publications(submission_id,media_id,published_at,published_by_auth_user_id)
  select s.id,sm.id,now(),v_auth_user_id
    from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id
    join public.contest_participations cp on cp.id=s.participation_id
    join public.submission_media sm on sm.submission_id=s.id and sm.status='FINALIZED' and sm.is_current
   where s.status='APPROVED' and cc.contest_id=p_contest_id and cp.contest_id=p_contest_id;
  update public.contests c set status='VOTING_OPEN',updated_at=now() where c.id=p_contest_id returning c.* into v_result;
  return v_result;
end;
$function$;

revoke execute on function public._contest_voting_readiness(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.admin_close_contest_submissions(uuid) from public,anon,service_role;
grant execute on function public.admin_close_contest_submissions(uuid) to authenticated;
revoke execute on function public.admin_start_contest_moderation(uuid) from public,anon,service_role;
grant execute on function public.admin_start_contest_moderation(uuid) to authenticated;
revoke execute on function public.admin_mark_contest_ready_for_voting(uuid) from public,anon,service_role;
grant execute on function public.admin_mark_contest_ready_for_voting(uuid) to authenticated;
revoke execute on function public.open_contest_voting(uuid) from public,anon,service_role;
grant execute on function public.open_contest_voting(uuid) to authenticated;
