-- Step 5 — Minimal per-category voter state for the authenticated voter.
-- This surface reveals only category identifiers already voted by auth.uid().

create or replace function public.get_my_voted_categories(p_contest_id uuid)
returns table(category_id uuid)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'authentication_required';
  end if;

  return query
  select distinct cv.category_id
    from public.contest_votes cv
    join public.verified_voter_identities vvi
      on vvi.id = cv.voter_identity_id
    join public.contest_categories cc
      on cc.id = cv.category_id
   where vvi.auth_user_id = v_auth_user_id
     and vvi.status = 'VERIFIED'
     and cc.contest_id = p_contest_id
   order by cv.category_id;
end;
$function$;

revoke all on function public.get_my_voted_categories(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_voted_categories(uuid)
  to authenticated;
