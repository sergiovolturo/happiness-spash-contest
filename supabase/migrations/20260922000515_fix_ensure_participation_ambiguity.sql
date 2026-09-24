-- Remove PL/pgSQL output-column ambiguity from participation resolution.
-- The public signature and the idempotent identity/participation semantics
-- remain unchanged.

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
      from public.contests as c
     where c.id = p_contest_id
  ) then
    raise exception using errcode = 'P0001', message = 'contest_not_found';
  end if;

  insert into public.platform_identities as pi (auth_user_id)
  values (v_auth_user_id)
  on conflict on constraint platform_identities_auth_user_id_key do update
    set updated_at = now()
  returning pi.id into v_identity_id;

  insert into public.contest_participations as cp (contest_id, identity_id)
  values (p_contest_id, v_identity_id)
  on conflict on constraint contest_participations_contest_id_identity_id_key do update
    set updated_at = now()
  returning cp.id into v_participation_id;

  return query
  select v_identity_id, v_participation_id, p_contest_id;
end;
$function$;

revoke execute on function public.ensure_contest_participation(uuid)
  from public, anon, service_role;
grant execute on function public.ensure_contest_participation(uuid)
  to authenticated;
