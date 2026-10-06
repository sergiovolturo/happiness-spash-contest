-- Contest archive media cleanup and per-Contest finalist note.
-- Reuses contests.archived_at and contests.configuration. The archive flow
-- keeps all historical rows and removes only Storage objects and marks the
-- retained media rows as storage-deleted.

alter table public.submission_media
  add column if not exists storage_deleted_at timestamptz,
  add column if not exists storage_deleted_by uuid references auth.users(id) on delete set null;

create index if not exists submission_media_storage_deleted_idx
  on public.submission_media (storage_deleted_at)
  where storage_deleted_at is not null;

create table if not exists public.contest_archive_requests (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  plan jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists contest_archive_requests_contest_idx
  on public.contest_archive_requests (contest_id, status, created_at desc);

alter table public.contest_archive_requests enable row level security;
drop policy if exists contest_archive_requests_admin_select on public.contest_archive_requests;
create policy contest_archive_requests_admin_select
  on public.contest_archive_requests for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create or replace function public.admin_update_contest_finalist_note(
  p_contest_id uuid,
  p_note text default ''
)
returns public.contests
language plpgsql security definer set search_path = ''
as $function$
declare
  v_result public.contests;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  update public.contests
     set configuration = jsonb_set(
       coalesce(configuration, '{}'::jsonb),
       '{admin_finalist_note}',
       to_jsonb(coalesce(p_note, '')),
       true
     ),
         updated_at = now()
   where id = p_contest_id
   returning * into v_result;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;
  return v_result;
end;
$function$;

create or replace function public._admin_archive_storage_delete_allowed(
  p_bucket text,
  p_path text
)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
      from public.contest_archive_requests r
      join public.contests c on c.id = r.contest_id
      cross join lateral jsonb_array_elements(r.plan->'objects') object_row
     where r.status = 'PENDING'
       and c.deletion_locked_at is not null
       and c.archived_at is null
       and (object_row->>'bucket') = p_bucket
       and (object_row->>'path') = p_path
       and exists (
         select 1 from public.admin_users au where au.user_id = auth.uid()
       )
  );
$function$;

drop policy if exists admin_contest_archive_objects_delete on storage.objects;
create policy admin_contest_archive_objects_delete
  on storage.objects for delete to authenticated
  using (public._admin_archive_storage_delete_allowed(bucket_id, name));

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

  v_plan := jsonb_build_object(
    'contest_id', p_contest_id,
    'contest_name', v_contest.name,
    'media_count', (
      select count(*) from public.submission_media sm
       join public.submissions s on s.id = sm.submission_id
       join public.contest_categories cc on cc.id = s.category_id
      where cc.contest_id = p_contest_id
    ),
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', objects.bucket, 'path', objects.path) order by objects.bucket, objects.path)
        from (
          select distinct sm.storage_bucket as bucket, sm.storage_path as path
            from public.submission_media sm
            join public.submissions s on s.id = sm.submission_id
            join public.contest_categories cc on cc.id = s.category_id
           where cc.contest_id = p_contest_id
          union
          select distinct 'contest-thumbnails', 'submission-thumbnails/' || sm.submission_id::text || '/' || sm.id::text || '.webp'
            from public.submission_media sm
            join public.submissions s on s.id = sm.submission_id
            join public.contest_categories cc on cc.id = s.category_id
           where cc.contest_id = p_contest_id
          union
          select distinct 'contest-thumbnails', 'submission-thumbnails/' || sm.submission_id::text || '/' || sm.id::text || '.jpg'
            from public.submission_media sm
            join public.submissions s on s.id = sm.submission_id
            join public.contest_categories cc on cc.id = s.category_id
           where cc.contest_id = p_contest_id
          union
          select distinct 'contest-videos', 'submission-thumbnails/' || sm.submission_id::text || '/' || sm.id::text || '.webp'
            from public.submission_media sm
            join public.submissions s on s.id = sm.submission_id
            join public.contest_categories cc on cc.id = s.category_id
           where cc.contest_id = p_contest_id
          union
          select distinct 'contest-videos', 'submission-thumbnails/' || sm.submission_id::text || '/' || sm.id::text || '.jpg'
            from public.submission_media sm
            join public.submissions s on s.id = sm.submission_id
            join public.contest_categories cc on cc.id = s.category_id
           where cc.contest_id = p_contest_id
        ) objects
    ), '[]'::jsonb)
  );

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
  select * into v_request from public.contest_archive_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'archive_request_not_found';
  end if;
  if v_request.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'contest_id', v_request.contest_id);
  end if;
  select * into v_contest from public.contests where id = v_request.contest_id for update;
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

  update public.submission_media sm
     set storage_deleted_at = coalesce(sm.storage_deleted_at, now()),
         storage_deleted_by = coalesce(sm.storage_deleted_by, auth.uid()),
         is_current = false
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
   where sm.submission_id = s.id
     and cc.contest_id = v_request.contest_id;
  update public.contests
     set archived_at = coalesce(archived_at, now()),
         deletion_locked_at = null,
         updated_at = now()
   where id = v_request.contest_id;
  update public.contest_archive_requests
     set status = 'COMPLETED', completed_at = now()
   where id = v_request.id;
  return jsonb_build_object('status', 'COMPLETED', 'contest_id', v_request.contest_id);
end;
$function$;

revoke all on function public.admin_update_contest_finalist_note(uuid, text),
  public._admin_archive_storage_delete_allowed(text, text),
  public.admin_prepare_contest_archive(uuid),
  public.admin_finalize_contest_archive(uuid)
  from public, anon, service_role;
grant execute on function public.admin_update_contest_finalist_note(uuid, text),
  public.admin_prepare_contest_archive(uuid),
  public.admin_finalize_contest_archive(uuid)
  to authenticated;
