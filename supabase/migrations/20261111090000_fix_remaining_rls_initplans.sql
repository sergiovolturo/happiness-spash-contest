-- The four deletion-history policies are Admin-only SELECT policies.
-- Wrapping auth.uid() in a scalar SELECT preserves the predicate while
-- allowing PostgreSQL to evaluate the identity once per statement.
alter policy contest_media_deletion_requests_admin_select
  on public.contest_media_deletion_requests
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_media_deletion_audit_admin_select
  on public.contest_media_deletion_audit
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_deletion_requests_admin_select
  on public.contest_deletion_requests
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

alter policy contest_deletion_audit_admin_select
  on public.contest_deletion_audit
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
