-- Keep non-archived post-voting contests public while withholding provisional results.
create or replace function public.get_public_contests()
returns table (
  id uuid, slug text, name text, description text,
  status public.contest_status,
  submissions_open_at timestamptz, submissions_close_at timestamptz,
  voting_open_at timestamptz, voting_close_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path=''
as $function$
  select c.id,c.slug,c.name,c.description,c.status,
    c.submissions_open_at,c.submissions_close_at,
    c.voting_open_at,c.voting_close_at,c.created_at,c.updated_at
  from public.contests c
  where c.archived_at is null
    and c.deletion_locked_at is null
    and c.status in (
      'SUBMISSIONS_OPEN','VOTING_OPEN','SUBMISSIONS_CLOSED','MODERATION',
      'READY_FOR_VOTING','VOTING_CLOSED','FROZEN','CONFIRMED','PUBLISHED','CLOSED'
    )
  order by case c.status
    when 'SUBMISSIONS_OPEN' then 1
    when 'VOTING_OPEN' then 2
    when 'VOTING_CLOSED' then 3
    when 'FROZEN' then 4
    when 'CONFIRMED' then 5
    when 'PUBLISHED' then 6
    when 'CLOSED' then 7
    when 'SUBMISSIONS_CLOSED' then 8
    when 'MODERATION' then 9
    when 'READY_FOR_VOTING' then 10
    else 11 end,
    c.updated_at desc nulls last,c.created_at desc,c.id desc;
$function$;

create or replace function public.get_public_contest()
returns table (id uuid,slug text,name text,status public.contest_status,
  submissions_open_at timestamptz,submissions_close_at timestamptz,
  voting_open_at timestamptz,voting_close_at timestamptz)
language sql stable security definer set search_path=''
as $function$
  select c.id,c.slug,c.name,c.status,c.submissions_open_at,c.submissions_close_at,
    c.voting_open_at,c.voting_close_at
  from public.contests c
  where c.archived_at is null and c.deletion_locked_at is null
    and c.status in (
      'SUBMISSIONS_OPEN','VOTING_OPEN','SUBMISSIONS_CLOSED','MODERATION',
      'READY_FOR_VOTING','VOTING_CLOSED','FROZEN','CONFIRMED','PUBLISHED','CLOSED'
    )
  order by case c.status
    when 'SUBMISSIONS_OPEN' then 1 when 'VOTING_OPEN' then 2
    when 'VOTING_CLOSED' then 3 when 'FROZEN' then 4
    when 'CONFIRMED' then 5 when 'PUBLISHED' then 6
    when 'CLOSED' then 7 when 'SUBMISSIONS_CLOSED' then 8
    when 'MODERATION' then 9 when 'READY_FOR_VOTING' then 10 else 11 end,
    c.updated_at desc nulls last,c.created_at desc,c.id desc
  limit 1;
$function$;

-- Public results are available only from an official, current published snapshot.
create or replace function public.get_public_contest_results(p_contest_id uuid)
returns table(submission_id uuid,category_id uuid,category_name text,
  contestant_display_name text,vote_count bigint,rank_position integer,is_finalist boolean)
language plpgsql security definer set search_path=''
as $function$
declare v_contest public.contests%rowtype;
begin
  select * into v_contest from public.contests
   where id=p_contest_id and archived_at is null;
  if not found then return; end if;
  if exists(
    select 1 from public.contest_categories cc
    where cc.contest_id=p_contest_id
      and not exists(
        select 1 from public._current_contest_result_snapshots(p_contest_id) rs
        where rs.category_id=cc.id and rs.status='PUBLISHED' and rs.invalidated_at is null
      )
  ) then return; end if;
  return query
  with latest as (
    select rs.snapshot_id as id,rs.category_id
    from public._current_contest_result_snapshots(p_contest_id) rs
    where rs.status='PUBLISHED' and rs.invalidated_at is null
  )
  select e.submission_id,s.category_id,d.name,s.contestant_display_name,
    e.vote_count,e.rank_position,
    exists(select 1 from public.contest_finalists f
      where f.snapshot_id=e.snapshot_id and f.submission_id=e.submission_id)
  from latest l
  join public.contest_result_entries e on e.snapshot_id=l.id
  join public.submissions s on s.id=e.submission_id
  join public.contest_categories cc on cc.id=s.category_id
  join public.contest_category_definitions d on d.id=cc.category_definition_id
  order by s.category_id,e.rank_position,e.submission_id;
end;
$function$;

-- Admin-only read-only ranking preview; it never creates a snapshot or finalists.
create or replace function public.admin_preview_contest_results(p_contest_id uuid)
returns table(
  category_id uuid, category_name text, finalists_count integer,
  submission_id uuid, contestant_display_name text, vote_count bigint,
  rank_position integer, is_finalist_candidate boolean, is_cutoff_tie boolean
)
language plpgsql stable security definer set search_path=''
as $function$
declare v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null or not exists(
    select 1 from public.admin_users au where au.user_id=v_auth_user_id
  ) then
    raise exception using errcode='P0001',message='admin_required';
  end if;
  if not exists(select 1 from public.contests c where c.id=p_contest_id) then
    raise exception using errcode='P0001',message='contest_not_found';
  end if;
  return query
  with candidates as (
    select cc.id as category_id,d.name as category_name,cc.finalists_count,
      s.id as submission_id,s.contestant_display_name,count(cv.id)::bigint as vote_count
    from public.contest_categories cc
    join public.contest_category_definitions d on d.id=cc.category_definition_id
    join public.submissions s on s.category_id=cc.id and s.status='APPROVED'
    join public.submission_publications sp on sp.submission_id=s.id and sp.revoked_at is null
    join public.submission_media sm on sm.id=sp.media_id and sm.status='FINALIZED' and sm.is_current
    left join public.contest_votes cv on cv.submission_id=s.id and cv.category_id=cc.id
    where cc.contest_id=p_contest_id and cc.is_active
    group by cc.id,d.name,cc.finalists_count,s.id,s.contestant_display_name
  ), ranked as (
    select c.*,dense_rank() over(partition by c.category_id order by c.vote_count desc)::integer as rank_position
    from candidates c
  )
  select r.category_id,r.category_name,r.finalists_count,r.submission_id,
    r.contestant_display_name,r.vote_count,r.rank_position,
    r.rank_position<=r.finalists_count,
    r.vote_count=(select b.vote_count from ranked b
      where b.category_id=r.category_id
      order by b.vote_count desc,b.submission_id
      offset greatest(r.finalists_count-1,0) limit 1)
      and (select count(*) from ranked tie
        where tie.category_id=r.category_id and tie.vote_count=r.vote_count)>r.finalists_count
  from ranked r
  order by r.category_id,r.rank_position,r.submission_id;
end;
$function$;

revoke all on function public.get_public_contests() from public,service_role;
grant execute on function public.get_public_contests() to anon,authenticated;
revoke all on function public.get_public_contest() from public,service_role;
grant execute on function public.get_public_contest() to anon,authenticated;
revoke all on function public.get_public_contest_results(uuid) from public,service_role;
grant execute on function public.get_public_contest_results(uuid) to anon,authenticated;
revoke execute on function public.admin_preview_contest_results(uuid) from public,anon,service_role;
grant execute on function public.admin_preview_contest_results(uuid) to authenticated;
