-- Keep rejected submissions recoverable only through the existing media-replacement
-- flow, while preserving their capacity-release semantics.

create or replace function public.create_submission(
  p_participation_id uuid, p_category_id uuid,
  p_contestant_display_name text default null
)
returns public.submissions language plpgsql security definer set search_path=''
as $function$
declare
  v_auth_user_id uuid:=auth.uid();
  v_category public.contest_categories%rowtype;
  v_participation public.contest_participations%rowtype;
  v_identity_auth_user_id uuid;
  v_is_admin boolean; v_occupied_count bigint; v_submission public.submissions;
  v_name text:=nullif(btrim(p_contestant_display_name),'');
begin
  v_is_admin:=exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id);
  if v_auth_user_id is null then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_name is null then raise exception using errcode='P0001',message='contestant_display_name_required'; end if;
  select cc.* into v_category from public.contest_categories cc where cc.id=p_category_id for update;
  if not found or not v_category.is_active then raise exception using errcode='P0001',message='category_inactive'; end if;
  select cp.* into v_participation from public.contest_participations cp where cp.id=p_participation_id;
  if not found then raise exception using errcode='P0001',message='unauthorized'; end if;
  select pi.auth_user_id into v_identity_auth_user_id from public.platform_identities pi where pi.id=v_participation.identity_id;
  if not found or (not v_is_admin and v_identity_auth_user_id is distinct from v_auth_user_id) then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_participation.status<>'ACTIVE' then raise exception using errcode='P0001',message='participation_not_active'; end if;
  if v_participation.contest_id<>v_category.contest_id then raise exception using errcode='P0001',message='contest_category_mismatch'; end if;
  if not exists(select 1 from public.contests c where c.id=v_category.contest_id and c.status='SUBMISSIONS_OPEN'
    and (c.submissions_open_at is null or now()>=c.submissions_open_at)
    and (c.submissions_close_at is null or now()<c.submissions_close_at)) then
    raise exception using errcode='P0001',message='contest_not_open';
  end if;
  -- REJECTED releases capacity, but still reserves this logical
  -- participation/category pair for media replacement instead of a new row.
  if exists(select 1 from public.submissions s where s.participation_id=p_participation_id
    and s.category_id=p_category_id and s.status in ('PENDING','APPROVED','REJECTED')) then
    raise exception using errcode='P0001',message='submission_already_exists';
  end if;
  select count(*) into v_occupied_count from public.submissions s
    where s.category_id=p_category_id and s.status in ('PENDING','APPROVED');
  if v_occupied_count>=v_category.submission_cap then raise exception using errcode='P0001',message='category_full'; end if;
  insert into public.submissions(participation_id,category_id,contestant_display_name,status)
    values(p_participation_id,p_category_id,v_name,'PENDING') returning * into v_submission;
  return v_submission;
end;
$function$;

create or replace function public.prepare_submission_media_upload(
  p_submission_id uuid, p_original_filename text, p_mime_type text,
  p_file_size_bytes bigint, p_duration_seconds numeric
)
returns public.submission_media language plpgsql security definer set search_path=''
as $function$
declare
  v_auth_user_id uuid:=auth.uid();
  v_submission public.submissions%rowtype;
  v_category public.contest_categories%rowtype;
  v_contest public.contests%rowtype;
  v_participation public.contest_participations%rowtype;
  v_identity_auth_user_id uuid; v_media public.submission_media;
  v_media_id uuid:=gen_random_uuid(); v_version_no integer;
begin
  if v_auth_user_id is null then raise exception using errcode='P0001',message='unauthorized'; end if;
  select s.* into v_submission from public.submissions s where s.id=p_submission_id for update;
  if not found then raise exception using errcode='P0001',message='submission_not_found'; end if;
  select pi.auth_user_id into v_identity_auth_user_id
    from public.contest_participations cp join public.platform_identities pi on pi.id=cp.identity_id
   where cp.id=v_submission.participation_id;
  if v_identity_auth_user_id is distinct from v_auth_user_id then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_submission.status not in ('PENDING','REJECTED') then raise exception using errcode='P0001',message='submission_not_uploadable'; end if;
  if v_submission.status='PENDING' and exists(select 1 from public.submission_media sm where sm.submission_id=p_submission_id and sm.status='FINALIZED' and sm.is_current) then
    raise exception using errcode='P0001',message='media_already_exists';
  end if;
  if v_submission.status='REJECTED' then
    select cc.* into v_category from public.contest_categories cc where cc.id=v_submission.category_id for update;
    select c.* into v_contest from public.contests c where c.id=v_category.contest_id for update;
    select cp.* into v_participation from public.contest_participations cp where cp.id=v_submission.participation_id;
    if not found or v_participation.status<>'ACTIVE' then raise exception using errcode='P0001',message='participation_not_active'; end if;
    if not v_category.is_active then raise exception using errcode='P0001',message='category_inactive'; end if;
    if v_participation.contest_id<>v_category.contest_id then raise exception using errcode='P0001',message='contest_category_mismatch'; end if;
    if v_contest.archived_at is not null or v_contest.deletion_locked_at is not null or v_contest.status<>'SUBMISSIONS_OPEN'
       or (v_contest.submissions_open_at is not null and v_contest.submissions_open_at>now())
       or (v_contest.submissions_close_at is not null and v_contest.submissions_close_at<=now()) then
      raise exception using errcode='P0001',message='contest_not_open';
    end if;
    if exists(select 1 from public.submissions s where s.participation_id=v_submission.participation_id and s.category_id=v_submission.category_id and s.id<>v_submission.id and s.status in ('PENDING','APPROVED')) then
      raise exception using errcode='P0001',message='submission_already_exists';
    end if;
  end if;
  if p_mime_type not in ('video/mp4','video/webm','video/quicktime') then raise exception using errcode='P0001',message='unsupported_media_type'; end if;
  if p_file_size_bytes is null or p_file_size_bytes<=0 or p_file_size_bytes>10485760 then raise exception using errcode='P0001',message='media_size_invalid'; end if;
  select coalesce(max(sm.version_no),0)+1 into v_version_no from public.submission_media sm where sm.submission_id=p_submission_id;
  insert into public.submission_media(id,submission_id,storage_path,original_filename,mime_type,file_size_bytes,duration_seconds,created_by_auth_user_id,version_no,status,is_current)
    values(v_media_id,p_submission_id,'submissions/'||p_submission_id::text||'/'||v_media_id::text||'/upload',p_original_filename,p_mime_type,p_file_size_bytes,p_duration_seconds,v_auth_user_id,v_version_no,'PREPARED',false)
    returning * into v_media;
  return v_media;
end;
$function$;

create or replace function public.finalize_submission_media_upload(p_media_id uuid)
returns public.submission_media language plpgsql security definer set search_path=''
as $function$
declare
  v_auth_user_id uuid:=auth.uid(); v_is_admin boolean;
  v_media public.submission_media%rowtype; v_submission public.submissions%rowtype;
  v_category public.contest_categories%rowtype; v_contest public.contests%rowtype;
  v_participation public.contest_participations%rowtype; v_identity_auth_user_id uuid;
  v_object_mime_type text; v_object_size bigint; v_occupied_count bigint;
  v_result public.submission_media;
begin
  if v_auth_user_id is null then raise exception using errcode='P0001',message='unauthorized'; end if;
  v_is_admin:=exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id);
  select sm.* into v_media from public.submission_media sm where sm.id=p_media_id for update;
  if not found then raise exception using errcode='P0001',message='media_not_found'; end if;
  select s.* into v_submission from public.submissions s where s.id=v_media.submission_id for update;
  select pi.auth_user_id into v_identity_auth_user_id from public.contest_participations cp join public.platform_identities pi on pi.id=cp.identity_id where cp.id=v_submission.participation_id;
  if not v_is_admin and v_identity_auth_user_id is distinct from v_auth_user_id then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_media.status<>'PREPARED' or v_media.is_current then raise exception using errcode='P0001',message='media_not_prepared'; end if;
  if not exists(select 1 from storage.objects so where so.bucket_id=v_media.storage_bucket and so.name=v_media.storage_path) then raise exception using errcode='P0001',message='storage_object_missing'; end if;
  select so.metadata->>'mimetype',case when (so.metadata->>'size')~'^[0-9]+$' then (so.metadata->>'size')::bigint end into v_object_mime_type,v_object_size from storage.objects so where so.bucket_id=v_media.storage_bucket and so.name=v_media.storage_path;
  if v_object_mime_type is distinct from v_media.mime_type then raise exception using errcode='P0001',message='storage_object_type_mismatch'; end if;
  if v_object_size is null or v_object_size<>v_media.file_size_bytes or v_object_size>10485760 then raise exception using errcode='P0001',message='storage_object_size_mismatch'; end if;
  if v_submission.status='REJECTED' then
    select cc.* into v_category from public.contest_categories cc where cc.id=v_submission.category_id for update;
    select c.* into v_contest from public.contests c where c.id=v_category.contest_id for update;
    select cp.* into v_participation from public.contest_participations cp where cp.id=v_submission.participation_id;
    if not found or v_participation.status<>'ACTIVE' then raise exception using errcode='P0001',message='participation_not_active'; end if;
    if not v_category.is_active then raise exception using errcode='P0001',message='category_inactive'; end if;
    if v_participation.contest_id<>v_category.contest_id then raise exception using errcode='P0001',message='contest_category_mismatch'; end if;
    if v_contest.archived_at is not null or v_contest.deletion_locked_at is not null or v_contest.status<>'SUBMISSIONS_OPEN'
       or (v_contest.submissions_open_at is not null and v_contest.submissions_open_at>now())
       or (v_contest.submissions_close_at is not null and v_contest.submissions_close_at<=now()) then
      raise exception using errcode='P0001',message='contest_not_open';
    end if;
    if exists(select 1 from public.submissions s where s.participation_id=v_submission.participation_id and s.category_id=v_submission.category_id and s.id<>v_submission.id and s.status in ('PENDING','APPROVED')) then
      raise exception using errcode='P0001',message='submission_already_exists';
    end if;
    select count(*) into v_occupied_count from public.submissions s where s.category_id=v_submission.category_id and s.status in ('PENDING','APPROVED');
    if v_occupied_count>=v_category.submission_cap then raise exception using errcode='P0001',message='category_full'; end if;
  end if;
  update public.submission_media set status='FINALIZED',is_current=false where submission_id=v_media.submission_id and id<>p_media_id and status='FINALIZED' and is_current;
  update public.submission_media set status='FINALIZED',is_current=true where id=p_media_id returning * into v_result;
  if v_submission.status='REJECTED' then update public.submissions set status='PENDING',rejection_reason=null,updated_at=now() where id=v_submission.id; end if;
  if v_submission.creation_source='ADMIN' and v_submission.status='APPROVED' and exists(
    select 1 from public.contest_categories public_cc join public.contests public_c on public_c.id=public_cc.contest_id join public.submissions public_s on public_s.category_id=public_cc.id and public_s.status='APPROVED' join public.submission_media public_sm on public_sm.submission_id=public_s.id and public_sm.status='FINALIZED' and public_sm.is_current join public.submission_publications public_sp on public_sp.submission_id=public_s.id and public_sp.media_id=public_sm.id and public_sp.revoked_at is null where public_cc.contest_id=(select cc.contest_id from public.contest_categories cc where cc.id=v_submission.category_id) and public_c.archived_at is null and public_s.id<>v_submission.id
  ) and not exists(select 1 from public.submission_publications sp where sp.submission_id=v_submission.id and sp.revoked_at is null) then
    insert into public.submission_publications(submission_id,media_id,published_at,published_by_auth_user_id) values(v_submission.id,p_media_id,now(),v_auth_user_id);
  end if;
  return v_result;
end;
$function$;

revoke execute on function public.create_submission(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.create_submission(uuid,uuid,text) to authenticated;
revoke execute on function public.prepare_submission_media_upload(uuid,text,text,bigint,numeric) from public,anon,service_role;
grant execute on function public.prepare_submission_media_upload(uuid,text,text,bigint,numeric) to authenticated;
revoke execute on function public.finalize_submission_media_upload(uuid) from public,anon,service_role;
grant execute on function public.finalize_submission_media_upload(uuid) to authenticated;
