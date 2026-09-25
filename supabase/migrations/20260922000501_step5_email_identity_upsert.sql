-- Correct the partial-index conflict target used by the public vote RPC.
create or replace function public.cast_contest_vote(
  p_submission_id uuid,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_email_hash text;
  v_voter_identity_id uuid;
  v_contest_id uuid;
  v_vote_id uuid;
begin
  if v_auth_user_id is null then
    raise exception using errcode = 'P0001', message = 'email_verification_required';
  end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_auth_user_id and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception using errcode = 'P0001', message = 'email_not_verified';
  end if;

  select cc.contest_id into v_contest_id
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
   where s.id = p_submission_id and s.category_id = p_category_id;
  if v_contest_id is null then
    raise exception using errcode = 'P0001', message = 'submission_category_mismatch';
  end if;
  if not exists (select 1 from public.contests c where c.id = v_contest_id and c.status = 'VOTING_OPEN') then
    raise exception using errcode = 'P0001', message = 'voting_not_open';
  end if;
  if not exists (
    select 1 from public.submission_publications sp
    join public.submission_media sm on sm.id = sp.media_id
    where sp.submission_id = p_submission_id and sp.revoked_at is null
      and sm.status = 'FINALIZED' and sm.is_current
  ) then
    raise exception using errcode = 'P0001', message = 'submission_not_public';
  end if;

  v_email_hash := encode(extensions.digest(v_email, 'sha256'::text), 'hex');
  insert into public.verified_voter_identities (
    verification_method, auth_user_id, email_hash, email_verified_at
  ) values ('EMAIL_OTP', v_auth_user_id, v_email_hash, now())
  on conflict (email_hash) where email_hash is not null do update
    set auth_user_id = excluded.auth_user_id,
        email_verified_at = excluded.email_verified_at,
        status = 'VERIFIED', updated_at = now()
  returning id into v_voter_identity_id;

  begin
    insert into public.contest_votes (voter_identity_id, submission_id, category_id)
    values (v_voter_identity_id, p_submission_id, p_category_id)
    returning id into v_vote_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'vote_already_cast';
  end;
  return v_vote_id;
end;
$function$;
