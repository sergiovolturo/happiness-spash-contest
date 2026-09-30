-- Expose aggregate results only after the configured voting window closes.
-- The existing freeze/finalist infrastructure remains authoritative when a
-- published snapshot exists; the fallback below keeps the public surface
-- available between close and the Admin freeze action.
create or replace function public.get_public_contest_results(p_contest_id uuid)
returns table(submission_id uuid,category_id uuid,category_name text,contestant_display_name text,vote_count bigint,rank_position integer,is_finalist boolean)
language plpgsql security definer set search_path=''
as $function$
declare
  v_contest public.contests%rowtype;
begin
  select * into v_contest from public.contests where id=p_contest_id and archived_at is null;
  if not found then return; end if;
  if v_contest.voting_close_at is null or now() < v_contest.voting_close_at then return; end if;

  if exists(select 1 from public.contest_result_snapshots where contest_id=p_contest_id and status='PUBLISHED' and invalidated_at is null) then
    return query
    with latest as (
      select distinct on (rs.category_id) rs.id,rs.category_id
      from public.contest_result_snapshots rs
      where rs.contest_id=p_contest_id and rs.status='PUBLISHED' and rs.invalidated_at is null
      order by rs.category_id,rs.published_at desc nulls last,rs.id desc
    )
    select e.submission_id,s.category_id,d.name,s.contestant_display_name,e.vote_count,e.rank_position,
      exists(select 1 from public.contest_finalists f where f.snapshot_id=e.snapshot_id and f.submission_id=e.submission_id)
    from latest l join public.contest_result_entries e on e.snapshot_id=l.id
    join public.submissions s on s.id=e.submission_id
    join public.contest_categories cc on cc.id=s.category_id
    join public.contest_category_definitions d on d.id=cc.category_definition_id
    order by s.category_id,e.rank_position,e.submission_id;
    return;
  end if;

  return query
  with candidates as (
    select s.id as submission_id,s.category_id,d.name as category_name,s.contestant_display_name,
      count(cv.id)::bigint as vote_count
    from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id and cc.contest_id=p_contest_id and cc.is_active
    join public.contest_category_definitions d on d.id=cc.category_definition_id
    join public.submission_publications sp on sp.submission_id=s.id and sp.revoked_at is null
    join public.submission_media sm on sm.id=sp.media_id and sm.status='FINALIZED' and sm.is_current
    left join public.contest_votes cv on cv.submission_id=s.id and cv.category_id=s.category_id
    where s.status='APPROVED'
    group by s.id,s.category_id,d.name,s.contestant_display_name
  ), ranked as (
    select c.*,dense_rank() over(partition by c.category_id order by c.vote_count desc)::integer as rank_position
    from candidates c
  )
  select r.submission_id,r.category_id,r.category_name,r.contestant_display_name,r.vote_count,r.rank_position,
    r.rank_position<=4
  from ranked r
  order by r.category_id,r.rank_position,r.submission_id;
end;
$function$;

revoke execute on function public.get_public_contest_results(uuid) from public,service_role;
grant execute on function public.get_public_contest_results(uuid) to anon,authenticated;
