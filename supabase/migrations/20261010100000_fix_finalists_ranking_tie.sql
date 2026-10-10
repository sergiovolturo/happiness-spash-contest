-- Fix finalist publication around dense-rank ties.
--
-- rank_position remains a dense rank for display and tie semantics, while
-- ordinal_position is the deterministic row number used to apply the maximum
-- finalist count. A cutoff tie exists only when one vote group crosses the
-- ordinal cutoff; equal-vote groups wholly inside or outside the cutoff do
-- not require a decision.

create or replace function public.freeze_contest_results(p_contest_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_category record;
  v_snapshot_id uuid;
  v_tie boolean;
  v_count integer := 0;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if not exists (
    select 1 from public.contests
     where id = p_contest_id and status = 'VOTING_CLOSED'
  ) then
    raise exception using errcode = 'P0001', message = 'contest_not_closed';
  end if;

  for v_category in
    select id, finalists_count
      from public.contest_categories
     where contest_id = p_contest_id
     order by id
  loop
    if exists (
      select 1 from public.contest_result_snapshots
       where contest_id = p_contest_id
         and category_id = v_category.id
         and invalidated_at is null
    ) then
      continue;
    end if;

    insert into public.contest_result_snapshots (
      contest_id, category_id, finalists_count, status, tie_requires_decision
    ) values (
      p_contest_id, v_category.id, v_category.finalists_count, 'FROZEN', false
    ) returning id into v_snapshot_id;

    with candidates as (
      select s.id as submission_id, count(cv.id)::bigint as vote_count
        from public.submissions s
        join public.contest_categories cc
          on cc.id = s.category_id and cc.id = v_category.id
        join public.submission_publications sp
          on sp.submission_id = s.id and sp.revoked_at is null
        join public.submission_media sm
          on sm.id = sp.media_id and sm.status = 'FINALIZED' and sm.is_current
        left join public.contest_votes cv
          on cv.submission_id = s.id and cv.category_id = v_category.id
       where s.status = 'APPROVED'
       group by s.id
    ), ranked as (
      select c.submission_id,
             c.vote_count,
             dense_rank() over (order by c.vote_count desc)::integer as rank_position,
             row_number() over (order by c.vote_count desc, c.submission_id)::integer as ordinal_position
        from candidates c
    ), cutoff_ties as (
      select vote_count
        from ranked
       group by vote_count
      having min(ordinal_position) <= v_category.finalists_count
         and max(ordinal_position) > v_category.finalists_count
    )
    insert into public.contest_result_entries (
      snapshot_id, submission_id, rank_position, vote_count, is_cutoff_tie
    )
    select v_snapshot_id,
           r.submission_id,
           r.rank_position,
           r.vote_count,
           exists (
             select 1 from cutoff_ties ct where ct.vote_count = r.vote_count
           )
      from ranked r;

    select exists (
      select 1 from public.contest_result_entries e
       where e.snapshot_id = v_snapshot_id and e.is_cutoff_tie
    ) into v_tie;

    if v_tie then
      update public.contest_result_snapshots
         set status = 'TIE_REQUIRES_DECISION', tie_requires_decision = true
       where id = v_snapshot_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

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
  v_candidate_count integer;
  v_effective_finalists_count integer;
  v_inserted integer;
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

  select count(*) into v_candidate_count
    from public.contest_result_entries e
   where e.snapshot_id = p_snapshot_id;
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
     where e.snapshot_id = p_snapshot_id
     order by e.vote_count desc, e.submission_id
     limit v_effective_finalists_count;
  else
    raise exception using errcode = 'P0001', message = 'snapshot_not_confirmable';
  end if;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_effective_finalists_count then
    raise exception using errcode = 'P0001', message = 'invalid_finalist_count';
  end if;

  update public.contest_result_snapshots
     set status = 'CONFIRMED', confirmed_at = now(), confirmed_by_auth_user_id = v_auth_user_id
   where id = p_snapshot_id;
  return v_inserted;
end;
$function$;

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

  select count(*) into v_candidate_count
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
    select min(rank_position) into v_cutoff_rank
      from public.contest_result_entries
     where snapshot_id = p_snapshot_id and is_cutoff_tie;
    insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, submission_id
      from public.contest_result_entries
     where snapshot_id = p_snapshot_id and rank_position < v_cutoff_rank
    union all
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, selected_id
      from unnest(v_resolution.selected_submission_ids) selected_id;
  elsif v_snapshot.status = 'FROZEN' then
    insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, submission_id
      from public.contest_result_entries
     where snapshot_id = p_snapshot_id
     order by vote_count desc, submission_id
     limit v_effective_finalists_count;
  end if;

  get diagnostics v_inserted = row_count;

  if v_snapshot.status = 'CONFIRMED' then
    select count(*) into v_inserted
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

revoke execute on function public.freeze_contest_results(uuid)
  from public, anon, service_role;
grant execute on function public.freeze_contest_results(uuid) to authenticated;
revoke execute on function public.confirm_contest_finalists(uuid)
  from public, anon, service_role;
grant execute on function public.confirm_contest_finalists(uuid) to authenticated;
revoke execute on function public.publish_contest_finalists(uuid)
  from public, anon, service_role;
grant execute on function public.publish_contest_finalists(uuid) to authenticated;
