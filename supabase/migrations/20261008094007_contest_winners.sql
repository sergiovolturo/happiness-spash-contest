-- Tranche 1 — Definitive winner model.
-- This migration intentionally does not change Contest lifecycle, voting,
-- result freezing, tie resolution, finalist publication or media retention.

alter table public.contest_categories
  add column if not exists winner_required boolean not null default true;

-- A composite reference below keeps the winner's Contest/category/submission
-- aligned with the explicitly linked published finalist row.
alter table public.contest_finalists
  add constraint contest_finalists_identity_unique
  unique (id, contest_id, category_id, submission_id);

create table public.contest_winners (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete restrict,
  category_id uuid not null references public.contest_categories(id) on delete restrict,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  finalist_id uuid not null,
  selected_by_auth_user_id uuid references auth.users(id) on delete set null,
  selected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, category_id),
  constraint contest_winners_finalist_fk
    foreign key (finalist_id, contest_id, category_id, submission_id)
    references public.contest_finalists (id, contest_id, category_id, submission_id)
    on delete restrict
);

create index contest_winners_contest_category_idx
  on public.contest_winners (contest_id, category_id);

create index contest_winners_submission_idx
  on public.contest_winners (submission_id);

alter table public.contest_winners enable row level security;

create policy contest_winners_admin_select
  on public.contest_winners for select to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
    )
  );

-- The table is intentionally not directly writable by client roles. All
-- inserts/replacements go through the validated Admin RPC below.
revoke all on table public.contest_winners from public, anon, authenticated, service_role;
grant select on table public.contest_winners to authenticated;

create or replace function public.admin_select_contest_winner(
  p_contest_id uuid,
  p_category_id uuid,
  p_submission_id uuid
)
returns public.contest_winners
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_finalist public.contest_finalists%rowtype;
  v_winner public.contest_winners%rowtype;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  -- Serialize winner changes with archive state changes. CLOSED is not
  -- required here by design; lifecycle transition belongs to a later tranche.
  select * into v_contest
    from public.contests
   where id = p_contest_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;
  if v_contest.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'contest_archived';
  end if;
  if v_contest.deletion_locked_at is not null then
    raise exception using errcode = 'P0001', message = 'contest_archive_locked';
  end if;

  select cf.* into v_finalist
    from public.contest_finalists cf
    join public.contest_result_snapshots crs on crs.id = cf.snapshot_id
    join public.submissions s on s.id = cf.submission_id
   where cf.contest_id = p_contest_id
     and cf.category_id = p_category_id
     and cf.submission_id = p_submission_id
     and cf.published_at is not null
     and cf.published_by_auth_user_id is not null
     and crs.contest_id = p_contest_id
     and crs.category_id = p_category_id
     and crs.status = 'PUBLISHED'
     and s.category_id = p_category_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'submission_not_published_finalist';
  end if;

  insert into public.contest_winners (
    contest_id,
    category_id,
    submission_id,
    finalist_id,
    selected_by_auth_user_id,
    selected_at,
    updated_at
  ) values (
    p_contest_id,
    p_category_id,
    p_submission_id,
    v_finalist.id,
    v_auth_user_id,
    now(),
    now()
  )
  on conflict (contest_id, category_id) do update
    set submission_id = excluded.submission_id,
        finalist_id = excluded.finalist_id,
        selected_by_auth_user_id = excluded.selected_by_auth_user_id,
        selected_at = excluded.selected_at,
        updated_at = excluded.updated_at
  returning * into v_winner;

  return v_winner;
end;
$function$;

revoke execute on function public.admin_select_contest_winner(uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.admin_select_contest_winner(uuid, uuid, uuid)
  to authenticated;
