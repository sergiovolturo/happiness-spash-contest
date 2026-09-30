-- Approval publishes valid finalized media immediately and keeps publication separate
-- from voting eligibility. Existing approved rows are backfilled idempotently.

insert into public.submission_publications (
  submission_id, media_id, published_at, published_by_auth_user_id
)
select s.id, sm.id, coalesce(s.updated_at, now()), null
from public.submissions s
join public.contest_categories cc on cc.id = s.category_id
join public.contest_participations cp on cp.id = s.participation_id
join public.submission_media sm
  on sm.submission_id = s.id
 and sm.status = 'FINALIZED'
 and sm.is_current
where s.status = 'APPROVED'
  and cc.contest_id = cp.contest_id
  and not exists (
    select 1 from public.submission_publications sp
    where sp.submission_id = s.id
      and sp.revoked_at is null
  );

drop view public.published_submission_media;
create view public.published_submission_media as
select
  sp.id as publication_id,
  sp.submission_id,
  sp.media_id,
  cc.contest_id,
  s.category_id,
  s.contestant_display_name,
  cc.name as category_name,
  sp.published_at,
  sm.storage_bucket,
  sm.storage_path
from public.submission_publications sp
join public.submission_media sm
  on sm.id = sp.media_id
join public.submissions s
  on s.id = sp.submission_id
join public.contest_categories cc
  on cc.id = s.category_id
join public.contest_participations cp
  on cp.id = s.participation_id
 and cp.contest_id = cc.contest_id
where sp.revoked_at is null
  and sm.status = 'FINALIZED'
  and sm.is_current;

revoke all on public.published_submission_media from public, anon, authenticated, service_role;
grant select on public.published_submission_media to anon, authenticated;

create or replace function public.moderate_submission(
  p_submission_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns public.submissions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_submission public.submissions%rowtype;
  v_contest public.contests%rowtype;
  v_decision public.submission_status;
  v_media public.submission_media%rowtype;
  v_result public.submissions;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception using errcode = 'P0001', message = 'invalid_moderation_decision';
  end if;

  if p_decision = 'REJECTED'
     and nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'rejection_reason_required';
  end if;

  v_decision := p_decision::public.submission_status;

  select s.* into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'submission_not_found';
  end if;

  select c.* into v_contest
  from public.contest_categories cc
  join public.contests c on c.id = cc.contest_id
  where cc.id = v_submission.category_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;

  if v_decision = 'APPROVED' and v_submission.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'submission_not_pending';
  end if;

  if v_decision = 'REJECTED'
     and v_submission.status not in ('PENDING', 'APPROVED') then
    raise exception using errcode = 'P0001', message = 'submission_not_moderatable';
  end if;

  if v_decision = 'REJECTED'
     and v_submission.status = 'APPROVED'
     and v_contest.status in (
       'VOTING_OPEN', 'VOTING_CLOSED', 'FROZEN',
       'CONFIRMED', 'PUBLISHED', 'CLOSED'
     ) then
    raise exception using errcode = 'P0001', message = 'approved_submission_in_competition';
  end if;

  select sm.* into v_media
  from public.submission_media sm
  where sm.submission_id = p_submission_id
    and sm.status = 'FINALIZED'
    and sm.is_current
  order by sm.created_at desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'current_media_required';
  end if;

  if v_decision = 'APPROVED' then
    if not exists (
      select 1 from public.submission_publications sp
      where sp.submission_id = p_submission_id
        and sp.revoked_at is null
    ) then
      insert into public.submission_publications (
        submission_id, media_id, published_at, published_by_auth_user_id
      ) values (
        p_submission_id, v_media.id, now(), v_auth_user_id
      );
    end if;
  else
    update public.submission_publications
       set revoked_at = now(),
           revoked_by_auth_user_id = v_auth_user_id,
           revoke_reason = btrim(p_rejection_reason)
     where submission_id = p_submission_id
       and revoked_at is null;
  end if;

  update public.submissions
     set status = v_decision,
         rejection_reason = case
           when v_decision = 'REJECTED' then btrim(p_rejection_reason)
           else null
         end,
         updated_at = now()
   where id = p_submission_id
  returning * into v_result;

  insert into public.submission_moderation_events (
    submission_id, moderated_by_auth_user_id, decision, rejection_reason
  ) values (
    p_submission_id,
    v_auth_user_id,
    v_decision,
    case when v_decision = 'REJECTED'
      then btrim(p_rejection_reason) else null end
  );

  return v_result;
end;
$function$;

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
  v_approved_count bigint;
  v_pending_count bigint;
  v_inconsistent_count bigint;
  v_missing_media_count bigint;
  v_missing_publication_count bigint;
begin
  select c.* into v_contest
  from public.contests c
  where c.id = p_contest_id
  for update;
  if not found or v_contest.status <> 'READY_FOR_VOTING' then
    return false;
  end if;
  if v_contest.voting_open_at is null
     or v_contest.voting_close_at is null
     or now() < v_contest.voting_open_at
     or now() >= v_contest.voting_close_at then
    return false;
  end if;

  select
    count(*) filter (where s.status = 'APPROVED'),
    count(*) filter (where s.status = 'PENDING'),
    count(*) filter (
      where cc.contest_id <> p_contest_id
         or cp.contest_id <> p_contest_id
    )
  into v_approved_count, v_pending_count, v_inconsistent_count
  from public.submissions s
  join public.contest_categories cc on cc.id = s.category_id
  join public.contest_participations cp on cp.id = s.participation_id
  where cc.contest_id = p_contest_id
     or cp.contest_id = p_contest_id;

  select count(*) into v_missing_media_count
  from public.submissions s
  join public.contest_categories cc on cc.id = s.category_id
  join public.contest_participations cp on cp.id = s.participation_id
  where s.status = 'APPROVED'
    and cc.contest_id = p_contest_id
    and cp.contest_id = p_contest_id
    and (
      select count(*) from public.submission_media sm
      where sm.submission_id = s.id
        and sm.status = 'FINALIZED'
        and sm.is_current
    ) <> 1;

  select count(*) into v_missing_publication_count
  from public.submissions s
  join public.contest_categories cc on cc.id = s.category_id
  join public.contest_participations cp on cp.id = s.participation_id
  join public.submission_media sm
    on sm.submission_id = s.id
   and sm.status = 'FINALIZED'
   and sm.is_current
  where s.status = 'APPROVED'
    and cc.contest_id = p_contest_id
    and cp.contest_id = p_contest_id
    and not exists (
      select 1 from public.submission_publications sp
      where sp.submission_id = s.id
        and sp.media_id = sm.id
        and sp.revoked_at is null
    );

  if v_approved_count = 0
     or v_pending_count > 0
     or v_inconsistent_count > 0
     or v_missing_media_count > 0
     or v_missing_publication_count > 0 then
    return false;
  end if;

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
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if not public._open_contest_voting_if_ready(p_contest_id, v_auth_user_id) then
    select c.* into v_result from public.contests c where c.id = p_contest_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'contest_not_found';
    end if;
    if v_result.status <> 'READY_FOR_VOTING' then
      raise exception using errcode = 'P0001', message = 'contest_not_ready_state';
    end if;
    if v_result.voting_open_at is null or v_result.voting_close_at is null
       or now() < v_result.voting_open_at then
      raise exception using errcode = 'P0001', message = 'voting_not_open';
    end if;
    raise exception using errcode = 'P0001', message = 'contest_not_ready';
  end if;
  select c.* into v_result
  from public.contests c
  where c.id = p_contest_id;
  return v_result;
end;
$function$;

revoke all on function public.moderate_submission(uuid,text,text) from public, anon, service_role;
grant execute on function public.moderate_submission(uuid,text,text) to authenticated;
revoke all on function public.open_contest_voting(uuid) from public, anon, service_role;
grant execute on function public.open_contest_voting(uuid) to authenticated;
revoke all on function public._open_contest_voting_if_ready(uuid,uuid) from public, anon, authenticated, service_role;
