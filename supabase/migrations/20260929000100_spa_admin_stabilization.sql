-- Incremental Admin/SPA stabilization.
-- Keeps contest, submission and voting semantics unchanged.
-- Apply only after the frontend branch has been reviewed.

drop function if exists public.admin_list_contests();

create or replace function public.admin_list_contests()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  status public.contest_status,
  configuration_version integer,
  configuration jsonb,
  submissions_open_at timestamptz,
  submissions_close_at timestamptz,
  voting_open_at timestamptz,
  voting_close_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
     or not exists (
       select 1
       from public.admin_users au
       where au.user_id = auth.uid()
     ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;

  return query
    select
      c.id,
      c.slug,
      c.name,
      c.description,
      c.status,
      c.configuration_version,
      c.configuration,
      c.submissions_open_at,
      c.submissions_close_at,
      c.voting_open_at,
      c.voting_close_at,
      c.created_by,
      c.created_at,
      c.updated_at
    from public.contests c
    order by c.created_at desc, c.id desc;
end;
$function$;

revoke all on function public.admin_list_contests() from public;
grant execute on function public.admin_list_contests() to authenticated;
