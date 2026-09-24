-- Remove inherited Data API privileges from the public role on private
-- application relations. RLS remains the row-level authorization boundary.
revoke all on table public.submissions from anon;
revoke all on table public.submission_media from anon;
revoke all on table public.submission_publications from anon;
