-- Explicitly remove PUBLIC privileges as well as role-specific Data API grants.
revoke all on table public.verified_voter_identities from public;
revoke all on table public.contest_votes from public;
revoke all on table public.vote_deletion_audits from public;
revoke all on table public.contest_result_snapshots from public;
revoke all on table public.contest_result_entries from public;
revoke all on table public.contest_finalists from public;
