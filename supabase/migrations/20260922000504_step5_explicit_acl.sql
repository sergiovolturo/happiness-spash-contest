-- Remove Supabase default Data API privileges from Step 5 objects.
-- Step 5 uses authenticated RPCs and Admin-gated RLS; service_role has no
-- required direct Data API surface for these objects.
revoke all on table public.verified_voter_identities from service_role;
revoke all on table public.contest_votes from service_role;
revoke all on table public.vote_deletion_audits from service_role;
revoke all on table public.contest_result_snapshots from service_role;
revoke all on table public.contest_result_entries from service_role;
revoke all on table public.contest_finalists from service_role;

revoke execute on function public.cast_contest_vote(uuid, uuid) from service_role;
revoke execute on function public.delete_contest_vote(uuid, text) from service_role;
revoke execute on function public.close_contest_voting(uuid) from service_role;
revoke execute on function public.freeze_contest_results(uuid) from service_role;
revoke execute on function public.confirm_contest_finalists(uuid) from service_role;
revoke execute on function public.publish_contest_finalists(uuid) from service_role;
