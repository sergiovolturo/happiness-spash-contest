-- Coordinate deletion of the current video and its optional derived thumbnail.
-- The nullable plan keeps pre-existing requests compatible: NULL means the
-- legacy request contains only its video path, while [] is a new request with
-- no Storage objects remaining at prepare time.

alter table public.contest_media_deletion_requests
  add column if not exists storage_objects jsonb;

alter table public.contest_media_deletion_requests
  drop constraint if exists contest_media_deletion_requests_storage_objects_array;

alter table public.contest_media_deletion_requests
  add constraint contest_media_deletion_requests_storage_objects_array
  check (storage_objects is null or jsonb_typeof(storage_objects) = 'array');

create or replace function public.admin_prepare_media_deletion(p_media_id uuid,p_reason text)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_media public.submission_media;
  v_submission public.submissions;
  v_category public.contest_categories;
  v_contest public.contests;
  v_request public.contest_media_deletion_requests;
  v_objects jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  if p_reason not in ('INAPPROPRIATE','ADMIN_REMOVAL','NON_FINALIST_CLEANUP','OTHER') then
    raise exception using errcode='P0001',message='invalid_deletion_reason';
  end if;

  select * into v_media from public.submission_media where id=p_media_id for update;
  if not found then raise exception using errcode='P0001',message='media_not_found'; end if;
  select * into v_submission from public.submissions where id=v_media.submission_id for update;
  select * into v_category from public.contest_categories where id=v_submission.category_id;
  select * into v_contest from public.contests where id=v_category.contest_id for update;
  if v_contest.status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then
    raise exception using errcode='P0001',message='media_delete_blocked_lifecycle';
  end if;
  if v_contest.status='READY_FOR_VOTING'
     and (exists(select 1 from public.contest_votes where submission_id=v_submission.id)
       or exists(select 1 from public.submission_publications where media_id=v_media.id and revoked_at is null)) then
    raise exception using errcode='P0001',message='media_delete_blocked_voted';
  end if;
  if exists(select 1 from public.contest_finalists where submission_id=v_submission.id) then
    raise exception using errcode='P0001',message='media_delete_blocked_finalist';
  end if;

  -- Build the plan from storage.objects, so optional thumbnails and already
  -- missing objects never make a retry fail.
  select coalesce(jsonb_agg(jsonb_build_object('bucket',objects.bucket,'path',objects.path)
                            order by objects.bucket,objects.path),'[]'::jsonb)
    into v_objects
    from (
      select v_media.storage_bucket as bucket,v_media.storage_path as path
       where exists(select 1 from storage.objects so
                     where so.bucket_id=v_media.storage_bucket and so.name=v_media.storage_path)
      union
      select 'contest-thumbnails'::text,
             'submission-thumbnails/'||v_media.submission_id::text||'/'||v_media.id::text||'.webp'
       where exists(select 1 from storage.objects so
                     where so.bucket_id='contest-thumbnails'
                       and so.name='submission-thumbnails/'||v_media.submission_id::text||'/'||v_media.id::text||'.webp')
      union
      select 'contest-thumbnails'::text,
             'submission-thumbnails/'||v_media.submission_id::text||'/'||v_media.id::text||'.jpg'
       where exists(select 1 from storage.objects so
                     where so.bucket_id='contest-thumbnails'
                       and so.name='submission-thumbnails/'||v_media.submission_id::text||'/'||v_media.id::text||'.jpg')
    ) objects;

  select * into v_request
    from public.contest_media_deletion_requests
   where media_id=p_media_id and status='PENDING'
   order by created_at desc
   limit 1
   for update;

  if not found then
    insert into public.contest_media_deletion_requests(
      contest_id,submission_id,media_id,storage_bucket,storage_path,
      storage_objects,contestant_display_name,category_id,requested_by,reason)
    values(v_contest.id,v_submission.id,v_media.id,v_media.storage_bucket,v_media.storage_path,
      v_objects,v_submission.contestant_display_name,v_submission.category_id,auth.uid(),p_reason)
    returning * into v_request;
  else
    -- A pending retry re-normalizes the same request instead of creating a
    -- second request or preserving a stale thumbnail/video plan.
    update public.contest_media_deletion_requests
       set storage_bucket=v_media.storage_bucket,
           storage_path=v_media.storage_path,
           storage_objects=v_objects,
           reason=p_reason
     where id=v_request.id
     returning * into v_request;
  end if;

  return jsonb_build_object(
    'request_id',v_request.id,
    'storage_bucket',v_request.storage_bucket,
    'storage_path',v_request.storage_path,
    'storage_objects',coalesce(v_request.storage_objects,'[]'::jsonb),
    'objects',coalesce(v_request.storage_objects,'[]'::jsonb),
    'contest_id',v_contest.id);
end;
$function$;

create or replace function public.admin_finalize_media_deletion(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_request public.contest_media_deletion_requests;
  v_contest public.contests;
  v_objects jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  select * into v_request from public.contest_media_deletion_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0001',message='deletion_request_not_found'; end if;
  if v_request.status='COMPLETED' then return jsonb_build_object('status','COMPLETED'); end if;

  select c.* into v_contest from public.contests c where c.id=v_request.contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then
    raise exception using errcode='P0001',message='media_delete_blocked_lifecycle';
  end if;

  -- NULL is the legacy representation and intentionally falls back to the
  -- original video-only request. New requests always store an array, including
  -- an empty array when no object existed at prepare time.
  v_objects=coalesce(v_request.storage_objects,
    jsonb_build_array(jsonb_build_object('bucket',v_request.storage_bucket,'path',v_request.storage_path)));
  if exists(
    select 1
      from jsonb_array_elements(v_objects) planned(item)
      join storage.objects so
        on so.bucket_id=planned.item->>'bucket'
       and so.name=planned.item->>'path'
  ) then
    raise exception using errcode='P0001',message='storage_delete_required';
  end if;

  update public.submission_publications
     set revoked_at=coalesce(revoked_at,now()),
         revoked_by_auth_user_id=auth.uid(),
         revoke_reason='ADMIN_MEDIA_DELETION'
   where media_id=v_request.media_id and revoked_at is null;
  delete from public.submission_publications where media_id=v_request.media_id;

  insert into public.contest_media_deletion_audit(
    contest_id,submission_id,media_id_original,category_id,storage_bucket,
    storage_path,contestant_display_name,deleted_by,reason)
  select v_request.contest_id,v_request.submission_id,
    case when planned.item->>'path'=v_request.storage_path
      then v_request.media_id::text else v_request.media_id::text||':thumbnail' end,
    (select category_id from public.submissions where id=v_request.submission_id),
    planned.item->>'bucket',planned.item->>'path',v_request.contestant_display_name,
    auth.uid(),v_request.reason
  from jsonb_array_elements(v_objects) planned(item);

  delete from public.submission_media where id=v_request.media_id;
  update public.contest_media_deletion_requests
     set status='COMPLETED',completed_at=now()
   where id=v_request.id;
  return jsonb_build_object('status','COMPLETED','media_id',v_request.media_id,
    'objects',v_objects);
end;
$function$;

revoke execute on function public.admin_prepare_media_deletion(uuid,text),public.admin_finalize_media_deletion(uuid)
  from public,anon,service_role;
grant execute on function public.admin_prepare_media_deletion(uuid,text),public.admin_finalize_media_deletion(uuid)
  to authenticated;
