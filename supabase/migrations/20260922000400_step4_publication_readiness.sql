-- Step 4 — Voting readiness, publication and publication revocation foundation.
-- This migration excludes votes, ranking, finalists, retention, notifications,
-- UI and any change to the legacy bucket configuration.

create table public.submission_publications (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.submissions(id) on delete restrict,
  media_id uuid not null
    references public.submission_media(id) on delete restrict,
  published_at timestamptz not null default now(),
  published_by_auth_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by_auth_user_id uuid references auth.users(id) on delete set null,
  revoke_reason text,
  check (revoked_at is null or revoked_by_auth_user_id is not null),
  check (revoked_at is null or nullif(btrim(revoke_reason), '') is not null)
);

create unique index submission_publications_active_uidx
  on public.submission_publications (submission_id)
  where revoked_at is null;

create unique index submission_publications_submission_media_uidx
  on public.submission_publications (submission_id, media_id);

create index submission_publications_active_media_idx
  on public.submission_publications (media_id)
  where revoked_at is null;

alter table public.submission_publications enable row level security;

create policy submission_publications_select_admin
  on public.submission_publications for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

revoke select, insert, update, delete on table public.submission_publications from anon;
revoke insert, update, delete on table public.submission_publications from authenticated;
grant select on table public.submission_publications to authenticated;

-- Public consumers receive only the identifiers needed to resolve published
-- media. Administrative actor and revocation fields remain off this surface.
create view public.published_submission_media as
select
  sp.id as publication_id,
  sp.submission_id,
  sp.media_id,
  sp.published_at
from public.submission_publications sp
join public.submission_media sm on sm.id = sp.media_id
where sp.revoked_at is null
  and sm.status = 'FINALIZED'
  and sm.is_current;

revoke all on public.published_submission_media from public;
grant select on public.published_submission_media to anon, authenticated;

create or replace function public.open_contest_voting(
  p_contest_id uuid
)
returns public.contests
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_approved_count bigint;
  v_pending_count bigint;
  v_inconsistent_count bigint;
  v_missing_media_count bigint;
  v_result public.contests;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select c.*
    into v_contest
    from public.contests c
   where c.id = p_contest_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;

  if v_contest.status = 'VOTING_OPEN' then
    return v_contest;
  end if;

  if v_contest.status not in ('MODERATION', 'READY_FOR_VOTING') then
    raise exception using errcode = 'P0001', message = 'contest_not_ready_state';
  end if;

  select
    count(*) filter (where s.status = 'APPROVED'),
    count(*) filter (
      where s.status = 'PENDING'
        and cc.contest_id = p_contest_id
        and cp.contest_id = p_contest_id
    ),
    count(*) filter (
      where s.status in ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED')
        and (cc.contest_id <> p_contest_id or cp.contest_id <> p_contest_id)
    )
    into v_approved_count, v_pending_count, v_inconsistent_count
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
    join public.contest_participations cp on cp.id = s.participation_id
   where cc.contest_id = p_contest_id
      or cp.contest_id = p_contest_id;

  select count(*)
    into v_missing_media_count
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
    join public.contest_participations cp on cp.id = s.participation_id
   where s.status = 'APPROVED'
     and cc.contest_id = p_contest_id
     and cp.contest_id = p_contest_id
     and (
       select count(*)
         from public.submission_media sm
        where sm.submission_id = s.id
          and sm.status = 'FINALIZED'
          and sm.is_current
     ) <> 1;

  if v_approved_count = 0
     or v_pending_count > 0
     or v_inconsistent_count > 0
     or v_missing_media_count > 0 then
    raise exception using errcode = 'P0001', message = 'contest_not_ready';
  end if;

  insert into public.submission_publications (
    submission_id, media_id, published_at, published_by_auth_user_id
  )
  select s.id, sm.id, now(), v_auth_user_id
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
    join public.contest_participations cp on cp.id = s.participation_id
    join public.submission_media sm
      on sm.submission_id = s.id
     and sm.status = 'FINALIZED'
     and sm.is_current
   where s.status = 'APPROVED'
     and cc.contest_id = p_contest_id
     and cp.contest_id = p_contest_id;

  update public.contests
     set status = 'VOTING_OPEN', updated_at = now()
   where id = p_contest_id
  returning * into v_result;

  return v_result;
end;
$function$;

create or replace function public.revoke_published_submission(
  p_publication_id uuid,
  p_revoke_reason text
)
returns public.submission_publications
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_publication public.submission_publications%rowtype;
  v_result public.submission_publications;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select sp.*
    into v_publication
    from public.submission_publications sp
   where sp.id = p_publication_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'publication_not_found';
  end if;

  if v_publication.revoked_at is not null then
    return v_publication;
  end if;

  if nullif(btrim(coalesce(p_revoke_reason, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'revoke_reason_required';
  end if;

  update public.submission_publications
     set revoked_at = now(),
         revoked_by_auth_user_id = v_auth_user_id,
         revoke_reason = btrim(p_revoke_reason)
   where id = p_publication_id
  returning * into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.open_contest_voting(uuid) from public, anon;
grant execute on function public.open_contest_voting(uuid) to authenticated;
revoke execute on function public.revoke_published_submission(uuid, text) from public, anon;
grant execute on function public.revoke_published_submission(uuid, text) to authenticated;

-- Storage policy evaluation must not grant anon direct SELECT on the
-- administrative publication table. This boolean helper exposes no rows or
-- metadata and is callable only as part of the Storage policy check.
create or replace function public.storage_object_is_published(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.submission_publications sp
      join public.submission_media sm on sm.id = sp.media_id
     where sp.revoked_at is null
       and sm.status = 'FINALIZED'
       and sm.is_current
       and sm.storage_bucket = p_bucket_id
       and sm.storage_path = p_object_name
  );
$function$;

revoke execute on function public.storage_object_is_published(text, text) from public;
grant execute on function public.storage_object_is_published(text, text) to anon, authenticated;

-- The bucket remains private. The policy exposes only objects whose exact path
-- is the media referenced by an active, non-revoked publication.
create policy published_submission_media_objects_select
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'contest-videos'
    and public.storage_object_is_published(storage.objects.bucket_id, storage.objects.name)
  );
