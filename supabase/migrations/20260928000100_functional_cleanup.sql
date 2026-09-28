-- Functional cleanup: submission window, explicit contestant names, and readable vote review.
-- Additive only; this branch does not apply the migration to Production.

drop function if exists public.create_submission(uuid,uuid);
drop function if exists public.admin_create_submission_with_media(uuid,uuid,uuid,uuid,text,text,text,text,bigint,numeric);

alter table public.submissions
  add column if not exists contestant_display_name text,
  add constraint submissions_contestant_display_name_nonblank
    check (contestant_display_name is null or length(btrim(contestant_display_name)) > 0);

create or replace function public.create_submission(
  p_participation_id uuid, p_category_id uuid,
  p_contestant_display_name text default null
)
returns public.submissions language plpgsql security definer set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid(); v_category public.contest_categories%rowtype;
  v_participation public.contest_participations%rowtype; v_identity_auth_user_id uuid;
  v_is_admin boolean; v_occupied_count bigint; v_submission public.submissions;
  v_name text := nullif(btrim(p_contestant_display_name), '');
begin
  v_is_admin := exists(select 1 from public.admin_users au where au.user_id=v_auth_user_id);
  if v_auth_user_id is null then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_name is null then raise exception using errcode='P0001',message='contestant_display_name_required'; end if;
  select cc.* into v_category from public.contest_categories cc where cc.id=p_category_id for update;
  if not found or not v_category.is_active then raise exception using errcode='P0001',message='category_inactive'; end if;
  select cp.* into v_participation from public.contest_participations cp where cp.id=p_participation_id;
  if not found then raise exception using errcode='P0001',message='unauthorized'; end if;
  select pi.auth_user_id into v_identity_auth_user_id from public.platform_identities pi where pi.id=v_participation.identity_id;
  if not found or (not v_is_admin and v_identity_auth_user_id is distinct from v_auth_user_id) then raise exception using errcode='P0001',message='unauthorized'; end if;
  if v_participation.status <> 'ACTIVE' then raise exception using errcode='P0001',message='participation_not_active'; end if;
  if v_participation.contest_id <> v_category.contest_id then raise exception using errcode='P0001',message='contest_category_mismatch'; end if;
  if not exists(select 1 from public.contests c where c.id=v_category.contest_id and c.status='SUBMISSIONS_OPEN'
    and (c.submissions_open_at is null or now() >= c.submissions_open_at)
    and (c.submissions_close_at is null or now() < c.submissions_close_at)) then
    raise exception using errcode='P0001',message='contest_not_open';
  end if;
  if exists(select 1 from public.submissions s where s.participation_id=p_participation_id and s.category_id=p_category_id and s.status in ('PENDING','APPROVED','REJECTED')) then
    raise exception using errcode='P0001',message='submission_already_exists';
  end if;
  select count(*) into v_occupied_count from public.submissions s where s.category_id=p_category_id and s.status in ('PENDING','APPROVED','REJECTED');
  if v_occupied_count >= v_category.submission_cap then raise exception using errcode='P0001',message='category_full'; end if;
  insert into public.submissions(participation_id,category_id,contestant_display_name,status)
    values(p_participation_id,p_category_id,v_name,'PENDING') returning * into v_submission;
  return v_submission;
end;
$function$;

create or replace function public.admin_set_submission_window(p_contest_id uuid,p_open_at timestamptz,p_close_at timestamptz)
returns public.contests language plpgsql security definer set search_path = ''
as $function$
declare v_result public.contests;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  if p_open_at is null or p_close_at is null or p_open_at >= p_close_at then raise exception using errcode='P0001',message='invalid_submission_window'; end if;
  if not exists(select 1 from public.contests c where c.id=p_contest_id and c.status in ('DRAFT','SUBMISSIONS_OPEN')) then raise exception using errcode='P0001',message='contest_window_not_editable'; end if;
  update public.contests set submissions_open_at=p_open_at,submissions_close_at=p_close_at,updated_at=now() where id=p_contest_id returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.admin_open_contest_submissions(p_contest_id uuid)
returns public.contests language plpgsql security definer set search_path = ''
as $function$
declare v_contest public.contests; v_result public.contests;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  select * into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status <> 'DRAFT' then raise exception using errcode='P0001',message='contest_not_openable'; end if;
  if v_contest.submissions_open_at is null or v_contest.submissions_close_at is null then raise exception using errcode='P0001',message='submission_window_required'; end if;
  if not exists(select 1 from public.contest_categories cc where cc.contest_id=p_contest_id and cc.is_active) then raise exception using errcode='P0001',message='contest_category_required'; end if;
  update public.contests set status='SUBMISSIONS_OPEN',updated_at=now() where id=p_contest_id returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.admin_create_submission_with_media(
  p_contest_id uuid,p_category_id uuid,p_participation_id uuid,p_identity_id uuid,
  p_display_name text,p_contact_email text,p_original_filename text,p_mime_type text,
  p_file_size_bytes bigint,p_duration_seconds numeric default null,
  p_contestant_display_name text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_admin_auth_user_id uuid:=auth.uid(); v_identity_id uuid; v_participation_id uuid;
  v_submission public.submissions%rowtype; v_media public.submission_media%rowtype; v_version_no integer;
  v_contestant_name text:=nullif(btrim(p_contestant_display_name),'');
begin
  if v_admin_auth_user_id is null or not exists(select 1 from public.admin_users au where au.user_id=v_admin_auth_user_id) then raise exception using errcode='P0001',message='admin_required'; end if;
  if v_contestant_name is null then raise exception using errcode='P0001',message='contestant_display_name_required'; end if;
  if (p_participation_id is not null and p_identity_id is not null) or (p_participation_id is null and p_identity_id is null and nullif(btrim(p_display_name),'') is null) then raise exception using errcode='P0001',message='invalid_participant_selection'; end if;
  if nullif(btrim(p_original_filename),'') is null or p_mime_type is null or p_mime_type not in ('video/mp4','video/webm','video/quicktime') or p_file_size_bytes is null or p_file_size_bytes<=0 or p_file_size_bytes>10485760 then raise exception using errcode='P0001',message='media_metadata_invalid'; end if;
  if not exists(select 1 from public.contest_categories cc where cc.id=p_category_id and cc.contest_id=p_contest_id and cc.is_active) then raise exception using errcode='P0001',message='contest_category_mismatch'; end if;
  if not exists(select 1 from public.contests c where c.id=p_contest_id and c.status='SUBMISSIONS_OPEN'
    and (c.submissions_open_at is null or now()>=c.submissions_open_at)
    and (c.submissions_close_at is null or now()<c.submissions_close_at)) then raise exception using errcode='P0001',message='contest_not_open'; end if;
  if p_participation_id is not null then
    select cp.identity_id,cp.id into v_identity_id,v_participation_id from public.contest_participations cp where cp.id=p_participation_id and cp.contest_id=p_contest_id and cp.status='ACTIVE' for update;
    if not found then raise exception using errcode='P0001',message='invalid_contest_participation'; end if;
  elsif p_identity_id is not null then
    perform 1 from public.platform_identities pi where pi.id=p_identity_id for update;
    if not found then raise exception using errcode='P0001',message='identity_not_found'; end if;
    v_identity_id:=p_identity_id;
  else
    insert into public.platform_identities(identity_origin,display_name,contact_email,created_by_admin_auth_user_id)
      values('ADMIN_MANAGED',btrim(p_display_name),nullif(lower(btrim(p_contact_email)),''),v_admin_auth_user_id) returning id into v_identity_id;
  end if;
  if v_participation_id is null then
    insert into public.contest_participations(contest_id,identity_id) values(p_contest_id,v_identity_id)
      on conflict(contest_id,identity_id) do update set updated_at=now() returning id into v_participation_id;
  end if;
  v_submission:=public.create_submission(v_participation_id,p_category_id,v_contestant_name);
  update public.submissions set creation_source='ADMIN',created_by_auth_user_id=v_admin_auth_user_id where id=v_submission.id returning * into v_submission;
  select coalesce(max(sm.version_no),0)+1 into v_version_no from public.submission_media sm where sm.submission_id=v_submission.id;
  insert into public.submission_media(submission_id,storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,duration_seconds,created_by_auth_user_id,version_no,status,is_current)
    values(v_submission.id,'contest-videos','submissions/'||v_submission.id::text||'/'||gen_random_uuid()::text||'/upload',btrim(p_original_filename),p_mime_type,p_file_size_bytes,p_duration_seconds,v_admin_auth_user_id,v_version_no,'PREPARED',false)
    returning * into v_media;
  return jsonb_build_object('submission_id',v_submission.id,'participation_id',v_participation_id,'identity_id',v_identity_id,'creation_source',v_submission.creation_source,'created_by_auth_user_id',v_admin_auth_user_id,'contestant_display_name',v_submission.contestant_display_name,'media_id',v_media.id,'storage_bucket',v_media.storage_bucket,'storage_path',v_media.storage_path,'version_no',v_media.version_no,'media_status',v_media.status,'original_filename',v_media.original_filename,'mime_type',v_media.mime_type,'file_size_bytes',v_media.file_size_bytes,'duration_seconds',v_media.duration_seconds);
end;
$function$;

drop view public.published_submission_media;
create view public.published_submission_media as
select sp.id as publication_id,sp.submission_id,sp.media_id,cc.contest_id,s.category_id,
  s.contestant_display_name,cc.name as category_name,sp.published_at,sm.storage_bucket,sm.storage_path
from public.submission_publications sp
join public.submission_media sm on sm.id=sp.media_id
join public.submissions s on s.id=sp.submission_id
join public.contest_categories cc on cc.id=s.category_id
join public.contest_participations cp on cp.id=s.participation_id and cp.contest_id=cc.contest_id
where sp.revoked_at is null and sm.status='FINALIZED' and sm.is_current;

revoke all on public.published_submission_media from public,anon,authenticated,service_role;
grant select on public.published_submission_media to anon,authenticated;

revoke execute on function public.admin_set_submission_window(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.admin_set_submission_window(uuid,timestamptz,timestamptz) to authenticated;
revoke execute on function public.create_submission(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.create_submission(uuid,uuid,text) to authenticated;
revoke execute on function public.admin_open_contest_submissions(uuid) from public,anon,service_role;
grant execute on function public.admin_open_contest_submissions(uuid) to authenticated;
revoke execute on function public.admin_create_submission_with_media(uuid,uuid,uuid,uuid,text,text,text,text,bigint,numeric,text) from public,anon,service_role;
grant execute on function public.admin_create_submission_with_media(uuid,uuid,uuid,uuid,text,text,text,text,bigint,numeric,text) to authenticated;
