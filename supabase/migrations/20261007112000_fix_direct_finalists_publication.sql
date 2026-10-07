-- Keep the simplified post-voting flow (FROZEN/TIE_REQUIRES_DECISION -> PUBLISHED)
-- compatible with legacy snapshot integrity constraints.
--
-- PUBLISHED snapshots must:
--   * no longer advertise a pending tie decision;
--   * carry confirmation metadata required by the historical schema.
--
-- This remains a single atomic publication operation. No separate Admin
-- "confirm finalists" step is reintroduced.

create or replace function public.publish_contest_finalists(p_snapshot_id uuid)
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
  v_candidate_count integer;
  v_effective_finalists_count integer;
  v_inserted integer;
  v_published_at timestamptz := now();
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
  if v_snapshot.invalidated_at is not null then
    raise exception using errcode = 'P0001', message = 'snapshot_invalidated';
  end if;
  if v_snapshot.status not in ('FROZEN', 'TIE_REQUIRES_DECISION', 'CONFIRMED') then
    raise exception using errcode = 'P0001', message = 'snapshot_not_publishable';
  end if;

  select count(*)
    into v_candidate_count
    from public.contest_result_entries
   where snapshot_id = p_snapshot_id;

  v_effective_finalists_count := least(v_snapshot.finalists_count, v_candidate_count);

  if v_snapshot.status = 'TIE_REQUIRES_DECISION' then
    select * into v_resolution
      from public.contest_tie_resolutions
     where snapshot_id = p_snapshot_id
     order by decided_at desc, id desc
     limit 1;

    if not found then
      raise exception using errcode = 'P0001', message = 'tie_requires_decision';
    end if;

    select min(rank_position)
      into v_cutoff_rank
      from public.contest_result_entries
     where snapshot_id = p_snapshot_id
       and is_cutoff_tie;

    insert into public.contest_finalists (
      snapshot_id, contest_id, category_id, submission_id
    )
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, submission_id
      from public.contest_result_entries
     where snapshot_id = p_snapshot_id
       and rank_position < v_cutoff_rank
    union all
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, selected_id
      from unnest(v_resolution.selected_submission_ids) selected_id;
  elsif v_snapshot.status = 'FROZEN' then
    insert into public.contest_finalists (
      snapshot_id, contest_id, category_id, submission_id
    )
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, submission_id
      from public.contest_result_entries
     where snapshot_id = p_snapshot_id
       and rank_position <= v_snapshot.finalists_count;
  end if;

  get diagnostics v_inserted = row_count;

  if v_snapshot.status = 'CONFIRMED' then
    select count(*)
      into v_inserted
      from public.contest_finalists
     where snapshot_id = p_snapshot_id;
  end if;

  if v_inserted <> v_effective_finalists_count then
    raise exception using errcode = 'P0001', message = 'invalid_finalist_count';
  end if;

  update public.contest_finalists
     set published_at = v_published_at,
         published_by_auth_user_id = v_auth_user_id
   where snapshot_id = p_snapshot_id;

  update public.contest_result_snapshots
     set status = 'PUBLISHED',
         tie_requires_decision = false,
         confirmed_at = coalesce(confirmed_at, v_published_at),
         confirmed_by_auth_user_id = coalesce(confirmed_by_auth_user_id, v_auth_user_id),
         published_at = v_published_at,
         published_by_auth_user_id = v_auth_user_id
   where id = p_snapshot_id;

  return v_inserted;
end;
$function$;

revoke execute on function public.publish_contest_finalists(uuid)
  from public, anon, service_role;
grant execute on function public.publish_contest_finalists(uuid)
  to authenticated;
