-- Allow Storage's internal policy executor to evaluate the narrowly scoped
-- Admin/path check. The helper still verifies auth.uid() and admin_users.
grant execute on function public._admin_submission_storage_delete_allowed(text,text)
  to supabase_storage_admin;

create or replace function public.admin_get_submission_delete_status(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_status public.contest_status;
  v_archived_at timestamptz;
  v_deletion_locked_at timestamptz;
begin
  if auth.uid() is null
     or not exists (select 1 from public.admin_users au where au.user_id=auth.uid()) then
    raise exception using errcode='P0001',message='admin_required';
  end if;

  select c.status,c.archived_at,c.deletion_locked_at
    into v_status,v_archived_at,v_deletion_locked_at
    from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id
    join public.contests c on c.id=cc.contest_id
   where s.id=p_submission_id;
  if not found then
    return jsonb_build_object('deletable',false,'reason','submission_not_found');
  end if;

  if v_archived_at is not null or v_deletion_locked_at is not null
     or v_status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then
    return jsonb_build_object('deletable',false,'reason','lifecycle_locked','message','Questa candidatura non può essere eliminata perché il Contest è in una fase protetta.');
  end if;
  if exists (select 1 from public.submission_publications where submission_id=p_submission_id) then
    return jsonb_build_object('deletable',false,'reason','publication_exists','message','Questa candidatura non può essere eliminata perché è già stata pubblicata.');
  end if;
  if exists (select 1 from public.contest_votes where submission_id=p_submission_id)
     or exists (select 1 from public.vote_deletion_audits where submission_id=p_submission_id) then
    return jsonb_build_object('deletable',false,'reason','votes_exist','message','Questa candidatura non può essere eliminata perché ha voti o storico voti.');
  end if;
  if exists (select 1 from public.contest_result_entries where submission_id=p_submission_id) then
    return jsonb_build_object('deletable',false,'reason','results_exist','message','Questa candidatura non può essere eliminata perché è presente nei risultati.');
  end if;
  if exists (select 1 from public.contest_finalists where submission_id=p_submission_id) then
    return jsonb_build_object('deletable',false,'reason','finalist_exists','message','Questa candidatura non può essere eliminata perché è finalista.');
  end if;
  if exists (select 1 from public.submission_moderation_events where submission_id=p_submission_id) then
    return jsonb_build_object('deletable',false,'reason','moderation_history_exists','message','Questa candidatura conserva uno storico di moderazione e non può essere eliminata.');
  end if;

  return jsonb_build_object('deletable',true,'reason',null);
end;
$function$;

revoke all on function public.admin_get_submission_delete_status(uuid) from public,anon,service_role;
grant execute on function public.admin_get_submission_delete_status(uuid) to authenticated;
