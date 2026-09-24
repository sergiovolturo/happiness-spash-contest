-- Step 5 hardening — invalidate derived results when an Admin deletes a vote.
-- Historical snapshots and tie decisions remain queryable; a subsequent freeze
-- creates a fresh snapshot from contest_votes.

alter table public.contest_result_snapshots
  add column invalidated_at timestamptz,
  add column invalidation_reason text;

alter table public.contest_result_snapshots
  drop constraint contest_result_snapshots_contest_id_category_id_key;

create unique index contest_result_snapshots_active_contest_category_uidx
  on public.contest_result_snapshots (contest_id, category_id)
  where invalidated_at is null;

create or replace function public.delete_contest_vote(
  p_vote_id uuid,
  p_deletion_reason text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_vote public.contest_votes%rowtype;
  v_email_hash text;
  v_contest_id uuid;
  v_snapshot_status public.contest_result_status;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if nullif(btrim(p_deletion_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'deletion_reason_required';
  end if;

  select * into v_vote from public.contest_votes where id = p_vote_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'vote_not_found';
  end if;

  select cp.contest_id into v_contest_id
    from public.submissions s
    join public.contest_participations cp on cp.id = s.participation_id
   where s.id = v_vote.submission_id
     and s.category_id = v_vote.category_id;
  if v_contest_id is not null then
    select crs.status into v_snapshot_status
      from public.contest_result_snapshots crs
     where crs.contest_id = v_contest_id
       and crs.category_id = v_vote.category_id
       and crs.invalidated_at is null
     order by crs.frozen_at desc, crs.id desc
     limit 1
     for update;
    if v_snapshot_status in ('CONFIRMED', 'PUBLISHED') then
      raise exception using errcode = 'P0001', message = 'result_already_finalized';
    end if;
    if v_snapshot_status is not null then
      update public.contest_result_snapshots
         set invalidated_at = now(), invalidation_reason = 'vote_deleted'
       where contest_id = v_contest_id
         and category_id = v_vote.category_id
         and invalidated_at is null;
    end if;
  end if;

  select vvi.email_hash into v_email_hash
    from public.verified_voter_identities vvi
   where vvi.id = v_vote.voter_identity_id;

  insert into public.vote_deletion_audits (
    vote_id, voter_identity_id, submission_id, category_id,
    voter_email_hash, deletion_reason, deleted_by_auth_user_id
  ) values (
    v_vote.id, v_vote.voter_identity_id, v_vote.submission_id, v_vote.category_id,
    v_email_hash, btrim(p_deletion_reason), v_auth_user_id
  );

  delete from public.contest_votes where id = p_vote_id;
end;
$function$;

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
  if not exists (select 1 from public.contests where id = p_contest_id and status = 'VOTING_CLOSED') then
    raise exception using errcode = 'P0001', message = 'contest_not_closed';
  end if;

  for v_category in
    select id, finalists_count from public.contest_categories where contest_id = p_contest_id order by id
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
        join public.contest_categories cc on cc.id = s.category_id and cc.id = v_category.id
        join public.submission_publications sp on sp.submission_id = s.id and sp.revoked_at is null
        join public.submission_media sm on sm.id = sp.media_id and sm.status = 'FINALIZED' and sm.is_current
        left join public.contest_votes cv on cv.submission_id = s.id and cv.category_id = v_category.id
       where s.status = 'APPROVED'
       group by s.id
    ), ranked as (
      select c.*, dense_rank() over (order by c.vote_count desc) as rank_position
        from candidates c
    ), boundary as (
      select vote_count from ranked order by vote_count desc, submission_id offset greatest(v_category.finalists_count - 1, 0) limit 1
    )
    insert into public.contest_result_entries (snapshot_id, submission_id, rank_position, vote_count, is_cutoff_tie)
    select v_snapshot_id, r.submission_id, r.rank_position, r.vote_count,
           (r.vote_count = (select vote_count from boundary)
            and (select count(*) from ranked x where x.vote_count = r.vote_count) > v_category.finalists_count)
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
  if v_auth_user_id is null or not exists (select 1 from public.admin_users au where au.user_id = v_auth_user_id) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select * into v_snapshot from public.contest_result_snapshots where id = p_snapshot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'snapshot_not_found'; end if;
  if v_snapshot.invalidated_at is not null then raise exception using errcode = 'P0001', message = 'snapshot_invalidated'; end if;
  if v_snapshot.status <> 'TIE_REQUIRES_DECISION' then raise exception using errcode = 'P0001', message = 'tie_not_required'; end if;
  select min(e.rank_position), count(*), array_agg(e.submission_id order by e.submission_id) into v_cutoff_rank, v_tie_count, v_tie_ids
    from public.contest_result_entries e where e.snapshot_id = p_snapshot_id and e.is_cutoff_tie;
  if v_cutoff_rank is null or v_tie_count = 0 then raise exception using errcode = 'P0001', message = 'tie_not_found'; end if;
  select count(*) into v_safe_count from public.contest_result_entries e where e.snapshot_id = p_snapshot_id and e.rank_position < v_cutoff_rank;
  v_required_count := v_snapshot.finalists_count - v_safe_count;
  if v_required_count <= 0 or v_required_count >= v_tie_count then raise exception using errcode = 'P0001', message = 'tie_not_actionable'; end if;
  if p_selected_submission_ids is null or cardinality(p_selected_submission_ids) <> v_required_count then raise exception using errcode = 'P0001', message = 'invalid_tie_selection_count'; end if;
  select count(distinct selected_id), count(*) into v_distinct_count, v_safe_count from unnest(p_selected_submission_ids) as selected_id;
  if v_distinct_count <> v_safe_count then raise exception using errcode = 'P0001', message = 'duplicate_tie_selection'; end if;
  if exists (select 1 from unnest(p_selected_submission_ids) selected_id where not (selected_id = any(v_tie_ids))) then raise exception using errcode = 'P0001', message = 'submission_not_in_tie'; end if;
  insert into public.contest_tie_resolutions (snapshot_id, contest_id, category_id, tie_submission_ids, selected_submission_ids, decision_note, decided_by_auth_user_id)
  values (v_snapshot.id, v_snapshot.contest_id, v_snapshot.category_id, v_tie_ids, p_selected_submission_ids, nullif(btrim(p_decision_note), ''), v_auth_user_id)
  returning id into v_resolution_id;
  return v_resolution_id;
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
  v_inserted integer;
begin
  if v_auth_user_id is null or not exists (select 1 from public.admin_users au where au.user_id = v_auth_user_id) then raise exception using errcode = 'P0001', message = 'admin_required'; end if;
  select * into v_snapshot from public.contest_result_snapshots where id = p_snapshot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'snapshot_not_found'; end if;
  if v_snapshot.invalidated_at is not null then raise exception using errcode = 'P0001', message = 'snapshot_invalidated'; end if;
  if v_snapshot.status = 'TIE_REQUIRES_DECISION' then
    select * into v_resolution from public.contest_tie_resolutions where snapshot_id = p_snapshot_id order by decided_at desc, id desc limit 1;
    if not found then raise exception using errcode = 'P0001', message = 'tie_requires_decision'; end if;
    select min(e.rank_position) into v_cutoff_rank from public.contest_result_entries e where e.snapshot_id = p_snapshot_id and e.is_cutoff_tie;
    insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, e.submission_id from public.contest_result_entries e where e.snapshot_id = p_snapshot_id and e.rank_position < v_cutoff_rank
    union all select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, selected_id from unnest(v_resolution.selected_submission_ids) selected_id;
  elsif v_snapshot.status = 'FROZEN' then
    insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
    select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, e.submission_id from public.contest_result_entries e where e.snapshot_id = p_snapshot_id and e.rank_position <= v_snapshot.finalists_count;
  else raise exception using errcode = 'P0001', message = 'snapshot_not_confirmable'; end if;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_snapshot.finalists_count then raise exception using errcode = 'P0001', message = 'invalid_finalist_count'; end if;
  update public.contest_result_snapshots set status = 'CONFIRMED', confirmed_at = now(), confirmed_by_auth_user_id = v_auth_user_id where id = p_snapshot_id;
  return v_inserted;
end;
$function$;

revoke execute on function public.delete_contest_vote(uuid, text) from public, anon, service_role;
grant execute on function public.delete_contest_vote(uuid, text) to authenticated;
revoke execute on function public.freeze_contest_results(uuid) from public, anon, service_role;
grant execute on function public.freeze_contest_results(uuid) to authenticated;
revoke execute on function public.resolve_contest_result_tie(uuid, uuid[], text) from public, anon, service_role;
grant execute on function public.resolve_contest_result_tie(uuid, uuid[], text) to authenticated;
revoke execute on function public.confirm_contest_finalists(uuid) from public, anon, service_role;
grant execute on function public.confirm_contest_finalists(uuid) to authenticated;
