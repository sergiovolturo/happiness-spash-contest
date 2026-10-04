-- A category snapshot alone does not make every submission in that category
-- historical. Only references to the specific submission remain blocking.

create or replace function public._admin_submission_is_deletable(p_submission_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_status public.contest_status;
  v_archived_at timestamptz;
  v_deletion_locked_at timestamptz;
begin
  if auth.uid() is null
     or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    return false;
  end if;

  select c.status, c.archived_at, c.deletion_locked_at
    into v_status, v_archived_at, v_deletion_locked_at
    from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id
    join public.contests c on c.id=cc.contest_id
   where s.id=p_submission_id;
  if not found then return false; end if;

  if v_archived_at is not null
     or v_deletion_locked_at is not null
     or v_status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then
    return false;
  end if;

  if exists (select 1 from public.submission_publications sp where sp.submission_id=p_submission_id)
     or exists (select 1 from public.contest_votes cv where cv.submission_id=p_submission_id)
     or exists (select 1 from public.vote_deletion_audits va where va.submission_id=p_submission_id)
     or exists (select 1 from public.contest_result_entries re where re.submission_id=p_submission_id)
     or exists (select 1 from public.contest_finalists cf where cf.submission_id=p_submission_id)
     or exists (select 1 from public.submission_moderation_events me where me.submission_id=p_submission_id)
     or exists (select 1 from public.contest_media_deletion_requests dr where dr.submission_id=p_submission_id)
     or exists (select 1 from public.contest_media_deletion_audit da where da.submission_id=p_submission_id) then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function public._admin_submission_is_deletable(uuid) from public,anon,authenticated,service_role;
