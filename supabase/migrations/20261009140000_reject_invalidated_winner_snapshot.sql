-- Prevent winner selection from invalidated published result snapshots.
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
     and crs.invalidated_at is null
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

