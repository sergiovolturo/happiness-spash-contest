-- Step 5 — Explicit, audited and race-safe Admin tie resolution.

create table public.contest_tie_resolutions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.contest_result_snapshots(id) on delete restrict,
  contest_id uuid not null references public.contests(id) on delete restrict,
  category_id uuid not null references public.contest_categories(id) on delete restrict,
  tie_submission_ids uuid[] not null check (cardinality(tie_submission_ids) > 0),
  selected_submission_ids uuid[] not null check (cardinality(selected_submission_ids) > 0),
  decision_note text,
  decided_by_auth_user_id uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now()
);

create index contest_tie_resolutions_snapshot_idx
  on public.contest_tie_resolutions (snapshot_id, decided_at desc, id desc);

alter table public.contest_tie_resolutions enable row level security;

create policy contest_tie_resolutions_admin_select
  on public.contest_tie_resolutions for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

revoke all on table public.contest_tie_resolutions from public, anon, authenticated, service_role;
grant select on table public.contest_tie_resolutions to authenticated;

create or replace function public.resolve_contest_result_tie(
  p_snapshot_id uuid,
  p_selected_submission_ids uuid[],
  p_decision_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_snapshot public.contest_result_snapshots%rowtype;
  v_cutoff_rank integer;
  v_tie_count integer;
  v_safe_count integer;
  v_required_count integer;
  v_tie_ids uuid[];
  v_resolution_id uuid;
  v_distinct_count integer;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  select * into v_snapshot
    from public.contest_result_snapshots
   where id = p_snapshot_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'snapshot_not_found';
  end if;
  if v_snapshot.status <> 'TIE_REQUIRES_DECISION' then
    raise exception using errcode = 'P0001', message = 'tie_not_required';
  end if;

  select min(e.rank_position), count(*), array_agg(e.submission_id order by e.submission_id)
    into v_cutoff_rank, v_tie_count, v_tie_ids
    from public.contest_result_entries e
   where e.snapshot_id = p_snapshot_id
     and e.is_cutoff_tie;
  if v_cutoff_rank is null or v_tie_count = 0 then
    raise exception using errcode = 'P0001', message = 'tie_not_found';
  end if;

  select count(*) into v_safe_count
    from public.contest_result_entries e
   where e.snapshot_id = p_snapshot_id
     and e.rank_position < v_cutoff_rank;
  v_required_count := v_snapshot.finalists_count - v_safe_count;
  if v_required_count <= 0 or v_required_count >= v_tie_count then
    raise exception using errcode = 'P0001', message = 'tie_not_actionable';
  end if;
  if p_selected_submission_ids is null or cardinality(p_selected_submission_ids) <> v_required_count then
    raise exception using errcode = 'P0001', message = 'invalid_tie_selection_count';
  end if;

  select count(distinct selected_id), count(*)
    into v_distinct_count, v_safe_count
    from unnest(p_selected_submission_ids) as selected_id;
  if v_distinct_count <> v_safe_count then
    raise exception using errcode = 'P0001', message = 'duplicate_tie_selection';
  end if;
  if exists (
    select 1
      from unnest(p_selected_submission_ids) selected_id
     where not (selected_id = any(v_tie_ids))
  ) then
    raise exception using errcode = 'P0001', message = 'submission_not_in_tie';
  end if;

  insert into public.contest_tie_resolutions (
    snapshot_id, contest_id, category_id, tie_submission_ids,
    selected_submission_ids, decision_note, decided_by_auth_user_id
  ) values (
    v_snapshot.id, v_snapshot.contest_id, v_snapshot.category_id,
    v_tie_ids, p_selected_submission_ids, nullif(btrim(p_decision_note), ''),
    v_auth_user_id
  ) returning id into v_resolution_id;
  return v_resolution_id;
end;
$function$;

revoke execute on function public.resolve_contest_result_tie(uuid, uuid[], text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_contest_result_tie(uuid, uuid[], text)
  to authenticated;

create or replace function public.confirm_contest_finalists(p_snapshot_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_snapshot public.contest_result_snapshots%rowtype;
  v_resolution public.contest_tie_resolutions%rowtype;
  v_cutoff_rank integer;
  v_inserted integer;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select * into v_snapshot from public.contest_result_snapshots where id = p_snapshot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'snapshot_not_found'; end if;
  if v_snapshot.status = 'TIE_REQUIRES_DECISION' then
    select * into v_resolution
      from public.contest_tie_resolutions
     where snapshot_id = p_snapshot_id
     order by decided_at desc, id desc
     limit 1;
    if not found then raise exception using errcode = 'P0001', message = 'tie_requires_decision'; end if;
    select min(e.rank_position) into v_cutoff_rank
      from public.contest_result_entries e
     where e.snapshot_id = p_snapshot_id and e.is_cutoff_tie;
    insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, e.submission_id
      from public.contest_result_entries e
     where e.snapshot_id = p_snapshot_id and e.rank_position < v_cutoff_rank
    union all
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, selected_id
      from unnest(v_resolution.selected_submission_ids) selected_id;
  elsif v_snapshot.status = 'FROZEN' then
    insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, e.submission_id
      from public.contest_result_entries e
     where e.snapshot_id = p_snapshot_id and e.rank_position <= v_snapshot.finalists_count;
  else
    raise exception using errcode = 'P0001', message = 'snapshot_not_confirmable';
  end if;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_snapshot.finalists_count then
    raise exception using errcode = 'P0001', message = 'invalid_finalist_count';
  end if;
  update public.contest_result_snapshots
     set status = 'CONFIRMED', confirmed_at = now(), confirmed_by_auth_user_id = v_auth_user_id
   where id = p_snapshot_id;
  return v_inserted;
end;
$function$;

revoke execute on function public.confirm_contest_finalists(uuid)
  from public, anon, service_role;
grant execute on function public.confirm_contest_finalists(uuid)
  to authenticated;
