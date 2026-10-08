-- Normalize winner-only archive plans to the Storage objects that actually exist.
-- A pending request is reused and its plan is refreshed while the Contest remains locked.

create or replace function public.admin_prepare_contest_archive(p_contest_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_existing public.contest_archive_requests%rowtype;
  v_request uuid;
  v_retry boolean := false;
  v_plan jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'contest_not_found'; end if;
  if v_contest.archived_at is not null then
    return jsonb_build_object('status', 'COMPLETED', 'contest_id', p_contest_id);
  end if;

  if v_contest.deletion_locked_at is not null then
    select * into v_existing from public.contest_archive_requests
     where contest_id = p_contest_id and status = 'PENDING'
     order by created_at desc limit 1 for update;
    if not found then raise exception using errcode = 'P0001', message = 'archive_in_progress'; end if;
    v_request := v_existing.id;
    v_retry := true;
  end if;

  if v_contest.status <> 'CLOSED' then
    raise exception using errcode = 'P0001', message = 'contest_not_archivable';
  end if;
  if exists (
    select 1 from public.contest_categories cc
     where cc.contest_id = p_contest_id
       and not exists (select 1 from public._current_contest_result_snapshots(p_contest_id) rs
                        where rs.category_id = cc.id and rs.status = 'PUBLISHED' and rs.invalidated_at is null)
  ) then raise exception using errcode = 'P0001', message = 'results_not_published'; end if;
  if exists (
    select 1 from public.contest_categories cc
     where cc.contest_id = p_contest_id and cc.is_active and cc.winner_required
       and not exists (select 1 from public.contest_winners cw
                        where cw.contest_id = p_contest_id and cw.category_id = cc.id)
  ) then raise exception using errcode = 'P0001', message = 'winner_required_missing'; end if;
  if exists (
    select 1 from public.contest_winners cw
     where cw.contest_id = p_contest_id
       and not exists (select 1 from public._archive_contest_winner_media(p_contest_id) wm where wm.winner_id = cw.id)
  ) then raise exception using errcode = 'P0001', message = 'winner_not_valid_published_finalist_media'; end if;

  v_plan := jsonb_build_object(
    'contest_id', p_contest_id,
    'contest_name', v_contest.name,
    'media_count', (select count(*) from public.submission_media sm join public.submissions s on s.id=sm.submission_id
                    join public.contest_categories cc on cc.id=s.category_id where cc.contest_id=p_contest_id),
    'retained_media_ids', coalesce((select jsonb_agg(wm.media_id order by wm.media_id) from public._archive_contest_winner_media(p_contest_id) wm), '[]'::jsonb),
    'deleted_media_ids', coalesce((select jsonb_agg(sm.id order by sm.id)
      from public.submission_media sm join public.submissions s on s.id=sm.submission_id
      join public.contest_categories cc on cc.id=s.category_id
      where cc.contest_id=p_contest_id
        and not exists (select 1 from public._archive_contest_winner_media(p_contest_id) wm where wm.media_id=sm.id)), '[]'::jsonb),
    'retained_objects', coalesce((select jsonb_agg(jsonb_build_object('bucket', o.bucket, 'path', o.path) order by o.bucket,o.path)
      from (
        select distinct wm.storage_bucket bucket, wm.storage_path path
        from public._archive_contest_winner_media(p_contest_id) wm
        union
        select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
        from public._archive_contest_winner_media(p_contest_id) wm
        join storage.objects so on so.bucket_id='contest-thumbnails'
          and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
        union
        select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg'
        from public._archive_contest_winner_media(p_contest_id) wm
        join storage.objects so on so.bucket_id='contest-thumbnails'
          and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg'
      ) o), '[]'::jsonb),
    'objects', coalesce((
      with media_scope as (
        select distinct sm.id media_id, sm.submission_id, sm.storage_bucket, sm.storage_path
        from public.submission_media sm
        join public.submissions s on s.id=sm.submission_id
        join public.contest_categories cc on cc.id=s.category_id
        where cc.contest_id=p_contest_id
      ), candidates as (
        select storage_bucket bucket, storage_path path from media_scope
        union select 'contest-thumbnails', 'submission-thumbnails/'||submission_id::text||'/'||media_id::text||'.webp' from media_scope
        union select 'contest-thumbnails', 'submission-thumbnails/'||submission_id::text||'/'||media_id::text||'.jpg' from media_scope
        union select 'contest-videos', 'submission-thumbnails/'||submission_id::text||'/'||media_id::text||'.webp' from media_scope
        union select 'contest-videos', 'submission-thumbnails/'||submission_id::text||'/'||media_id::text||'.jpg' from media_scope
      ), retained as (
        select distinct wm.storage_bucket bucket, wm.storage_path path
        from public._archive_contest_winner_media(p_contest_id) wm
        union
        select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
        from public._archive_contest_winner_media(p_contest_id) wm
        join storage.objects so on so.bucket_id='contest-thumbnails'
          and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.webp'
        union
        select distinct 'contest-thumbnails', 'submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg'
        from public._archive_contest_winner_media(p_contest_id) wm
        join storage.objects so on so.bucket_id='contest-thumbnails'
          and so.name='submission-thumbnails/'||wm.submission_id::text||'/'||wm.media_id::text||'.jpg'
      )
      select jsonb_agg(jsonb_build_object('bucket', so.bucket_id, 'path', so.name) order by so.bucket_id,so.name)
      from storage.objects so
      join candidates c on c.bucket=so.bucket_id and c.path=so.name
      where not exists (select 1 from retained r where r.bucket=so.bucket_id and r.path=so.name)
    ), '[]'::jsonb)
  );

  if v_retry then
    update public.contest_archive_requests set plan = v_plan where id = v_request;
  else
    insert into public.contest_archive_requests(contest_id, requested_by, plan)
      values (p_contest_id, auth.uid(), v_plan) returning id into v_request;
    update public.contests set deletion_locked_at=now(), updated_at=now() where id=p_contest_id;
  end if;
  return v_plan || jsonb_build_object('request_id', v_request, 'status', 'PENDING');
end;
$function$;

revoke execute on function public.admin_prepare_contest_archive(uuid) from public,anon,service_role;
grant execute on function public.admin_prepare_contest_archive(uuid) to authenticated;
