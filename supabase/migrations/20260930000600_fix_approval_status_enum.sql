-- Follow-up: compare contest lifecycle labels as text so moderation
-- remains compatible with deployed enum versions that do not include every
-- later result-state label.
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
     and v_contest.status::text in (
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
    p_submission_id, v_auth_user_id, v_decision,
    case when v_decision = 'REJECTED'
      then btrim(p_rejection_reason) else null end
  );
  return v_result;
end;
$function$;

revoke all on function public.moderate_submission(uuid,text,text)
  from public, anon, service_role;
grant execute on function public.moderate_submission(uuid,text,text)
  to authenticated;