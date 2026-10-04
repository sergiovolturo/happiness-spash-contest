-- Storage evaluates DELETE policies through the internal Storage role. Pass
-- the authenticated caller explicitly into the Admin/path check so thumbnail
-- deletes do not get silently filtered while the video policy still succeeds.

create or replace function public._admin_submission_storage_delete_allowed_for_user(
  p_bucket text,
  p_path text,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_submission_id uuid;
  v_status public.contest_status;
  v_archived_at timestamptz;
  v_deletion_locked_at timestamptz;
begin
  if p_auth_user_id is null
     or not exists (select 1 from public.admin_users au where au.user_id=p_auth_user_id) then
    return false;
  end if;

  select sm.submission_id
    into v_submission_id
    from public.submission_media sm
   where (
     (p_bucket=sm.storage_bucket and p_path=sm.storage_path)
     or (
       p_bucket='contest-thumbnails'
       and p_path in (
         'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.webp',
         'submission-thumbnails/'||sm.submission_id::text||'/'||sm.id::text||'.jpg'
       )
     )
   )
   limit 1;
  if not found then return false; end if;

  select c.status,c.archived_at,c.deletion_locked_at
    into v_status,v_archived_at,v_deletion_locked_at
    from public.submissions s
    join public.contest_categories cc on cc.id=s.category_id
    join public.contests c on c.id=cc.contest_id
   where s.id=v_submission_id;
  if not found then return false; end if;

  if v_archived_at is not null
     or v_deletion_locked_at is not null
     or v_status in ('VOTING_OPEN','VOTING_CLOSED','CLOSED') then
    return false;
  end if;

  if exists (select 1 from public.submission_publications where submission_id=v_submission_id)
     or exists (select 1 from public.contest_votes where submission_id=v_submission_id)
     or exists (select 1 from public.vote_deletion_audits where submission_id=v_submission_id)
     or exists (select 1 from public.contest_result_entries where submission_id=v_submission_id)
     or exists (select 1 from public.contest_finalists where submission_id=v_submission_id)
     or exists (select 1 from public.submission_moderation_events where submission_id=v_submission_id) then
    return false;
  end if;

  return true;
end;
$function$;

drop policy if exists admin_submission_objects_delete on storage.objects;
create policy admin_submission_objects_delete
  on storage.objects for delete to authenticated
  using (
    public._admin_submission_storage_delete_allowed_for_user(bucket_id,name,auth.uid())
  );

revoke all on function public._admin_submission_storage_delete_allowed_for_user(text,text,uuid)
  from public,anon,service_role;
grant execute on function public._admin_submission_storage_delete_allowed_for_user(text,text,uuid)
  to authenticated;
grant execute on function public._admin_submission_storage_delete_allowed_for_user(text,text,uuid)
  to supabase_storage_admin;
