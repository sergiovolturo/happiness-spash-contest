-- Participant identity/participation resolution primitive.
-- The existing Step 1 unique constraints are the concurrency guarantees:
-- platform_identities(auth_user_id) and
-- contest_participations(contest_id, identity_id).

create or replace function public.ensure_contest_participation(p_contest_id uuid)
returns table (
  platform_identity_id uuid,
  contest_participation_id uuid,
  contest_id uuid
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_identity_id uuid;
  v_participation_id uuid;
begin
  if v_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;

  if not exists (
    select 1
      from public.contests c
     where c.id = p_contest_id
  ) then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;

  insert into public.platform_identities (auth_user_id)
  values (v_auth_user_id)
  on conflict (auth_user_id) do update
    set updated_at = now()
  returning id into v_identity_id;

  insert into public.contest_participations (contest_id, identity_id)
  values (p_contest_id, v_identity_id)
  on conflict (contest_id, identity_id) do update
    set updated_at = now()
  returning id into v_participation_id;

  return query
  select v_identity_id, v_participation_id, p_contest_id;
end;
$function$;

revoke execute on function public.ensure_contest_participation(uuid)
  from public, anon, service_role;
grant execute on function public.ensure_contest_participation(uuid)
  to authenticated;
