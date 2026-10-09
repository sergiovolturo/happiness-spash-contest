-- Winner-only archives permanently remove non-winner media. Keep legacy restore
-- available only for archived contests without a completed archive request.
create or replace function public.admin_restore_contest(p_contest_id uuid)
returns public.contests
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_result public.contests;
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception using errcode='P0001', message='admin_required';
  end if;

  select * into v_result
    from public.contests
   where id = p_contest_id
   for update;

  if not found then
    raise exception using errcode='P0001', message='contest_not_archived';
  end if;

  if exists (
    select 1
      from public.contest_archive_requests r
     where r.contest_id = p_contest_id
       and r.status = 'COMPLETED'
  ) then
    raise exception using errcode='P0001', message='archive_restore_not_allowed';
  end if;

  update public.contests
     set archived_at = null,
         updated_at = now()
   where id = p_contest_id
     and archived_at is not null
     and deletion_locked_at is null
   returning * into v_result;

  if not found then
    raise exception using errcode='P0001', message='contest_not_archived';
  end if;

  return v_result;
end;
$function$;

revoke execute on function public.admin_restore_contest(uuid) from public, anon, service_role;
grant execute on function public.admin_restore_contest(uuid) to authenticated;
