-- Preserve the current official finalist media when a Contest is archived.
-- Historical rows always remain in the database. Storage cleanup removes:
--   * every media object belonging to a non-finalist submission;
--   * obsolete/non-current media versions even for finalist submissions;
--   * generated thumbnails associated with those deletable media rows.
-- The current FINALIZED media (and thumbnail) for each official finalist is retained.

create or replace function public.admin_prepare_contest_archive(p_contest_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_contest public.contests%rowtype;
  v_existing public.contest_archive_requests%rowtype;
  v_request uuid;
  v_plan jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;
  if v_contest.archived_at is not null then
    return jsonb_build_object('status', 'COMPLETED', 'contest_id', p_contest_id);
  end if;
  if v_contest.status <> 'CLOSED' then
    raise exception using errcode = 'P0001', message = 'contest_not_archivable';
  end if;
  if exists (
    select 1
      from public.contest_categories cc
     where cc.contest_id = p_contest_id
       and not exists (
         select 1
           from public._current_contest_result_snapshots(p_contest_id) rs
          where rs.category_id = cc.id
            and rs.status = 'PUBLISHED'
            and rs.invalidated_at is null
       )
  ) then
    raise exception using errcode = 'P0001', message = 'results_not_published';
  end if;

  if v_contest.deletion_locked_at is not null then
    select * into v_existing
      from public.contest_archive_requests
     where contest_id = p_contest_id and status = 'PENDING'
     order by created_at desc limit 1 for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'archive_in_progress';
    end if;
    return v_existing.plan || jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status);
  end if;

  with contest_media as (
    select sm.id, sm.submission_id, sm.storage_bucket, sm.storage_path,
           sm.status, sm.is_current,
           exists (
             select 1
               from public.contest_finalists f
               join public._current_contest_result_snapshots(p_contest_id) current_snapshot
                 on current_snapshot.snapshot_id = f.snapshot_id
                and current_snapshot.status = 'PUBLISHED'
                and current_snapshot.invalidated_at is null
              where f.contest_id = p_contest_id
                and f.submission_id = s.id
           ) as is_official_finalist
      from public.submission_media sm
      join public.submissions s on s.id = sm.submission_id
      join public.contest_categories cc on cc.id = s.category_id
     where cc.contest_id = p_contest_id
  ),
  protected_media as (
    select *
      from contest_media
     where is_official_finalist
       and status = 'FINALIZED'
       and is_current
  ),
  deletable_media as (
    select *
      from contest_media
     where id not in (select id from protected_media)
  ),
  object_rows as (
    select distinct dm.storage_bucket as bucket, dm.storage_path as path
      from deletable_media dm
     where dm.storage_bucket is not null and dm.storage_path is not null
    union
    select distinct 'contest-thumbnails',
           'submission-thumbnails/' || dm.submission_id::text || '/' || dm.id::text || '.webp'
      from deletable_media dm
    union
    select distinct 'contest-thumbnails',
           'submission-thumbnails/' || dm.submission_id::text || '/' || dm.id::text || '.jpg'
      from deletable_media dm
    union
    select distinct 'contest-videos',
           'submission-thumbnails/' || dm.submission_id::text || '/' || dm.id::text || '.webp'
      from deletable_media dm
    union
    select distinct 'contest-videos',
           'submission-thumbnails/' || dm.submission_id::text || '/' || dm.id::text || '.jpg'
      from deletable_media dm
  )
  select jsonb_build_object(
    'contest_id', p_contest_id,
    'contest_name', v_contest.name,
    'media_count', (select count(*) from contest_media),
    'delete_media_count', (select count(*) from deletable_media),
    'retained_media_count', (select count(*) from protected_media),
    'delete_media_ids', coalesce((
      select jsonb_agg(dm.id order by dm.id) from deletable_media dm
    ), '[]'::jsonb),
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', object_rows.bucket, 'path', object_rows.path)
                       order by object_rows.bucket, object_rows.path)
        from object_rows
    ), '[]'::jsonb)
  ) into v_plan;

  insert into public.contest_archive_requests(contest_id, requested_by, plan)
  values (p_contest_id, auth.uid(), v_plan)
  returning id into v_request;

  update public.contests
     set deletion_locked_at = now(), updated_at = now()
   where id = p_contest_id;

  return v_plan || jsonb_build_object('request_id', v_request, 'status', 'PENDING');
end;
$function$;

create or replace function public.admin_finalize_contest_archive(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_request public.contest_archive_requests%rowtype;
  v_contest public.contests%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_request
    from public.contest_archive_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'archive_request_not_found';
  end if;
  if v_request.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'contest_id', v_request.contest_id);
  end if;

  select * into v_contest
    from public.contests
   where id = v_request.contest_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_request.plan->'objects') object_row
      join storage.objects so
        on so.bucket_id = object_row->>'bucket'
       and so.name = object_row->>'path'
  ) then
    raise exception using errcode = 'P0001', message = 'storage_delete_required';
  end if;

  -- Mark only the media explicitly included in the archive deletion plan.
  -- Current FINALIZED media for official finalists is deliberately absent
  -- from delete_media_ids and therefore remains current and reusable.
  update public.submission_media sm
     set storage_deleted_at = coalesce(sm.storage_deleted_at, now()),
         storage_deleted_by = coalesce(sm.storage_deleted_by, auth.uid()),
         is_current = false
   where sm.id in (
     select value::text::uuid
       from jsonb_array_elements_text(coalesce(v_request.plan->'delete_media_ids', '[]'::jsonb)) as ids(value)
   );

  update public.contests
     set archived_at = coalesce(archived_at, now()),
         deletion_locked_at = null,
         updated_at = now()
   where id = v_request.contest_id;

  update public.contest_archive_requests
     set status = 'COMPLETED', completed_at = now()
   where id = v_request.id;

  return jsonb_build_object(
    'status', 'COMPLETED',
    'contest_id', v_request.contest_id,
    'deleted_media_count', coalesce((v_request.plan->>'delete_media_count')::integer, 0),
    'retained_media_count', coalesce((v_request.plan->>'retained_media_count')::integer, 0)
  );
end;
$function$;

revoke all on function public.admin_prepare_contest_archive(uuid),
  public.admin_finalize_contest_archive(uuid)
  from public, anon, service_role;
grant execute on function public.admin_prepare_contest_archive(uuid),
  public.admin_finalize_contest_archive(uuid)
  to authenticated;
