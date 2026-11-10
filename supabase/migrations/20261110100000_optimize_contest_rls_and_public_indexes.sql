-- Performance-only hardening. The policy names, roles and commands remain
-- unchanged; these explicit definitions only scope auth.uid() to the
-- statement so PostgreSQL does not re-evaluate it for every candidate row.
alter policy contest_archive_requests_admin_select
  on public.contest_archive_requests
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_categories_admin_all
  on public.contest_categories
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_category_definitions_admin_read
  on public.contest_category_definitions
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_finalists_admin_select
  on public.contest_finalists
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_participations_admin_all
  on public.contest_participations
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_participations_insert_own
  on public.contest_participations
  with check (exists (select 1 from public.platform_identities pi where pi.id = contest_participations.identity_id and pi.auth_user_id = (select auth.uid())));

alter policy contest_participations_select_own_or_admin
  on public.contest_participations
  using (
    exists (select 1 from public.platform_identities pi where pi.id = contest_participations.identity_id and pi.auth_user_id = (select auth.uid()))
    or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  );

alter policy contest_result_entries_admin_select
  on public.contest_result_entries
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_result_snapshots_admin_select
  on public.contest_result_snapshots
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_tie_resolutions_admin_select
  on public.contest_tie_resolutions
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_votes_admin_select
  on public.contest_votes
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_winners_admin_select
  on public.contest_winners
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contests_admin_all
  on public.contests
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy platform_identities_insert_self
  on public.platform_identities
  with check (auth_user_id = (select auth.uid()));

alter policy platform_identities_select_self_or_admin
  on public.platform_identities
  using (
    auth_user_id = (select auth.uid())
    or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  );

alter policy submission_media_select_owner_or_admin
  on public.submission_media
  using (
    exists (
      select 1
      from public.submissions s
      join public.contest_participations cp on cp.id = s.participation_id
      join public.platform_identities pi on pi.id = cp.identity_id
      where s.id = submission_media.submission_id and pi.auth_user_id = (select auth.uid())
    )
    or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  );

alter policy submission_moderation_events_select_owner_or_admin
  on public.submission_moderation_events
  using (
    exists (
      select 1
      from public.submissions s
      join public.contest_participations cp on cp.id = s.participation_id
      join public.platform_identities pi on pi.id = cp.identity_id
      where s.id = submission_moderation_events.submission_id and pi.auth_user_id = (select auth.uid())
    )
    or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  );

alter policy submission_publications_select_admin
  on public.submission_publications
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy submissions_select_own_or_admin
  on public.submissions
  using (
    exists (
      select 1
      from public.contest_participations cp
      join public.platform_identities pi on pi.id = cp.identity_id
      where cp.id = submissions.participation_id and pi.auth_user_id = (select auth.uid())
    )
    or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
  );

alter policy verified_voter_identities_admin_select
  on public.verified_voter_identities
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy vote_deletion_audits_admin_select
  on public.vote_deletion_audits
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

-- These indexes cover the public/results joins observed in the live RPCs.
-- Existing primary/unique indexes already cover the other hot paths.
create index if not exists contest_finalists_contest_category_idx
  on public.contest_finalists (contest_id, category_id);

create index if not exists contest_result_entries_submission_idx
  on public.contest_result_entries (submission_id);

create index if not exists contest_result_snapshots_category_idx
  on public.contest_result_snapshots (category_id, status, published_at desc);
