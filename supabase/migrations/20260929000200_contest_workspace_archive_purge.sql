-- Contest workspace, administrative archive and two-phase destructive cleanup.
-- Storage is deliberately deleted through the authenticated Storage API first;
-- the finalize RPC refuses to purge metadata while an object still exists.

alter table public.contests
  add column if not exists archived_at timestamptz,
  add column if not exists deletion_locked_at timestamptz;

create table if not exists public.contest_media_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null,
  submission_id uuid not null,
  media_id uuid not null,
  storage_bucket text not null,
  storage_path text not null,
  contestant_display_name text,
  category_id uuid,
  requested_by uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('INAPPROPRIATE','ADMIN_REMOVAL','NON_FINALIST_CLEANUP','OTHER')),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.contest_media_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null,
  submission_id uuid not null,
  media_id_original text not null,
  category_id uuid,
  storage_bucket text not null,
  storage_path text not null,
  contestant_display_name text,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('INAPPROPRIATE','ADMIN_REMOVAL','NON_FINALIST_CLEANUP','OTHER'))
);

create table if not exists public.contest_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  plan jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.contest_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  deleted_contest_id uuid not null,
  contest_name text not null,
  contest_slug text not null,
  previous_status text not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id) on delete set null,
  categories_count bigint not null default 0,
  submissions_count bigint not null default 0,
  media_count bigint not null default 0,
  votes_count bigint not null default 0,
  reason text not null
);

create index if not exists contest_media_deletion_requests_contest_idx
  on public.contest_media_deletion_requests (contest_id, status);
create index if not exists contest_deletion_requests_contest_idx
  on public.contest_deletion_requests (contest_id, status);
create index if not exists contests_archived_at_idx
  on public.contests (archived_at, created_at desc);

alter table public.contest_media_deletion_requests enable row level security;
alter table public.contest_media_deletion_audit enable row level security;
alter table public.contest_deletion_requests enable row level security;
alter table public.contest_deletion_audit enable row level security;

create policy contest_media_deletion_requests_admin_select on public.contest_media_deletion_requests
  for select to authenticated using (exists (select 1 from public.admin_users au where au.user_id=auth.uid()));
create policy contest_media_deletion_audit_admin_select on public.contest_media_deletion_audit
  for select to authenticated using (exists (select 1 from public.admin_users au where au.user_id=auth.uid()));
create policy contest_deletion_requests_admin_select on public.contest_deletion_requests
  for select to authenticated using (exists (select 1 from public.admin_users au where au.user_id=auth.uid()));
create policy contest_deletion_audit_admin_select on public.contest_deletion_audit
  for select to authenticated using (exists (select 1 from public.admin_users au where au.user_id=auth.uid()));

create or replace function public.admin_list_contest_categories(p_contest_id uuid)
returns setof public.contest_categories
language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001', message='admin_required';
  end if;
  return query select cc from public.contest_categories cc where cc.contest_id=p_contest_id order by cc.display_order,cc.id;
end;
$function$;

create or replace function public.admin_archive_contest(p_contest_id uuid)
returns public.contests
language plpgsql security definer set search_path=''
as $function$
declare v_result public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  update public.contests set archived_at=coalesce(archived_at,now()),updated_at=now()
   where id=p_contest_id and status <> 'VOTING_OPEN' and deletion_locked_at is null
   returning * into v_result;
  if not found then raise exception using errcode='P0001',message='contest_not_archivable'; end if;
  return v_result;
end;
$function$;

create or replace function public.admin_restore_contest(p_contest_id uuid)
returns public.contests
language plpgsql security definer set search_path=''
as $function$
declare v_result public.contests;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  update public.contests set archived_at=null,updated_at=now()
   where id=p_contest_id and archived_at is not null and deletion_locked_at is null
   returning * into v_result;
  if not found then raise exception using errcode='P0001',message='contest_not_archived'; end if;
  return v_result;
end;
$function$;

create or replace function public.admin_prepare_media_deletion(p_media_id uuid,p_reason text)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_media public.submission_media; v_submission public.submissions; v_category public.contest_categories; v_contest public.contests; v_request uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  if p_reason not in ('INAPPROPRIATE','ADMIN_REMOVAL','NON_FINALIST_CLEANUP','OTHER') then raise exception using errcode='P0001',message='invalid_deletion_reason'; end if;
  select * into v_media from public.submission_media where id=p_media_id for update;
  if not found then raise exception using errcode='P0001',message='media_not_found'; end if;
  select * into v_submission from public.submissions where id=v_media.submission_id for update;
  select * into v_category from public.contest_categories where id=v_submission.category_id;
  select * into v_contest from public.contests where id=v_category.contest_id for update;
  if v_contest.status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then raise exception using errcode='P0001',message='media_delete_blocked_lifecycle'; end if;
  if v_contest.status='READY_FOR_VOTING' and (exists(select 1 from public.contest_votes where submission_id=v_submission.id) or exists(select 1 from public.submission_publications where media_id=v_media.id and revoked_at is null)) then raise exception using errcode='P0001',message='media_delete_blocked_voted'; end if;
  if exists(select 1 from public.contest_finalists where submission_id=v_submission.id) then raise exception using errcode='P0001',message='media_delete_blocked_finalist'; end if;
  select id into v_request from public.contest_media_deletion_requests where media_id=p_media_id and status='PENDING' for update;
  if v_request is null then
    insert into public.contest_media_deletion_requests(contest_id,submission_id,media_id,storage_bucket,storage_path,contestant_display_name,category_id,requested_by,reason)
    values(v_contest.id,v_submission.id,v_media.id,v_media.storage_bucket,v_media.storage_path,v_submission.contestant_display_name,v_submission.category_id,auth.uid(),p_reason)
    returning id into v_request;
  end if;
  return jsonb_build_object('request_id',v_request,'storage_bucket',v_media.storage_bucket,'storage_path',v_media.storage_path,'contest_id',v_contest.id);
end;
$function$;

create or replace function public.admin_cancel_media_deletion(p_request_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  update public.contest_media_deletion_requests set status='CANCELLED' where id=p_request_id and status='PENDING';
end;
$function$;

create or replace function public.admin_finalize_media_deletion(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_request public.contest_media_deletion_requests; v_count integer;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  select * into v_request from public.contest_media_deletion_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0001',message='deletion_request_not_found'; end if;
  if v_request.status='COMPLETED' then return jsonb_build_object('status','COMPLETED'); end if;
  if exists(select 1 from storage.objects where bucket_id=v_request.storage_bucket and name=v_request.storage_path) then raise exception using errcode='P0001',message='storage_delete_required'; end if;
  update public.submission_publications set revoked_at=coalesce(revoked_at,now()),revoked_by_auth_user_id=auth.uid(),revoke_reason='ADMIN_MEDIA_DELETION'
   where media_id=v_request.media_id and revoked_at is null;
  delete from public.submission_publications where media_id=v_request.media_id;
  insert into public.contest_media_deletion_audit(contest_id,submission_id,media_id_original,category_id,storage_bucket,storage_path,contestant_display_name,deleted_by,reason)
  values(v_request.contest_id,v_request.submission_id,v_request.media_id::text,(select category_id from public.submissions where id=v_request.submission_id),v_request.storage_bucket,v_request.storage_path,v_request.contestant_display_name,auth.uid(),v_request.reason);
  delete from public.submission_media where id=v_request.media_id;
  update public.contest_media_deletion_requests set status='COMPLETED',completed_at=now() where id=v_request.id;
  return jsonb_build_object('status','COMPLETED','media_id',v_request.media_id);
end;
$function$;

create or replace function public.admin_prepare_contest_deletion(p_contest_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_contest public.contests; v_request uuid; v_plan jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='P0001',message='deletion_reason_required'; end if;
  select * into v_contest from public.contests where id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status='VOTING_OPEN' then raise exception using errcode='P0001',message='contest_delete_blocked_voting'; end if;
  if v_contest.deletion_locked_at is not null then select id into v_request from public.contest_deletion_requests where contest_id=p_contest_id and status='PENDING' order by created_at desc limit 1; else
    v_plan:=jsonb_build_object('contest_id',p_contest_id,'contest_name',v_contest.name,'contest_slug',v_contest.slug,'previous_status',v_contest.status::text,'reason',btrim(p_reason),'categories_count',(select count(*) from public.contest_categories where contest_id=p_contest_id),'submissions_count',(select count(*) from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id),'media_count',(select count(*) from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id),'votes_count',(select count(*) from public.contest_votes cv join public.submissions s on s.id=cv.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id),'objects',(select coalesce(jsonb_agg(jsonb_build_object('bucket',sm.storage_bucket,'path',sm.storage_path)), '[]'::jsonb) from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id));
    insert into public.contest_deletion_requests(contest_id,requested_by,plan) values(p_contest_id,auth.uid(),v_plan) returning id into v_request;
    update public.contests set deletion_locked_at=now(),updated_at=now() where id=p_contest_id;
  end if;
  return (select plan || jsonb_build_object('request_id',v_request) from public.contest_deletion_requests where id=v_request);
end;
$function$;

create or replace function public.admin_cancel_contest_deletion(p_request_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_contest_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  select contest_id into v_contest_id from public.contest_deletion_requests where id=p_request_id and status='PENDING' for update;
  if v_contest_id is not null then update public.contest_deletion_requests set status='CANCELLED' where id=p_request_id; update public.contests set deletion_locked_at=null,updated_at=now() where id=v_contest_id; end if;
end;
$function$;

create or replace function public.admin_finalize_contest_deletion(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_request public.contest_deletion_requests; v_plan jsonb; v_contest public.contests;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  select * into v_request from public.contest_deletion_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0001',message='deletion_request_not_found'; end if;
  if v_request.status='COMPLETED' then return jsonb_build_object('status','COMPLETED'); end if;
  select * into v_contest from public.contests where id=v_request.contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if exists(select 1 from public.submission_media sm join public.submissions s on s.id=sm.submission_id join public.contest_categories cc on cc.id=s.category_id join storage.objects o on o.bucket_id=sm.storage_bucket and o.name=sm.storage_path where cc.contest_id=v_contest.id) then raise exception using errcode='P0001',message='storage_delete_required'; end if;
  v_plan:=v_request.plan;
  delete from public.contest_finalists where contest_id=v_contest.id;
  delete from public.contest_tie_resolutions where contest_id=v_contest.id;
  delete from public.contest_result_entries where snapshot_id in (select id from public.contest_result_snapshots where contest_id=v_contest.id);
  delete from public.contest_result_snapshots where contest_id=v_contest.id;
  delete from public.vote_deletion_audits where submission_id in (select s.id from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=v_contest.id);
  delete from public.contest_votes where submission_id in (select s.id from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=v_contest.id);
  delete from public.submission_publications where submission_id in (select s.id from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=v_contest.id);
  delete from public.submission_moderation_events where submission_id in (select s.id from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=v_contest.id);
  delete from public.submission_media where submission_id in (select s.id from public.submissions s join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=v_contest.id);
  delete from public.submissions where category_id in (select id from public.contest_categories where contest_id=v_contest.id);
  delete from public.contest_participations where contest_id=v_contest.id;
  delete from public.contest_categories where contest_id=v_contest.id;
  insert into public.contest_deletion_audit(deleted_contest_id,contest_name,contest_slug,previous_status,deleted_by,categories_count,submissions_count,media_count,votes_count,reason)
  values(v_contest.id,v_contest.name,v_contest.slug,v_contest.status::text,auth.uid(),coalesce((v_plan->>'categories_count')::bigint,0),coalesce((v_plan->>'submissions_count')::bigint,0),coalesce((v_plan->>'media_count')::bigint,0),coalesce((v_plan->>'votes_count')::bigint,0),coalesce(v_plan->>'reason','ADMIN_PURGE'));
  delete from public.contests where id=v_contest.id;
  update public.contest_deletion_requests set status='COMPLETED',completed_at=now() where id=v_request.id;
  return jsonb_build_object('status','COMPLETED','contest_id',v_contest.id);
end;
$function$;

drop function if exists public.admin_list_contests();
create or replace function public.admin_list_contests()
returns setof public.contests language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  return query select c from public.contests c order by (c.archived_at is not null),c.created_at desc,c.id desc;
end;
$function$;

revoke execute on function public.admin_list_contest_categories(uuid),public.admin_archive_contest(uuid),public.admin_restore_contest(uuid),public.admin_prepare_media_deletion(uuid,text),public.admin_cancel_media_deletion(uuid),public.admin_finalize_media_deletion(uuid),public.admin_prepare_contest_deletion(uuid,text),public.admin_cancel_contest_deletion(uuid),public.admin_finalize_contest_deletion(uuid) from public,anon,service_role;
grant execute on function public.admin_list_contest_categories(uuid),public.admin_archive_contest(uuid),public.admin_restore_contest(uuid),public.admin_prepare_media_deletion(uuid,text),public.admin_cancel_media_deletion(uuid),public.admin_finalize_media_deletion(uuid),public.admin_prepare_contest_deletion(uuid,text),public.admin_cancel_contest_deletion(uuid),public.admin_finalize_contest_deletion(uuid) to authenticated;

drop function if exists public.get_public_contest();
create or replace function public.get_public_contest()
returns table (id uuid,slug text,name text,status public.contest_status,submissions_open_at timestamptz,submissions_close_at timestamptz,voting_open_at timestamptz,voting_close_at timestamptz)
language sql stable security definer set search_path=''
as $function$
  select c.id,c.slug,c.name,c.status,c.submissions_open_at,c.submissions_close_at,c.voting_open_at,c.voting_close_at
  from public.contests c where c.archived_at is null and c.deletion_locked_at is null and c.status in ('SUBMISSIONS_OPEN'::public.contest_status,'SUBMISSIONS_CLOSED'::public.contest_status,'MODERATION'::public.contest_status,'READY_FOR_VOTING'::public.contest_status,'VOTING_OPEN'::public.contest_status)
  order by case c.status when 'VOTING_OPEN'::public.contest_status then 1 when 'READY_FOR_VOTING'::public.contest_status then 2 when 'MODERATION'::public.contest_status then 3 when 'SUBMISSIONS_OPEN'::public.contest_status then 4 when 'SUBMISSIONS_CLOSED'::public.contest_status then 5 else 6 end,c.updated_at desc,c.created_at desc limit 1;
$function$;
revoke execute on function public.get_public_contest() from public,anon,service_role;
grant execute on function public.get_public_contest() to anon,authenticated;

create or replace function public.get_public_contest_categories(p_contest_id uuid)
returns table (id uuid,contest_id uuid,name text,slug text,display_order integer,submission_cap integer)
language sql stable security definer set search_path=''
as $function$
  select cc.id,cc.contest_id,cc.name,cc.slug,cc.display_order,cc.submission_cap
  from public.contest_categories cc join public.contests c on c.id=cc.contest_id
  where cc.contest_id=p_contest_id and cc.is_active and c.archived_at is null and c.deletion_locked_at is null
    and c.status in ('SUBMISSIONS_OPEN'::public.contest_status,'SUBMISSIONS_CLOSED'::public.contest_status,'MODERATION'::public.contest_status,'READY_FOR_VOTING'::public.contest_status,'VOTING_OPEN'::public.contest_status,'VOTING_CLOSED'::public.contest_status,'CLOSED'::public.contest_status)
  order by cc.display_order,cc.created_at;
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
join public.contests c on c.id=cc.contest_id
where sp.revoked_at is null and sm.status='FINALIZED' and sm.is_current
  and c.archived_at is null and c.deletion_locked_at is null;
revoke all on public.published_submission_media from public,anon,authenticated,service_role;
grant select on public.published_submission_media to anon,authenticated;
