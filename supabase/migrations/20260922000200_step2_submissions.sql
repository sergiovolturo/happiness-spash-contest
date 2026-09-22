-- Step 2 — Category submissions foundation.
-- This migration excludes media, Storage, publication, voting, ranking,
-- finalists, retention, notifications and UI workflows.

create type public.submission_status as enum (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED'
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid not null
    references public.contest_participations(id) on delete restrict,
  category_id uuid not null
    references public.contest_categories(id) on delete restrict,
  status public.submission_status not null default 'PENDING',
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only PENDING, APPROVED and REJECTED occupy a category slot. A withdrawn or
-- cancelled submission therefore permits a future submission for the pair.
create unique index submissions_active_pair_uidx
  on public.submissions (participation_id, category_id)
  where status in ('PENDING', 'APPROVED', 'REJECTED');

create index submissions_category_status_idx
  on public.submissions (category_id, status, created_at);

create index submissions_participation_idx
  on public.submissions (participation_id, created_at);

alter table public.submissions enable row level security;

create policy submissions_select_own_or_admin
  on public.submissions for select
  to authenticated
  using (
    exists (
      select 1
      from public.contest_participations cp
      join public.platform_identities pi on pi.id = cp.identity_id
      where cp.id = submissions.participation_id
        and pi.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

-- Direct writes are deliberately not granted to authenticated users. Creation
-- is available only through create_submission(), which locks the category and
-- checks ownership, lifecycle and cap atomically.
revoke insert, update, delete on table public.submissions from authenticated;
grant select on table public.submissions to authenticated;

create or replace function public.create_submission(
  p_participation_id uuid,
  p_category_id uuid
)
returns public.submissions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_category public.contest_categories%rowtype;
  v_participation public.contest_participations%rowtype;
  v_identity_auth_user_id uuid;
  v_is_admin boolean;
  v_occupied_count bigint;
  v_submission public.submissions;
begin
  v_is_admin := exists (
    select 1
    from public.admin_users au
    where au.user_id = v_auth_user_id
  );

  if v_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  -- The category row is the serialization point for all submissions in the
  -- category. Concurrent callers cannot both observe the last free slot.
  select cc.*
    into v_category
    from public.contest_categories cc
   where cc.id = p_category_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'category_inactive';
  end if;

  if not v_category.is_active then
    raise exception using errcode = 'P0001', message = 'category_inactive';
  end if;

  select cp.*
    into v_participation
    from public.contest_participations cp
   where cp.id = p_participation_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  select pi.auth_user_id
    into v_identity_auth_user_id
    from public.platform_identities pi
   where pi.id = v_participation.identity_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  if not v_is_admin and v_identity_auth_user_id is distinct from v_auth_user_id then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  if v_participation.status <> 'ACTIVE' then
    raise exception using errcode = 'P0001', message = 'participation_not_active';
  end if;

  if v_participation.contest_id <> v_category.contest_id then
    raise exception using errcode = 'P0001', message = 'contest_category_mismatch';
  end if;

  if not exists (
    select 1
      from public.contests c
     where c.id = v_category.contest_id
       and c.status = 'SUBMISSIONS_OPEN'
  ) then
    raise exception using errcode = 'P0001', message = 'contest_not_open';
  end if;

  if exists (
    select 1
      from public.submissions s
     where s.participation_id = p_participation_id
       and s.category_id = p_category_id
       and s.status in ('PENDING', 'APPROVED', 'REJECTED')
  ) then
    raise exception using errcode = 'P0001', message = 'submission_already_exists';
  end if;

  select count(*)
    into v_occupied_count
    from public.submissions s
   where s.category_id = p_category_id
     and s.status in ('PENDING', 'APPROVED', 'REJECTED');

  if v_occupied_count >= v_category.submission_cap then
    raise exception using errcode = 'P0001', message = 'category_full';
  end if;

  insert into public.submissions (participation_id, category_id, status)
  values (p_participation_id, p_category_id, 'PENDING')
  returning * into v_submission;

  return v_submission;
end;
$function$;

revoke execute on function public.create_submission(uuid, uuid) from public, anon;
grant execute on function public.create_submission(uuid, uuid) to authenticated;
