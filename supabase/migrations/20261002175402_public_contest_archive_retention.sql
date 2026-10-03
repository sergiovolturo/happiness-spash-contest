-- Public contest ordering/archive and finalist-gated media retention.
-- Contest lifecycle statuses remain authoritative: FROZEN/CONFIRMED/PUBLISHED
-- belong to contest_result_snapshots, not public.contests.

-- Canonical source for the current snapshot of each category. The newest
-- frozen snapshot wins; invalidation is evaluated on that current row rather
-- than on an arbitrary historical finalist row.
create or replace function public._current_contest_result_snapshots(p_contest_id uuid)
returns table(category_id uuid, snapshot_id uuid, status public.contest_result_status, invalidated_at timestamptz)
language sql stable security definer set search_path=''
as $function$
  select distinct on (rs.category_id)
    rs.category_id,rs.id,rs.status,rs.invalidated_at
  from public.contest_result_snapshots rs
  where rs.contest_id=p_contest_id
  order by rs.category_id,rs.frozen_at desc,rs.id desc;
$function$;
revoke all on function public._current_contest_result_snapshots(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_public_contests()
returns table (
  id uuid, slug text, name text, description text,
  status public.contest_status,
  submissions_open_at timestamptz, submissions_close_at timestamptz,
  voting_open_at timestamptz, voting_close_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path=''
as $function$
  select c.id,c.slug,c.name,c.description,c.status,
    c.submissions_open_at,c.submissions_close_at,
    c.voting_open_at,c.voting_close_at,c.created_at,c.updated_at
  from public.contests c
  where c.archived_at is null
    and c.deletion_locked_at is null
    and c.status in (
      'SUBMISSIONS_OPEN'::public.contest_status,
      'VOTING_OPEN'::public.contest_status,
      'SUBMISSIONS_CLOSED'::public.contest_status,
      'MODERATION'::public.contest_status,
      'READY_FOR_VOTING'::public.contest_status
    )
  order by case c.status
    when 'SUBMISSIONS_OPEN'::public.contest_status then 1
    when 'VOTING_OPEN'::public.contest_status then 2
    when 'SUBMISSIONS_CLOSED'::public.contest_status then 3
    when 'MODERATION'::public.contest_status then 4
    when 'READY_FOR_VOTING'::public.contest_status then 5
    else 6 end,
    c.updated_at desc nulls last,c.created_at desc,c.id desc;
$function$;

create or replace function public.get_public_contest_archive()
returns table (
  id uuid, slug text, name text, description text,
  status public.contest_status,
  submissions_open_at timestamptz, submissions_close_at timestamptz,
  voting_open_at timestamptz, voting_close_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path=''
as $function$
  select c.id,c.slug,c.name,c.description,c.status,
    c.submissions_open_at,c.submissions_close_at,
    c.voting_open_at,c.voting_close_at,c.created_at,c.updated_at
  from public.contests c
  where c.deletion_locked_at is null
    and c.status in (
      'VOTING_CLOSED'::public.contest_status,
      'CLOSED'::public.contest_status
    )
  order by coalesce(c.updated_at,c.created_at) desc,c.created_at desc,c.id desc;
$function$;

create or replace function public.get_public_archive_contest_categories(p_contest_id uuid)
returns table(
  id uuid, contest_id uuid, name text, slug text, display_order integer,
  submission_cap integer, category_definition_id uuid, image_path text,
  published_video_count bigint, occupied_submission_count bigint,
  available_submission_count bigint
)
language sql stable security definer set search_path=''
as $function$
  select cc.id,cc.contest_id,d.name,d.slug,cc.display_order,
    cc.submission_cap,d.id,d.image_path,
    (select count(*) from public.published_submission_media pm
      where pm.contest_id=cc.contest_id and pm.category_id=cc.id),
    counts.occupied_submission_count,
    greatest(cc.submission_cap::bigint-counts.occupied_submission_count,0::bigint)
  from public.contest_categories cc
  join public.contest_category_definitions d on d.id=cc.category_definition_id
  join public.contests c on c.id=cc.contest_id
  cross join lateral (
    select count(*)::bigint as occupied_submission_count
    from public.submissions s
    where s.category_id=cc.id and s.status in ('PENDING','APPROVED')
  ) counts
  where cc.contest_id=p_contest_id
    and cc.is_active
    and c.deletion_locked_at is null
    and c.status in (
      'VOTING_CLOSED'::public.contest_status,
      'CLOSED'::public.contest_status
    )
  order by cc.display_order,cc.id;
$function$;

create or replace function public.get_public_archive_contest_results(p_contest_id uuid)
returns table(submission_id uuid,category_id uuid,category_name text,
  contestant_display_name text,vote_count bigint,rank_position integer,is_finalist boolean)
language plpgsql security definer set search_path=''
as $function$
declare v_contest public.contests%rowtype;
begin
  select * into v_contest from public.contests c
   where c.id=p_contest_id and c.deletion_locked_at is null
     and c.status in ('VOTING_CLOSED','CLOSED');
  if not found then return; end if;
  if exists(select 1 from public.contest_categories cc
    where cc.contest_id=p_contest_id and not exists(
      select 1 from public._current_contest_result_snapshots(p_contest_id) rs
      where rs.category_id=cc.id and rs.status='PUBLISHED' and rs.invalidated_at is null)) then return; end if;
  return query
  with latest as (
    select rs.snapshot_id as id,rs.category_id
    from public._current_contest_result_snapshots(p_contest_id) rs
    where rs.status='PUBLISHED' and rs.invalidated_at is null
  )
  select e.submission_id,s.category_id,d.name,s.contestant_display_name,
    e.vote_count,e.rank_position,
    exists(select 1 from public.contest_finalists f
      where f.snapshot_id=e.snapshot_id and f.submission_id=e.submission_id)
  from latest l
  join public.contest_result_entries e on e.snapshot_id=l.id
  join public.submissions s on s.id=e.submission_id
  join public.contest_categories cc on cc.id=s.category_id
  join public.contest_category_definitions d on d.id=cc.category_definition_id
  order by s.category_id,e.rank_position,e.submission_id;
end;
$function$;

-- Retention never removes submissions, votes, snapshots or audit history. It
-- only creates the same two-phase media requests already used by Admin.
create or replace function public.admin_prepare_finalist_media_retention(p_contest_id uuid)
returns setof jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_contest public.contests%rowtype;
  v_media public.submission_media%rowtype;
  v_request uuid;
begin
  if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  if auth.uid() is not null and not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  select * into v_contest from public.contests c where c.id=p_contest_id for update;
  if not found then raise exception using errcode='P0001',message='contest_not_found'; end if;
  if v_contest.status <> 'CLOSED' then raise exception using errcode='P0001',message='retention_contest_not_closed'; end if;
  if exists(select 1 from public.contest_categories cc
    where cc.contest_id=p_contest_id and not exists(
      select 1 from public._current_contest_result_snapshots(p_contest_id) rs
      where rs.category_id=cc.id and rs.status='PUBLISHED' and rs.invalidated_at is null)) then
    raise exception using errcode='P0001',message='finalists_not_definitive';
  end if;
  for v_media in
    select sm.* from public.submission_media sm
    join public.submissions s on s.id=sm.submission_id
    join public.contest_categories cc on cc.id=s.category_id and cc.contest_id=p_contest_id
    where sm.status='FINALIZED' and sm.is_current
      and not exists(
        select 1
        from public.contest_finalists f
        join public._current_contest_result_snapshots(p_contest_id) current_snapshot
          on current_snapshot.snapshot_id=f.snapshot_id
         and current_snapshot.status='PUBLISHED'
         and current_snapshot.invalidated_at is null
        where f.contest_id=p_contest_id and f.submission_id=s.id
      )
  loop
    select r.id into v_request from public.contest_media_deletion_requests r
      where r.media_id=v_media.id and r.status='PENDING' for update;
    if v_request is null then
      insert into public.contest_media_deletion_requests(
        contest_id,submission_id,media_id,storage_bucket,storage_path,
        contestant_display_name,category_id,requested_by,reason)
      select p_contest_id,v_media.submission_id,v_media.id,v_media.storage_bucket,
        v_media.storage_path,s.contestant_display_name,s.category_id,auth.uid(),
        'NON_FINALIST_CLEANUP'
      from public.submissions s where s.id=v_media.submission_id
      returning id into v_request;
    end if;
    return next jsonb_build_object('request_id',v_request,
      'contest_id',p_contest_id,'storage_bucket',v_media.storage_bucket,
      'storage_path',v_media.storage_path,'media_id',v_media.id);
  end loop;
end;
$function$;

create or replace function public.admin_finalize_finalist_media_retention(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_request public.contest_media_deletion_requests; v_contest public.contests%rowtype;
begin
  if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then raise exception using errcode='P0001',message='admin_required'; end if;
  if auth.uid() is not null and not exists(select 1 from public.admin_users au where au.user_id=auth.uid()) then raise exception using errcode='P0001',message='admin_required'; end if;
  select * into v_request from public.contest_media_deletion_requests where id=p_request_id for update;
  if not found or v_request.reason <> 'NON_FINALIST_CLEANUP' then raise exception using errcode='P0001',message='retention_request_not_found'; end if;
  if v_request.status='COMPLETED' then return jsonb_build_object('status','COMPLETED'); end if;
  select * into v_contest from public.contests where id=v_request.contest_id for update;
  if not found or v_contest.status <> 'CLOSED' then raise exception using errcode='P0001',message='retention_contest_not_closed'; end if;
  if exists(
    select 1
    from public.contest_finalists f
    join public._current_contest_result_snapshots(v_request.contest_id) current_snapshot
      on current_snapshot.snapshot_id=f.snapshot_id
     and current_snapshot.status='PUBLISHED'
     and current_snapshot.invalidated_at is null
    where f.contest_id=v_request.contest_id and f.submission_id=v_request.submission_id
  ) then raise exception using errcode='P0001',message='finalist_media_protected'; end if;
  if exists(select 1 from public.storage.objects where bucket_id=v_request.storage_bucket and name=v_request.storage_path) then raise exception using errcode='P0001',message='storage_delete_required'; end if;
  update public.submission_publications set revoked_at=coalesce(revoked_at,now()),revoked_by_auth_user_id=auth.uid(),revoke_reason='NON_FINALIST_CLEANUP'
    where media_id=v_request.media_id and revoked_at is null;
  delete from public.submission_publications where media_id=v_request.media_id;
  insert into public.contest_media_deletion_audit(
    contest_id,submission_id,media_id_original,category_id,storage_bucket,
    storage_path,contestant_display_name,deleted_by,reason)
  values(v_request.contest_id,v_request.submission_id,v_request.media_id::text,
    (select category_id from public.submissions where id=v_request.submission_id),
    v_request.storage_bucket,v_request.storage_path,v_request.contestant_display_name,
    auth.uid(),v_request.reason);
  delete from public.submission_media where id=v_request.media_id;
  update public.contest_media_deletion_requests set status='COMPLETED',completed_at=now() where id=v_request.id;
  return jsonb_build_object('status','COMPLETED','media_id',v_request.media_id);
end;
$function$;

revoke all on function public.get_public_contests() from public,service_role;
grant execute on function public.get_public_contests() to anon,authenticated;
revoke all on function public.get_public_contest_archive() from public,service_role;
grant execute on function public.get_public_contest_archive() to anon,authenticated;
revoke all on function public.get_public_archive_contest_categories(uuid) from public,service_role;
grant execute on function public.get_public_archive_contest_categories(uuid) to anon,authenticated;
revoke all on function public.get_public_archive_contest_results(uuid) from public,service_role;
grant execute on function public.get_public_archive_contest_results(uuid) to anon,authenticated;
revoke execute on function public.admin_prepare_finalist_media_retention(uuid) from public,anon,authenticated;
grant execute on function public.admin_prepare_finalist_media_retention(uuid) to authenticated,service_role;
revoke execute on function public.admin_finalize_finalist_media_retention(uuid) from public,anon,authenticated;
grant execute on function public.admin_finalize_finalist_media_retention(uuid) to authenticated,service_role;

-- Keep the legacy single-contest RPC compatible while applying the same order
-- used by the directory API.
create or replace function public.get_public_contest()
returns table (id uuid,slug text,name text,status public.contest_status,
  submissions_open_at timestamptz,submissions_close_at timestamptz,
  voting_open_at timestamptz,voting_close_at timestamptz)
language sql stable security definer set search_path=''
as $function$
  select c.id,c.slug,c.name,c.status,c.submissions_open_at,c.submissions_close_at,
    c.voting_open_at,c.voting_close_at
  from public.contests c
  where c.archived_at is null and c.deletion_locked_at is null
    and c.status in ('SUBMISSIONS_OPEN','VOTING_OPEN','SUBMISSIONS_CLOSED','MODERATION','READY_FOR_VOTING')
  order by case c.status
    when 'SUBMISSIONS_OPEN' then 1 when 'VOTING_OPEN' then 2
    when 'SUBMISSIONS_CLOSED' then 3 when 'MODERATION' then 4
    when 'READY_FOR_VOTING' then 5 else 6 end,
    c.updated_at desc nulls last,c.created_at desc,c.id desc
  limit 1;
$function$;
revoke execute on function public.get_public_contest() from public,anon,service_role;
grant execute on function public.get_public_contest() to anon,authenticated;
