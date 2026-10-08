-- Tranche 2 — explicit Admin conclusion after winner selection.
-- This does not change voting, freeze, tie resolution, finalist publication,
-- or archive/media retention behavior.

create or replace function public.admin_conclude_contest(
  p_contest_id uuid
)
returns public.contests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_contest public.contests%rowtype;
  v_result public.contests%rowtype;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au
     where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

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
  if v_contest.status not in ('VOTING_CLOSED', 'CLOSED') then
    raise exception using errcode = 'P0001', message = 'contest_not_ready_to_conclude';
  end if;

  if exists (
    select 1
      from public.contest_categories cc
     where cc.contest_id = p_contest_id
       and cc.is_active
       and cc.winner_required
       and not exists (
         select 1
           from public.contest_winners cw
          where cw.contest_id = p_contest_id
            and cw.category_id = cc.id
       )
  ) then
    raise exception using errcode = 'P0001', message = 'winner_required_missing';
  end if;

  if exists (
    select 1
      from public.contest_winners cw
     where cw.contest_id = p_contest_id
       and not exists (
         select 1
           from public.contest_finalists cf
           join public.contest_result_snapshots crs on crs.id = cf.snapshot_id
           join public.submissions s on s.id = cf.submission_id
          where cf.id = cw.finalist_id
            and cf.contest_id = cw.contest_id
            and cf.category_id = cw.category_id
            and cf.submission_id = cw.submission_id
            and cf.published_at is not null
            and cf.published_by_auth_user_id is not null
            and crs.contest_id = p_contest_id
            and crs.category_id = cw.category_id
            and crs.status = 'PUBLISHED'
            and crs.invalidated_at is null
            and s.category_id = cw.category_id
       )
  ) then
    raise exception using errcode = 'P0001', message = 'winner_not_valid_published_finalist';
  end if;

  if v_contest.status = 'CLOSED' then
    return v_contest;
  end if;

  update public.contests
     set status = 'CLOSED', updated_at = now()
   where id = p_contest_id
   returning * into v_result;
  return v_result;
end;
$function$;

revoke all on function public.admin_conclude_contest(uuid)
  from public, anon, service_role;
grant execute on function public.admin_conclude_contest(uuid)
  to authenticated;
