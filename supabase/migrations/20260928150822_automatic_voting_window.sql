-- Automatic per-contest voting windows.
-- The existing submission window and per-category caps remain authoritative.

alter table public.contests
  add column if not exists voting_closed_at timestamptz,
  add column if not exists voting_close_reason text;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contests'::regclass
      and conname = 'contests_voting_close_reason_valid'
  ) then
    alter table public.contests
      add constraint contests_voting_close_reason_valid
      check (voting_close_reason is null or voting_close_reason in ('DEADLINE','MANUAL'));
  end if;
end;
$migration$;

create or replace function public.admin_set_voting_window(
  p_contest_id uuid,
  p_open_at timestamptz,
  p_close_at timestamptz
)
returns public.contests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result public.contests;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if p_open_at is null or p_close_at is null or p_open_at >= p_close_at then
    raise exception using errcode = 'P0001', message = 'invalid_voting_window';
  end if;
  if not exists (
    select 1 from public.contests c
    where c.id = p_contest_id
      and c.status = 'DRAFT'
      and (c.submissions_close_at is null or c.submissions_close_at <= p_open_at)
  ) then
    raise exception using errcode = 'P0001', message = 'voting_window_not_editable';
  end if;
  update public.contests
     set voting_open_at = p_open_at,
         voting_close_at = p_close_at,
         voting_closed_at = null,
         voting_close_reason = null,
         updated_at = now()
   where id = p_contest_id
   returning * into v_result;
  return v_result;
end;
$function$;

revoke all on function public.admin_set_voting_window(uuid,timestamptz,timestamptz) from public, anon, service_role;
grant execute on function public.admin_set_voting_window(uuid,timestamptz,timestamptz) to authenticated;

create or replace function public._open_contest_voting_if_ready(
  p_contest_id uuid,
  p_published_by_auth_user_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
begin
  select c.* into v_contest
    from public.contests c
   where c.id = p_contest_id
   for update;
  if not found or v_contest.status <> 'READY_FOR_VOTING' then return false; end if;
  if v_contest.voting_open_at is null or v_contest.voting_close_at is null
     or now() < v_contest.voting_open_at or now() >= v_contest.voting_close_at then
    return false;
  end if;

  perform 1 from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
    join public.contest_participations cp on cp.id = s.participation_id
   where cc.contest_id = p_contest_id or cp.contest_id = p_contest_id
   order by s.id for update of s;
  if not public._contest_voting_readiness(p_contest_id) then return false; end if;

  insert into public.submission_publications(submission_id, media_id, published_at, published_by_auth_user_id)
  select s.id, sm.id, now(), p_published_by_auth_user_id
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
    join public.contest_participations cp on cp.id = s.participation_id
    join public.submission_media sm on sm.submission_id = s.id
      and sm.status = 'FINALIZED' and sm.is_current
   where s.status = 'APPROVED'
     and cc.contest_id = p_contest_id
     and cp.contest_id = p_contest_id
     and not exists (
       select 1 from public.submission_publications sp
       where sp.submission_id = s.id and sp.media_id = sm.id and sp.revoked_at is null
     );

  update public.contests
     set status = 'VOTING_OPEN', updated_at = now()
   where id = p_contest_id and status = 'READY_FOR_VOTING';
  return found;
end;
$function$;

create or replace function public.open_contest_voting(p_contest_id uuid)
returns public.contests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_result public.contests;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if not public._open_contest_voting_if_ready(p_contest_id, v_auth_user_id) then
    select c.* into v_result from public.contests c where c.id = p_contest_id;
    if not found then raise exception using errcode = 'P0001', message = 'contest_not_found'; end if;
    if v_result.status <> 'READY_FOR_VOTING' then
      raise exception using errcode = 'P0001', message = 'contest_not_ready_state';
    end if;
    if v_result.voting_open_at is null or v_result.voting_close_at is null
       or now() < v_result.voting_open_at then
      raise exception using errcode = 'P0001', message = 'voting_not_open';
    end if;
    raise exception using errcode = 'P0001', message = 'contest_not_ready';
  end if;
  select c.* into v_result from public.contests c where c.id = p_contest_id;
  return v_result;
end;
$function$;

revoke execute on function public.open_contest_voting(uuid) from public, anon, service_role;
grant execute on function public.open_contest_voting(uuid) to authenticated;
revoke execute on function public._open_contest_voting_if_ready(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.admin_mark_contest_ready_for_voting(p_contest_id uuid)
returns public.contests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_result public.contests;
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select c.* into v_contest from public.contests c where c.id = p_contest_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'contest_not_found'; end if;
  if v_contest.status not in ('MODERATION','READY_FOR_VOTING') then
    raise exception using errcode = 'P0001', message = 'invalid_contest_transition';
  end if;
  if v_contest.voting_open_at is null or v_contest.voting_close_at is null
     or v_contest.voting_open_at >= v_contest.voting_close_at
     or v_contest.submissions_close_at is null
     or v_contest.submissions_close_at > v_contest.voting_open_at then
    raise exception using errcode = 'P0001', message = 'voting_window_required';
  end if;
  perform 1 from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
    join public.contest_participations cp on cp.id = s.participation_id
   where cc.contest_id = p_contest_id or cp.contest_id = p_contest_id
   order by s.id for update of s;
  if not public._contest_voting_readiness(p_contest_id) then
    raise exception using errcode = 'P0001', message = 'contest_not_ready';
  end if;
  if v_contest.status = 'READY_FOR_VOTING' then return v_contest; end if;
  update public.contests set status = 'READY_FOR_VOTING', updated_at = now()
   where id = p_contest_id returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.cast_contest_vote(p_submission_id uuid, p_category_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_email_hash text;
  v_voter_identity_id uuid;
  v_contest_id uuid;
  v_vote_id uuid;
begin
  if v_auth_user_id is null then raise exception using errcode = 'P0001', message = 'email_verification_required'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u
   where u.id = v_auth_user_id and u.email_confirmed_at is not null;
  if v_email is null then raise exception using errcode = 'P0001', message = 'email_not_verified'; end if;
  select cc.contest_id into v_contest_id from public.submissions s
   join public.contest_categories cc on cc.id = s.category_id
   where s.id = p_submission_id and s.category_id = p_category_id;
  if v_contest_id is null then raise exception using errcode = 'P0001', message = 'submission_category_mismatch'; end if;
  if not exists (
    select 1 from public.contests c
     where c.id = v_contest_id and c.status = 'VOTING_OPEN'
       and (
         (c.voting_open_at is not null and c.voting_close_at is not null
          and now() >= c.voting_open_at and now() < c.voting_close_at)
         or (c.voting_open_at is null and c.voting_close_at is null)
       )
  ) then raise exception using errcode = 'P0001', message = 'voting_not_open'; end if;
  if not exists (
    select 1 from public.submission_publications sp
    join public.submission_media sm on sm.id = sp.media_id
    where sp.submission_id = p_submission_id and sp.revoked_at is null
      and sm.status = 'FINALIZED' and sm.is_current
  ) then raise exception using errcode = 'P0001', message = 'submission_not_public'; end if;
  v_email_hash := encode(extensions.digest(v_email, 'sha256'::text), 'hex');
  insert into public.verified_voter_identities(verification_method, auth_user_id, email_hash, email_verified_at)
    values ('EMAIL_OTP', v_auth_user_id, v_email_hash, now())
    on conflict (email_hash) where email_hash is not null do update
      set auth_user_id = excluded.auth_user_id, email_verified_at = excluded.email_verified_at,
          status = 'VERIFIED', updated_at = now()
    returning id into v_voter_identity_id;
  begin
    insert into public.contest_votes(voter_identity_id, submission_id, category_id)
      values (v_voter_identity_id, p_submission_id, p_category_id)
      returning id into v_vote_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'vote_already_cast';
  end;
  return v_vote_id;
end;
$function$;

create or replace function public.close_contest_voting(p_contest_id uuid)
returns public.contests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_result public.contests;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then raise exception using errcode = 'P0001', message = 'admin_required'; end if;
  update public.contests
     set status = 'VOTING_CLOSED', voting_closed_at = coalesce(voting_closed_at, now()),
         voting_close_reason = coalesce(voting_close_reason, 'MANUAL'), updated_at = now()
   where id = p_contest_id and status = 'VOTING_OPEN'
   returning * into v_result;
  if not found then raise exception using errcode = 'P0001', message = 'contest_not_voting_open'; end if;
  return v_result;
end;
$function$;

create or replace function public.process_contest_voting_windows()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed integer := 0;
  v_contest record;
begin
  update public.contests
     set status = 'VOTING_CLOSED', voting_closed_at = coalesce(voting_closed_at, now()),
         voting_close_reason = coalesce(voting_close_reason, 'DEADLINE'), updated_at = now()
   where status = 'VOTING_OPEN' and voting_close_at is not null and voting_close_at <= now();
  get diagnostics v_changed = row_count;
  for v_contest in
    select id from public.contests
     where status = 'READY_FOR_VOTING'
       and voting_open_at is not null and voting_close_at is not null
       and voting_open_at <= now() and voting_close_at > now()
  loop
    if public._open_contest_voting_if_ready(v_contest.id, null) then v_changed := v_changed + 1; end if;
  end loop;
  return v_changed;
end;
$function$;

revoke all on function public.process_contest_voting_windows() from public, anon, authenticated, service_role;
revoke all on function public._open_contest_voting_if_ready(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.cast_contest_vote(uuid,uuid) from public, anon, service_role;
grant execute on function public.cast_contest_vote(uuid,uuid) to authenticated;
revoke all on function public.close_contest_voting(uuid) from public, anon, service_role;
grant execute on function public.close_contest_voting(uuid) to authenticated;

drop function if exists public.admin_list_contests();
create or replace function public.admin_list_contests()
returns table (
  id uuid, slug text, name text, description text, status public.contest_status,
  configuration_version integer, configuration jsonb,
  submissions_open_at timestamptz, submissions_close_at timestamptz,
  voting_open_at timestamptz, voting_close_at timestamptz,
  voting_closed_at timestamptz, voting_close_reason text,
  created_by uuid, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then raise exception using errcode = 'P0001', message = 'admin_required'; end if;
  return query select c.id,c.slug,c.name,c.description,c.status,c.configuration_version,c.configuration,
    c.submissions_open_at,c.submissions_close_at,c.voting_open_at,c.voting_close_at,
    c.voting_closed_at,c.voting_close_reason,c.created_by,c.created_at,c.updated_at
    from public.contests c order by c.created_at desc,c.id desc;
end;
$function$;
revoke all on function public.admin_list_contests() from public, anon, service_role;
grant execute on function public.admin_list_contests() to authenticated;

-- Install the native scheduler when this project exposes pg_cron. If it is not
-- enabled for the project, the safe server-side processor remains callable by
-- the project scheduler/operator without granting it to API roles.
do $migration$
declare v_job_id bigint;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    for v_job_id in select jobid from cron.job where jobname = 'process-contest-voting-windows' loop
      perform cron.unschedule(v_job_id);
    end loop;
    perform cron.schedule(
      'process-contest-voting-windows',
      '* * * * *',
      'select public.process_contest_voting_windows();'
    );
  end if;
end;
$migration$;
