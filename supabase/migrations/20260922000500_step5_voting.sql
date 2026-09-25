-- Step 5 — Public email-verified voting, result freeze and finalist publication.
-- Legacy public.votes remains untouched. Public clients use authenticated
-- Supabase OTP sessions, while the domain is keyed by a provider-neutral voter
-- identity rather than auth.users.id.

create type public.voter_verification_method as enum (
  'EMAIL_OTP',
  'HAPPINESS_PLATFORM_AUTH'
);

create type public.voter_identity_status as enum (
  'VERIFIED',
  'REVOKED'
);

create type public.contest_result_status as enum (
  'FROZEN',
  'TIE_REQUIRES_DECISION',
  'CONFIRMED',
  'PUBLISHED'
);

create table public.verified_voter_identities (
  id uuid primary key default gen_random_uuid(),
  verification_method public.voter_verification_method not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  email_hash text,
  email_verified_at timestamptz,
  status public.voter_identity_status not null default 'VERIFIED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    verification_method <> 'EMAIL_OTP'
    or (email_hash is not null and email_verified_at is not null)
  ),
  check (verification_method <> 'HAPPINESS_PLATFORM_AUTH' or auth_user_id is not null)
);

create unique index verified_voter_identities_email_hash_uidx
  on public.verified_voter_identities (email_hash)
  where email_hash is not null;

create unique index verified_voter_identities_auth_user_uidx
  on public.verified_voter_identities (auth_user_id)
  where auth_user_id is not null;

create table public.contest_votes (
  id uuid primary key default gen_random_uuid(),
  voter_identity_id uuid not null
    references public.verified_voter_identities(id) on delete restrict,
  submission_id uuid not null
    references public.submissions(id) on delete restrict,
  category_id uuid not null
    references public.contest_categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (voter_identity_id, category_id)
);

create index contest_votes_submission_idx
  on public.contest_votes (submission_id);

create index contest_votes_category_idx
  on public.contest_votes (category_id, created_at);

create table public.vote_deletion_audits (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null,
  voter_identity_id uuid not null,
  submission_id uuid not null,
  category_id uuid not null,
  voter_email_hash text,
  deletion_reason text not null check (length(btrim(deletion_reason)) > 0),
  deleted_by_auth_user_id uuid references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now()
);

create index vote_deletion_audits_vote_idx
  on public.vote_deletion_audits (vote_id, deleted_at desc);

create table public.contest_result_snapshots (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete restrict,
  category_id uuid not null references public.contest_categories(id) on delete restrict,
  finalists_count integer not null check (finalists_count > 0),
  status public.contest_result_status not null,
  tie_requires_decision boolean not null default false,
  frozen_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by_auth_user_id uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by_auth_user_id uuid references auth.users(id) on delete set null,
  unique (contest_id, category_id),
  check ((status = 'TIE_REQUIRES_DECISION') = tie_requires_decision),
  check (status not in ('CONFIRMED', 'PUBLISHED') or confirmed_at is not null),
  check (status <> 'PUBLISHED' or published_at is not null)
);

create table public.contest_result_entries (
  snapshot_id uuid not null references public.contest_result_snapshots(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  rank_position integer not null check (rank_position > 0),
  vote_count bigint not null check (vote_count >= 0),
  is_cutoff_tie boolean not null default false,
  primary key (snapshot_id, submission_id)
);

create index contest_result_entries_rank_idx
  on public.contest_result_entries (snapshot_id, rank_position);

create table public.contest_finalists (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.contest_result_snapshots(id) on delete restrict,
  contest_id uuid not null references public.contests(id) on delete restrict,
  category_id uuid not null references public.contest_categories(id) on delete restrict,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  published_at timestamptz not null default now(),
  published_by_auth_user_id uuid references auth.users(id) on delete set null,
  unique (snapshot_id, submission_id)
);

alter table public.verified_voter_identities enable row level security;
alter table public.contest_votes enable row level security;
alter table public.vote_deletion_audits enable row level security;
alter table public.contest_result_snapshots enable row level security;
alter table public.contest_result_entries enable row level security;
alter table public.contest_finalists enable row level security;

create policy verified_voter_identities_admin_select
  on public.verified_voter_identities for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy contest_votes_admin_select
  on public.contest_votes for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy vote_deletion_audits_admin_select
  on public.vote_deletion_audits for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy contest_result_snapshots_admin_select
  on public.contest_result_snapshots for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy contest_result_entries_admin_select
  on public.contest_result_entries for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

create policy contest_finalists_admin_select
  on public.contest_finalists for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

revoke all on table public.verified_voter_identities from public, anon, authenticated, service_role;
revoke all on table public.contest_votes from public, anon, authenticated, service_role;
revoke all on table public.vote_deletion_audits from public, anon, authenticated, service_role;
revoke all on table public.contest_result_snapshots from public, anon, authenticated, service_role;
revoke all on table public.contest_result_entries from public, anon, authenticated, service_role;
revoke all on table public.contest_finalists from public, anon, authenticated, service_role;
grant select on table public.verified_voter_identities to authenticated;
grant select on table public.contest_votes to authenticated;
grant select on table public.vote_deletion_audits to authenticated;
grant select on table public.contest_result_snapshots to authenticated;
grant select on table public.contest_result_entries to authenticated;
grant select on table public.contest_finalists to authenticated;

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

  select lower(btrim(u.email))
    into v_email
    from auth.users u
   where u.id = v_auth_user_id
     and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception using errcode = 'P0001', message = 'email_not_verified';
  end if;

  select cc.contest_id
    into v_contest_id
    from public.submissions s
    join public.contest_categories cc on cc.id = s.category_id
   where s.id = p_submission_id
     and s.category_id = p_category_id;

  if v_contest_id is null then
    raise exception using errcode = 'P0001', message = 'submission_category_mismatch';
  end if;

  if not exists (
    select 1 from public.contests c
    where c.id = v_contest_id and c.status = 'VOTING_OPEN'
  ) then
    raise exception using errcode = 'P0001', message = 'voting_not_open';
  end if;

  if not exists (
    select 1
      from public.submission_publications sp
      join public.submission_media sm on sm.id = sp.media_id
     where sp.submission_id = p_submission_id
       and sp.revoked_at is null
       and sm.status = 'FINALIZED'
       and sm.is_current
  ) then
    raise exception using errcode = 'P0001', message = 'submission_not_public';
  end if;

  v_email_hash := encode(extensions.digest(v_email, 'sha256'::text), 'hex');

  insert into public.verified_voter_identities (
    verification_method, auth_user_id, email_hash, email_verified_at
  ) values (
    'EMAIL_OTP', v_auth_user_id, v_email_hash, now()
  )
  on conflict (email_hash) where email_hash is not null do update
    set auth_user_id = excluded.auth_user_id,
        email_verified_at = excluded.email_verified_at,
        status = 'VERIFIED',
        updated_at = now()
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

create or replace function public.delete_contest_vote(
  p_vote_id uuid,
  p_deletion_reason text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_vote public.contest_votes%rowtype;
  v_email_hash text;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if nullif(btrim(p_deletion_reason), '') is null then
    raise exception using errcode = 'P0001', message = 'deletion_reason_required';
  end if;

  select * into v_vote from public.contest_votes where id = p_vote_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'vote_not_found';
  end if;

  select vvi.email_hash into v_email_hash
    from public.verified_voter_identities vvi
   where vvi.id = v_vote.voter_identity_id;

  insert into public.vote_deletion_audits (
    vote_id, voter_identity_id, submission_id, category_id,
    voter_email_hash, deletion_reason, deleted_by_auth_user_id
  ) values (
    v_vote.id, v_vote.voter_identity_id, v_vote.submission_id, v_vote.category_id,
    v_email_hash, btrim(p_deletion_reason), v_auth_user_id
  );

  delete from public.contest_votes where id = p_vote_id;
end;
$function$;

create or replace function public.close_contest_voting(p_contest_id uuid)
returns public.contests
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_result public.contests;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  update public.contests set status = 'VOTING_CLOSED', updated_at = now()
   where id = p_contest_id and status = 'VOTING_OPEN'
   returning * into v_result;
  if not found then
    raise exception using errcode = 'P0001', message = 'contest_not_voting_open';
  end if;
  return v_result;
end;
$function$;

create or replace function public.freeze_contest_results(p_contest_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_category record;
  v_snapshot_id uuid;
  v_tie boolean;
  v_count integer := 0;
begin
  if v_auth_user_id is null or not exists (
    select 1 from public.admin_users au where au.user_id = v_auth_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  if not exists (select 1 from public.contests where id = p_contest_id and status = 'VOTING_CLOSED') then
    raise exception using errcode = 'P0001', message = 'contest_not_closed';
  end if;

  for v_category in
    select id, finalists_count from public.contest_categories where contest_id = p_contest_id order by id
  loop
    if exists (select 1 from public.contest_result_snapshots where contest_id = p_contest_id and category_id = v_category.id) then
      continue;
    end if;

    insert into public.contest_result_snapshots (
      contest_id, category_id, finalists_count, status, tie_requires_decision
    ) values (
      p_contest_id, v_category.id, v_category.finalists_count, 'FROZEN', false
    ) returning id into v_snapshot_id;

    with candidates as (
      select s.id as submission_id, count(cv.id)::bigint as vote_count
        from public.submissions s
        join public.contest_categories cc on cc.id = s.category_id and cc.id = v_category.id
        join public.submission_publications sp on sp.submission_id = s.id and sp.revoked_at is null
        join public.submission_media sm on sm.id = sp.media_id and sm.status = 'FINALIZED' and sm.is_current
        left join public.contest_votes cv on cv.submission_id = s.id and cv.category_id = v_category.id
       where s.status = 'APPROVED'
       group by s.id
    ), ranked as (
      select c.*, dense_rank() over (order by c.vote_count desc) as rank_position
        from candidates c
    ), boundary as (
      select vote_count from ranked order by vote_count desc, submission_id offset greatest(v_category.finalists_count - 1, 0) limit 1
    )
    insert into public.contest_result_entries (snapshot_id, submission_id, rank_position, vote_count, is_cutoff_tie)
    select v_snapshot_id, r.submission_id, r.rank_position, r.vote_count,
           (r.vote_count = (select vote_count from boundary)
            and (select count(*) from ranked x where x.vote_count = r.vote_count) > v_category.finalists_count)
      from ranked r;

    select exists (
      select 1 from public.contest_result_entries e
      where e.snapshot_id = v_snapshot_id and e.is_cutoff_tie
    ) into v_tie;

    if v_tie then
      update public.contest_result_snapshots
         set status = 'TIE_REQUIRES_DECISION', tie_requires_decision = true
       where id = v_snapshot_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.confirm_contest_finalists(p_snapshot_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_snapshot public.contest_result_snapshots%rowtype;
  v_inserted integer;
begin
  if v_auth_user_id is null or not exists (select 1 from public.admin_users au where au.user_id = v_auth_user_id) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select * into v_snapshot from public.contest_result_snapshots where id = p_snapshot_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'snapshot_not_found'; end if;
  if v_snapshot.status = 'TIE_REQUIRES_DECISION' then
    raise exception using errcode = 'P0001', message = 'tie_requires_decision';
  end if;
  if v_snapshot.status <> 'FROZEN' then
    raise exception using errcode = 'P0001', message = 'snapshot_not_confirmable';
  end if;

  insert into public.contest_finalists (snapshot_id, contest_id, category_id, submission_id)
  select p_snapshot_id, v_snapshot.contest_id, v_snapshot.category_id, e.submission_id
    from public.contest_result_entries e
   where e.snapshot_id = p_snapshot_id
     and e.rank_position <= v_snapshot.finalists_count;
  get diagnostics v_inserted = row_count;
  update public.contest_result_snapshots
     set status = 'CONFIRMED', confirmed_at = now(), confirmed_by_auth_user_id = v_auth_user_id
   where id = p_snapshot_id;
  return v_inserted;
end;
$function$;

create or replace function public.publish_contest_finalists(p_snapshot_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_auth_user_id is null or not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  update public.contest_finalists
     set published_at = now(), published_by_auth_user_id = v_auth_user_id
   where snapshot_id = p_snapshot_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception using errcode = 'P0001', message = 'finalists_not_confirmed'; end if;
  update public.contest_result_snapshots set status = 'PUBLISHED', published_at = now(), published_by_auth_user_id = v_auth_user_id where id = p_snapshot_id and status = 'CONFIRMED';
  return v_count;
end;
$function$;

revoke execute on function public.cast_contest_vote(uuid, uuid) from public, anon, service_role;
grant execute on function public.cast_contest_vote(uuid, uuid) to authenticated;
revoke execute on function public.delete_contest_vote(uuid, text) from public, anon, service_role;
grant execute on function public.delete_contest_vote(uuid, text) to authenticated;
revoke execute on function public.close_contest_voting(uuid) from public, anon, service_role;
grant execute on function public.close_contest_voting(uuid) to authenticated;
revoke execute on function public.freeze_contest_results(uuid) from public, anon, service_role;
grant execute on function public.freeze_contest_results(uuid) to authenticated;
revoke execute on function public.confirm_contest_finalists(uuid) from public, anon, service_role;
grant execute on function public.confirm_contest_finalists(uuid) to authenticated;
revoke execute on function public.publish_contest_finalists(uuid) from public, anon, service_role;
grant execute on function public.publish_contest_finalists(uuid) to authenticated;
