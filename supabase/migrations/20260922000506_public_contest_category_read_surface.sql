-- Public Contest/category read model for the frontend.
-- Only non-DRAFT lifecycle rows and active categories are exposed. The
-- underlying administrative tables remain protected by their existing RLS.

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
  select
    c.id,
    c.slug,
    c.name,
    c.status,
    c.submissions_open_at,
    c.submissions_close_at,
    c.voting_open_at,
    c.voting_close_at
  from public.contests c
  where c.status in (
    'SUBMISSIONS_OPEN'::public.contest_status,
    'SUBMISSIONS_CLOSED'::public.contest_status,
    'MODERATION'::public.contest_status,
    'READY_FOR_VOTING'::public.contest_status,
    'VOTING_OPEN'::public.contest_status,
    'VOTING_CLOSED'::public.contest_status,
    'CLOSED'::public.contest_status
  )
  order by c.updated_at desc, c.created_at desc
  limit 1;
$function$;

create or replace function public.get_public_contest_categories(p_contest_id uuid)
returns table (
  id uuid,
  contest_id uuid,
  name text,
  slug text,
  display_order integer,
  submission_cap integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    cc.id,
    cc.contest_id,
    cc.name,
    cc.slug,
    cc.display_order,
    cc.submission_cap
  from public.contest_categories cc
  join public.contests c on c.id = cc.contest_id
  where cc.contest_id = p_contest_id
    and cc.is_active
    and c.status in (
      'SUBMISSIONS_OPEN'::public.contest_status,
      'SUBMISSIONS_CLOSED'::public.contest_status,
      'MODERATION'::public.contest_status,
      'READY_FOR_VOTING'::public.contest_status,
      'VOTING_OPEN'::public.contest_status,
      'VOTING_CLOSED'::public.contest_status,
      'CLOSED'::public.contest_status
    )
  order by cc.display_order, cc.created_at;
$function$;

-- Keep the administrative tables out of the anonymous Data API surface. The
-- existing authenticated/Admin RLS and privileges are intentionally retained.
revoke all on table public.contests, public.contest_categories from public, anon;

revoke execute on function public.get_public_contest() from public, anon, service_role;
grant execute on function public.get_public_contest() to anon, authenticated;

revoke execute on function public.get_public_contest_categories(uuid) from public, anon, service_role;
grant execute on function public.get_public_contest_categories(uuid) to anon, authenticated;
