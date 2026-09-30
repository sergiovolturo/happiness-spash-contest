-- Prevent a media deletion request prepared before voting from being finalized
-- after the Contest enters a protected voting lifecycle.

create or replace function public.admin_finalize_media_deletion(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_request public.contest_media_deletion_requests;
  v_contest public.contests;
begin
  if auth.uid() is null or not exists(
    select 1 from public.admin_users au where au.user_id=auth.uid()
  ) then
    raise exception using errcode='P0001',message='admin_required';
  end if;

  select * into v_request
    from public.contest_media_deletion_requests
   where id=p_request_id
   for update;
  if not found then
    raise exception using errcode='P0001',message='deletion_request_not_found';
  end if;
  if v_request.status='COMPLETED' then
    return jsonb_build_object('status','COMPLETED');
  end if;

  select c.* into v_contest
    from public.contests c
   where c.id=v_request.contest_id
   for update;
  if not found then
    raise exception using errcode='P0001',message='contest_not_found';
  end if;
  if v_contest.status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then
    raise exception using errcode='P0001',message='media_delete_blocked_lifecycle';
  end if;

  if exists(
    select 1 from storage.objects
     where bucket_id=v_request.storage_bucket and name=v_request.storage_path
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
    storage_path,contestant_display_name,deleted_by,reason
  ) values(
    v_request.contest_id,v_request.submission_id,v_request.media_id::text,
    (select category_id from public.submissions where id=v_request.submission_id),
    v_request.storage_bucket,v_request.storage_path,v_request.contestant_display_name,
    auth.uid(),v_request.reason
  );
  delete from public.submission_media where id=v_request.media_id;
  update public.contest_media_deletion_requests
     set status='COMPLETED',completed_at=now()
   where id=v_request.id;
  return jsonb_build_object('status','COMPLETED','media_id',v_request.media_id);
end;
$function$;

