-- The public home represents the current active Contest, not result history.
-- Historical closed Contest rows remain intact and can be surfaced separately later.
create or replace function public.get_public_contest()
returns table (
  id uuid,
  slug text,
  name text,
  status public.contest_status,
  submissions_open_at timestamptz,
  submissions_close_at timestamptz,
  voting_open_at timestamptz,
  voting_close_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id,c.slug,c.name,c.status,
    c.submissions_open_at,c.submissions_close_at,c.voting_open_at,c.voting_close_at
  from public.contests c
  where c.status in (
    'SUBMISSIONS_OPEN'::public.contest_status,
    'SUBMISSIONS_CLOSED'::public.contest_status,
    'MODERATION'::public.contest_status,
    'READY_FOR_VOTING'::public.contest_status,
    'VOTING_OPEN'::public.contest_status
  )
  order by
    case c.status
      when 'VOTING_OPEN'::public.contest_status then 1
      when 'READY_FOR_VOTING'::public.contest_status then 2
      when 'MODERATION'::public.contest_status then 3
      when 'SUBMISSIONS_OPEN'::public.contest_status then 4
      when 'SUBMISSIONS_CLOSED'::public.contest_status then 5
      else 6
    end,
    c.updated_at desc,
    c.created_at desc
  limit 1;
$function$;

revoke execute on function public.get_public_contest() from public, anon, service_role;
grant execute on function public.get_public_contest() to anon, authenticated;
