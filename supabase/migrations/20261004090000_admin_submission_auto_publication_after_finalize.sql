-- Publish Admin-created submissions when their finalized media enters a Contest
-- that already has a current public submission. Creation-time approval remains
-- separate from media publication, and participant submissions keep their
-- existing moderation-driven publication flow.

create or replace function public.finalize_submission_media_upload(p_media_id uuid)
returns public.submission_media language plpgsql security definer set search_path=''
as $function$
declare
  v_auth_user_id uuid:=auth.uid(); v_is_admin boolean;
  v_media public.submission_media%rowtype; v_submission public.submissions%rowtype;
  v_category public.contest_categories%rowtype; v_identity_auth_user_id uuid;
  v_object_mime_type text; v_object_size bigint; v_occupied_count bigint;
  v_result public.submission_media;
begin
  if v_auth_user_id is null then raise exception using errcode='P0001',message='unauthorized'; end if;
  v_is_admin:=exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id);
  select sm.* into v_media from public.submission_media sm where sm.id=p_media_id for update;
  if not found then raise exception using errcode='P0001',message='media_not_found'; end if;
  select s.* into v_submission from public.submissions s where s.id=v_media.submission_id for update;
  select pi.auth_user_id into v_identity_auth_user_id
    from public.contest_participations cp join public.platform_identities pi on pi.id=cp.identity_id
    where cp.id=v_submission.participation_id;
  if not v_is_admin and v_identity_auth_user_id is distinct from v_auth_user_id then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_media.status<>'PREPARED' or v_media.is_current then raise exception using errcode='P0001',message='media_not_prepared'; end if;
  if not exists(select 1 from storage.objects so where so.bucket_id=v_media.storage_bucket and so.name=v_media.storage_path) then raise exception using errcode='P0001',message='storage_object_missing'; end if;
  select so.metadata->>'mimetype', case when (so.metadata->>'size')~'^[0-9]+$' then (so.metadata->>'size')::bigint end
    into v_object_mime_type,v_object_size from storage.objects so where so.bucket_id=v_media.storage_bucket and so.name=v_media.storage_path;
  if v_object_mime_type is distinct from v_media.mime_type then raise exception using errcode='P0001',message='storage_object_type_mismatch'; end if;
  if v_object_size is null or v_object_size<>v_media.file_size_bytes or v_object_size>10485760 then raise exception using errcode='P0001',message='storage_object_size_mismatch'; end if;
  if v_submission.status='REJECTED' then
    select cc.* into v_category from public.contest_categories cc where cc.id=v_submission.category_id for update;
    select count(*) into v_occupied_count from public.submissions s
      where s.category_id=v_submission.category_id and s.status in ('PENDING','APPROVED');
    if v_occupied_count>=v_category.submission_cap then raise exception using errcode='P0001',message='category_full'; end if;
  end if;
  update public.submission_media set status='FINALIZED',is_current=false
    where submission_id=v_media.submission_id and id<>p_media_id and status='FINALIZED' and is_current;
  update public.submission_media set status='FINALIZED',is_current=true where id=p_media_id returning * into v_result;
  if v_submission.status='REJECTED' then
    update public.submissions set status='PENDING',rejection_reason=null,updated_at=now() where id=v_submission.id;
  end if;

  -- The existing public media is the authoritative signal that this Contest
  -- is already in a public phase. Do not infer publication from a status label
  -- alone, and do not publish a submission before its media is current.
  if v_submission.creation_source='ADMIN'
     and v_submission.status='APPROVED'
     and exists(
       select 1
       from public.contest_categories public_cc
       join public.contests public_c on public_c.id=public_cc.contest_id
       join public.submissions public_s on public_s.category_id=public_cc.id
         and public_s.status='APPROVED'
       join public.submission_media public_sm on public_sm.submission_id=public_s.id
         and public_sm.status='FINALIZED' and public_sm.is_current
       join public.submission_publications public_sp on public_sp.submission_id=public_s.id
         and public_sp.media_id=public_sm.id and public_sp.revoked_at is null
       where public_cc.contest_id=(select cc.contest_id from public.contest_categories cc where cc.id=v_submission.category_id)
         and public_c.archived_at is null
         and public_s.id<>v_submission.id
     )
     and not exists(
       select 1 from public.submission_publications sp
       where sp.submission_id=v_submission.id and sp.media_id=p_media_id and sp.revoked_at is null
     ) then
    insert into public.submission_publications(
      submission_id,media_id,published_at,published_by_auth_user_id
    ) values(v_submission.id,p_media_id,now(),v_auth_user_id);
  end if;

  return v_result;
end;
$function$;

revoke execute on function public.finalize_submission_media_upload(uuid) from public,anon,service_role;
grant execute on function public.finalize_submission_media_upload(uuid) to authenticated;
