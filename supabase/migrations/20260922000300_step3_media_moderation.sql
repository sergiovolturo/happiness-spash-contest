-- Step 3 — Private submission media and moderation foundation.
-- Legacy Storage objects remain private and their policies are unchanged.
-- This migration excludes publication, voting, ranking, finalists, retention,
-- notifications, UI and public video access.

create table public.submission_media (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.submissions(id) on delete restrict,
  storage_bucket text not null default 'contest-videos'
    check (storage_bucket = 'contest-videos'),
  storage_path text not null unique,
  original_filename text not null
    check (length(btrim(original_filename)) > 0),
  mime_type text not null
    check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  file_size_bytes bigint not null
    check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  duration_seconds numeric(8, 2),
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  version_no integer not null check (version_no > 0),
  status text not null default 'PREPARED'
    check (status in ('PREPARED', 'FINALIZED')),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (storage_path like 'submissions/%/%/upload'),
  check (not is_current or status = 'FINALIZED')
);

create unique index submission_media_current_uidx
  on public.submission_media (submission_id)
  where status = 'FINALIZED' and is_current;

create index submission_media_submission_created_idx
  on public.submission_media (submission_id, created_at desc);

create table public.submission_moderation_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.submissions(id) on delete restrict,
  moderated_by_auth_user_id uuid references auth.users(id) on delete set null,
  decision public.submission_status not null
    check (decision in ('APPROVED', 'REJECTED')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (decision = 'REJECTED' or rejection_reason is null)
);

create index submission_moderation_events_submission_idx
  on public.submission_moderation_events (submission_id, created_at desc);

alter table public.submission_media enable row level security;
alter table public.submission_moderation_events enable row level security;

create policy submission_media_select_owner_or_admin
  on public.submission_media for select
  to authenticated
  using (
    exists (
      select 1
      from public.submissions s
      join public.contest_participations cp on cp.id = s.participation_id
      join public.platform_identities pi on pi.id = cp.identity_id
      where s.id = submission_media.submission_id
        and pi.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

create policy submission_moderation_events_select_owner_or_admin
  on public.submission_moderation_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.submissions s
      join public.contest_participations cp on cp.id = s.participation_id
      join public.platform_identities pi on pi.id = cp.identity_id
      where s.id = submission_moderation_events.submission_id
        and pi.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

revoke insert, update, delete on table public.submission_media from authenticated;
revoke insert, update, delete on table public.submission_moderation_events from authenticated;
grant select on table public.submission_media to authenticated;
grant select on table public.submission_moderation_events to authenticated;

-- Creates metadata and reserves a private path. The actual object upload is
-- performed separately against Storage after this RPC succeeds.
create or replace function public.prepare_submission_media_upload(
  p_submission_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_duration_seconds numeric
)
returns public.submission_media
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_submission public.submissions%rowtype;
  v_identity_auth_user_id uuid;
  v_media public.submission_media;
  v_media_id uuid := gen_random_uuid();
  v_version_no integer;
begin
  if v_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  select s.*
    into v_submission
    from public.submissions s
   where s.id = p_submission_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'submission_not_found';
  end if;

  select pi.auth_user_id
    into v_identity_auth_user_id
    from public.contest_participations cp
    join public.platform_identities pi on pi.id = cp.identity_id
   where cp.id = v_submission.participation_id;

  if v_identity_auth_user_id is distinct from v_auth_user_id then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  if v_submission.status not in ('PENDING', 'REJECTED') then
    raise exception using errcode = 'P0001', message = 'submission_not_uploadable';
  end if;

  if v_submission.status = 'PENDING' and exists (
    select 1 from public.submission_media sm
    where sm.submission_id = p_submission_id
      and sm.status = 'FINALIZED'
      and sm.is_current
  ) then
    raise exception using errcode = 'P0001', message = 'media_already_exists';
  end if;

  if p_mime_type not in ('video/mp4', 'video/webm', 'video/quicktime') then
    raise exception using errcode = 'P0001', message = 'unsupported_media_type';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 10485760 then
    raise exception using errcode = 'P0001', message = 'media_size_invalid';
  end if;

  select coalesce(max(sm.version_no), 0) + 1
    into v_version_no
    from public.submission_media sm
   where sm.submission_id = p_submission_id;

  insert into public.submission_media (
    id, submission_id, storage_path, original_filename, mime_type,
    file_size_bytes, duration_seconds, created_by_auth_user_id,
    version_no, status, is_current
  ) values (
    v_media_id,
    p_submission_id,
    'submissions/' || p_submission_id::text || '/' || v_media_id::text || '/upload',
    p_original_filename,
    p_mime_type,
    p_file_size_bytes,
    p_duration_seconds,
    v_auth_user_id,
    v_version_no,
    'PREPARED',
    false
  ) returning * into v_media;

  return v_media;
end;
$function$;

create or replace function public.finalize_submission_media_upload(
  p_media_id uuid
)
returns public.submission_media
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_media public.submission_media%rowtype;
  v_submission public.submissions%rowtype;
  v_identity_auth_user_id uuid;
  v_object_mime_type text;
  v_object_size bigint;
  v_result public.submission_media;
begin
  if v_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  v_is_admin := exists (
    select 1 from public.admin_users au
    where au.user_id = v_auth_user_id
  );

  select sm.*
    into v_media
    from public.submission_media sm
   where sm.id = p_media_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'media_not_found';
  end if;

  select s.*
    into v_submission
    from public.submissions s
   where s.id = v_media.submission_id
   for update;

  select pi.auth_user_id
    into v_identity_auth_user_id
    from public.contest_participations cp
    join public.platform_identities pi on pi.id = cp.identity_id
   where cp.id = v_submission.participation_id;

  if not v_is_admin and v_identity_auth_user_id is distinct from v_auth_user_id then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  if v_media.status <> 'PREPARED' or v_media.is_current then
    raise exception using errcode = 'P0001', message = 'media_not_prepared';
  end if;

  if not exists (
    select 1
      from storage.objects so
     where so.bucket_id = v_media.storage_bucket
       and so.name = v_media.storage_path
  ) then
    raise exception using errcode = 'P0001', message = 'storage_object_missing';
  end if;

  select so.metadata ->> 'mimetype',
         case when (so.metadata ->> 'size') ~ '^[0-9]+$'
              then (so.metadata ->> 'size')::bigint end
    into v_object_mime_type, v_object_size
    from storage.objects so
   where so.bucket_id = v_media.storage_bucket
     and so.name = v_media.storage_path;

  if v_object_mime_type is distinct from v_media.mime_type then
    raise exception using errcode = 'P0001', message = 'storage_object_type_mismatch';
  end if;

  if v_object_size is null or v_object_size <> v_media.file_size_bytes or v_object_size > 10485760 then
    raise exception using errcode = 'P0001', message = 'storage_object_size_mismatch';
  end if;

  update public.submission_media
     set status = 'FINALIZED', is_current = false
   where submission_id = v_media.submission_id
     and id <> p_media_id
     and status = 'FINALIZED'
     and is_current;

  update public.submission_media
     set status = 'FINALIZED', is_current = true
   where id = p_media_id
  returning * into v_result;

  if v_submission.status = 'REJECTED' then
    update public.submissions
       set status = 'PENDING', rejection_reason = null, updated_at = now()
     where id = v_submission.id;
  end if;

  return v_result;
end;
$function$;

create or replace function public.moderate_submission(
  p_submission_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns public.submissions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_submission public.submissions%rowtype;
  v_decision public.submission_status;
  v_result public.submissions;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception using errcode = 'P0001', message = 'invalid_moderation_decision';
  end if;

  if p_decision = 'REJECTED' and nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'rejection_reason_required';
  end if;

  v_decision := p_decision::public.submission_status;

  select s.*
    into v_submission
    from public.submissions s
   where s.id = p_submission_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'submission_not_found';
  end if;

  if v_submission.status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'submission_not_pending';
  end if;

  if not exists (
    select 1 from public.submission_media sm
    where sm.submission_id = p_submission_id
      and sm.status = 'FINALIZED'
      and sm.is_current
  ) then
    raise exception using errcode = 'P0001', message = 'current_media_required';
  end if;

  update public.submissions
     set status = v_decision,
         rejection_reason = case when v_decision = 'REJECTED' then btrim(p_rejection_reason) else null end,
         updated_at = now()
   where id = p_submission_id
  returning * into v_result;

  insert into public.submission_moderation_events (
    submission_id, moderated_by_auth_user_id, decision, rejection_reason
  ) values (
    p_submission_id,
    v_auth_user_id,
    v_decision,
    case when v_decision = 'REJECTED' then btrim(p_rejection_reason) else null end
  );

  return v_result;
end;
$function$;

revoke execute on function public.prepare_submission_media_upload(uuid, text, text, bigint, numeric) from public, anon;
grant execute on function public.prepare_submission_media_upload(uuid, text, text, bigint, numeric) to authenticated;
revoke execute on function public.finalize_submission_media_upload(uuid) from public, anon;
grant execute on function public.finalize_submission_media_upload(uuid) to authenticated;
revoke execute on function public.moderate_submission(uuid, text, text) from public, anon;
grant execute on function public.moderate_submission(uuid, text, text) to authenticated;

-- New-domain objects use a separate path namespace in the existing private
-- bucket. Legacy policies remain untouched for backwards compatibility.
create policy submission_media_objects_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'contest-videos'
    and name like 'submissions/%/%/upload'
    and exists (
      select 1
      from public.submission_media sm
      join public.submissions s on s.id = sm.submission_id
      join public.contest_participations cp on cp.id = s.participation_id
      join public.platform_identities pi on pi.id = cp.identity_id
      where sm.storage_bucket = storage.objects.bucket_id
        and sm.storage_path = storage.objects.name
        and sm.status = 'PREPARED'
        and sm.is_current = false
        and sm.created_by_auth_user_id = auth.uid()
        and pi.auth_user_id = auth.uid()
    )
  );

create policy submission_media_objects_select_owner_or_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'contest-videos'
    and name like 'submissions/%/%/upload'
    and (
      exists (
        select 1
        from public.submission_media sm
        join public.submissions s on s.id = sm.submission_id
        join public.contest_participations cp on cp.id = s.participation_id
        join public.platform_identities pi on pi.id = cp.identity_id
        where sm.storage_path = storage.objects.name
          and pi.auth_user_id = auth.uid()
      )
      or exists (
        select 1 from public.admin_users au
        where au.user_id = auth.uid()
      )
    )
  );
