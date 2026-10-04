-- Media deletion requests/audits are technical records without FKs to a
-- submission. When the submission itself is safely deletable, remove only
-- its technical media-deletion records in the same transaction.

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
  if exists (select 1 from public.submission_publications where submission_id=p_submission_id)
     or exists (select 1 from public.contest_votes where submission_id=p_submission_id)
     or exists (select 1 from public.vote_deletion_audits where submission_id=p_submission_id)
     or exists (select 1 from public.contest_result_entries where submission_id=p_submission_id)
     or exists (select 1 from public.contest_finalists where submission_id=p_submission_id)
     or exists (select 1 from public.submission_moderation_events where submission_id=p_submission_id) then
    return false;
  end if;
  return true;
end;
$function$;

create or replace function public.admin_delete_submission(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_media_count integer;
begin
  if auth.uid() is null
     or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  perform 1 from public.submissions where id=p_submission_id for update;
  if not found then
    raise exception using errcode='P0001',message='submission_not_found';
  end if;
  if not public._admin_submission_is_deletable(p_submission_id) then
    raise exception using errcode='P0001',message='submission_delete_blocked';
  end if;
  if exists (
    select 1
      from public.submission_media sm
      join storage.objects so on so.bucket_id=sm.storage_bucket and so.name=sm.storage_path
     where sm.submission_id=p_submission_id
  ) or exists (
    select 1
      from public.submission_media sm
      join storage.objects so on so.bucket_id='contest-thumbnails'
       and so.name in (
         'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.webp',
         'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.jpg'
       )
     where sm.submission_id=p_submission_id
  ) then
    raise exception using errcode='P0001',message='storage_delete_required';
  end if;

  select count(*) into v_media_count
    from public.submission_media where submission_id=p_submission_id;

  -- These rows are technical records for the same media cleanup and have no
  -- FK to submissions. Scope both deletes to the target submission only.
  delete from public.contest_media_deletion_requests where submission_id=p_submission_id;
  delete from public.contest_media_deletion_audit where submission_id=p_submission_id;
  delete from public.submission_media where submission_id=p_submission_id;
  delete from public.submissions where id=p_submission_id;
  return jsonb_build_object('status','COMPLETED','submission_id',p_submission_id,'media_count',v_media_count);
end;
$function$;

revoke all on function public._admin_submission_is_deletable(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_delete_submission(uuid) from public,anon,service_role;
grant execute on function public.admin_delete_submission(uuid) to authenticated;
