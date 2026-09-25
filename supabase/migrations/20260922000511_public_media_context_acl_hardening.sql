-- Remove inherited Data API privileges from the participation relation used
-- only by the server-side public view join.
revoke all on table public.contest_participations from anon;
