-- Align already-deployed Step 4 objects with the least-privilege ACL contract.
-- This is a corrective migration for environments where 00400 is already applied.

revoke all on table public.submission_publications from anon;
revoke all on table public.submission_publications from authenticated;
grant select on table public.submission_publications to authenticated;

revoke all on public.published_submission_media from public, anon, authenticated;
grant select on public.published_submission_media to anon, authenticated;
