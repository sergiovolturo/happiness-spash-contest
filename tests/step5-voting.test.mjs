import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000500_step5_voting.sql', import.meta.url),
  'utf8',
);

test('verified voter identity is provider-neutral', () => {
  assert.match(migration, /create type public\.voter_verification_method/i);
  assert.match(migration, /EMAIL_OTP/);
  assert.match(migration, /HAPPINESS_PLATFORM_AUTH/);
  assert.match(migration, /create table public\.verified_voter_identities/i);
});
test('email OTP requires verified Auth email', () => {
  assert.match(migration, /email_confirmed_at is not null/i);
  assert.match(migration, /extensions\.digest\(v_email, 'sha256'::text\)/i);
  assert.match(migration, /message = 'email_not_verified'/i);
});
test('voter resolution does not create participation', () => {
  assert.doesNotMatch(migration, /insert into public\.contest_participations/i);
  assert.doesNotMatch(migration, /admin_users.*insert/i);
});
test('voter does not receive elevated roles', () => {
  assert.doesNotMatch(migration, /insert into public\.(admin_users|contest_participations)/i);
});
test('contest votes table is separate from legacy votes', () => {
  assert.match(migration, /create table public\.contest_votes/i);
  assert.doesNotMatch(migration, /alter table public\.votes/i);
});
test('vote uniqueness is identity per category', () => {
  assert.match(migration, /unique \(voter_identity_id, category_id\)/i);
});
test('different categories remain independently votable', () => {
  assert.match(migration, /category_id uuid not null[\s\S]*references public\.contest_categories/i);
  assert.match(migration, /p_category_id uuid/i);
});
test('vote targets a submission in the requested category', () => {
  assert.match(migration, /s\.category_id = p_category_id/i);
  assert.match(migration, /submission_category_mismatch/i);
});
test('unpublished submissions are rejected', () => {
  assert.match(migration, /submission_not_public/i);
  assert.match(migration, /sp\.revoked_at is null/i);
});
test('revoked submissions are rejected', () => {
  assert.match(migration, /sp\.revoked_at is null/i);
});
test('voting requires VOTING_OPEN runtime state', () => {
  assert.match(migration, /c\.status = 'VOTING_OPEN'/i);
  assert.match(migration, /voting_not_open/i);
});
test('vote is definitive and has no public update/delete path', () => {
  assert.match(migration, /revoke all on table public\.contest_votes from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /update public\.contest_votes/i);
});
test('public clients cannot read results during voting', () => {
  assert.match(migration, /revoke all on table public\.contest_result_snapshots from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on table public\.contest_result_entries from public, anon, authenticated, service_role/i);
});
test('finalists count is category-configured', () => {
  assert.match(migration, /finalists_count integer not null/i);
  assert.match(migration, /v_category\.finalists_count/i);
});
test('results are ranked per category', () => {
  assert.match(migration, /contest_result_entries/i);
  assert.match(migration, /category_id = v_category\.id/i);
  assert.match(migration, /dense_rank\(\) over \(order by c\.vote_count desc\)/i);
});
test('cutoff ties are represented explicitly', () => {
  assert.match(migration, /tie_requires_decision/i);
  assert.match(migration, /is_cutoff_tie/i);
  assert.match(migration, /TIE_REQUIRES_DECISION/i);
});
test('ties are not resolved automatically', () => {
  assert.match(migration, /message = 'tie_requires_decision'/i);
  assert.doesNotMatch(migration, /order by .*created_at.*submission_id/i);
});
test('fraudulent votes can be physically deleted by RPC', () => {
  assert.match(migration, /create or replace function public\.delete_contest_vote/i);
  assert.match(migration, /delete from public\.contest_votes/i);
});
test('vote deletion audit is separate from vote count', () => {
  assert.match(migration, /create table public\.vote_deletion_audits/i);
  assert.match(migration, /insert into public\.vote_deletion_audits/i);
});
test('deletion audit records vote identity and reason', () => {
  assert.match(migration, /vote_id, voter_identity_id, submission_id, category_id/i);
  assert.match(migration, /deletion_reason/i);
});
test('non-admin cannot delete votes', () => {
  assert.match(migration, /message = 'admin_required'/i);
  assert.match(migration, /revoke execute on function public\.delete_contest_vote\(uuid, text\) from public, anon/i);
});
test('closing voting blocks new votes', () => {
  assert.match(migration, /create or replace function public\.close_contest_voting/i);
  assert.match(migration, /set status = 'VOTING_CLOSED'/i);
  assert.match(migration, /contest_not_voting_open/i);
});
test('results are frozen after close', () => {
  assert.match(migration, /create or replace function public\.freeze_contest_results/i);
  assert.match(migration, /status = 'VOTING_CLOSED'/i);
  assert.match(migration, /status.*'FROZEN'/i);
});
test('finalists are not published during freeze', () => {
  assert.match(migration, /create table public\.contest_finalists/i);
  assert.match(migration, /create or replace function public\.confirm_contest_finalists/i);
  const freeze = migration.slice(
    migration.indexOf('create or replace function public.freeze_contest_results'),
    migration.indexOf('create or replace function public.confirm_contest_finalists'),
  );
  assert.doesNotMatch(freeze, /insert into public\.contest_finalists/i);
});
test('Admin confirmation is required before finalist publication', () => {
  assert.match(migration, /confirm_contest_finalists/i);
  assert.match(migration, /status = 'CONFIRMED'/i);
  assert.match(migration, /publish_contest_finalists/i);
});
test('finalist publication is explicit', () => {
  assert.match(migration, /create or replace function public\.publish_contest_finalists/i);
  assert.match(migration, /status = 'PUBLISHED'/i);
});
test('category isolation is enforced by RPC and foreign keys', () => {
  assert.match(migration, /references public\.contest_categories\(id\)/i);
  assert.match(migration, /s\.category_id = p_category_id/i);
});
test('public ACLs expose no voting tables or results', () => {
  assert.match(migration, /revoke all on table public\.contest_votes from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on table public\.vote_deletion_audits from public, anon, authenticated, service_role/i);
});
test('all Step 5 RPCs explicitly remove service_role default execute', () => {
  assert.match(migration, /revoke execute on function public\.cast_contest_vote\(uuid, uuid\) from public, anon, service_role/i);
  assert.match(migration, /revoke execute on function public\.publish_contest_finalists\(uuid\) from public, anon, service_role/i);
});
test('legacy public.votes is untouched and future Auth integration remains possible', () => {
  assert.doesNotMatch(migration, /drop table public\.votes|alter table public\.votes/i);
  assert.match(migration, /auth_user_id uuid references auth\.users\(id\) on delete set null/i);
});
