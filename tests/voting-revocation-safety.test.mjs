import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260930000800_block_media_finalize_during_voting.sql', import.meta.url), 'utf8');
const revoke = await readFile(new URL('../supabase/migrations/20260922000400_step4_publication_readiness.sql', import.meta.url), 'utf8');
const deletion = await readFile(new URL('../supabase/migrations/20260929000200_contest_workspace_archive_purge.sql', import.meta.url), 'utf8');
const freeze = await readFile(new URL('../supabase/migrations/20260922000514_post_freeze_vote_delete_consistency.sql', import.meta.url), 'utf8');
const revokeBody = revoke.slice(revoke.indexOf('create or replace function public.revoke_published_submission('), revoke.indexOf('revoke execute on function public.open_contest_voting'));

test('voting-open publication revoke remains an Admin RPC with mandatory reason', () => {
  assert.match(revokeBody, /p_revoke_reason text/);
  assert.match(revokeBody, /revoke_reason_required/);
  assert.match(revokeBody, /update public\.submission_publications[\s\S]*revoked_at = now\(\)/i);
  assert.doesNotMatch(revokeBody, /VOTING_OPEN/);
});

test('publication revoke preserves the media and contest votes', () => {
  assert.doesNotMatch(revokeBody, /delete from public\.submission_media/i);
  assert.doesNotMatch(revokeBody, /delete from public\.contest_votes/i);
  assert.match(index, /Il video non sarà più visibile né votabile/);
  assert.match(index, /voti già registrati resteranno conservati per audit/);
});

test('revoked publications are excluded from the public surface and future freeze', () => {
  const publicationView = revoke.slice(revoke.indexOf('create view public.published_submission_media'), revoke.indexOf('create or replace function public.open_contest_voting'));
  assert.match(publicationView, /where sp\.revoked_at is null/);
  assert.match(freeze, /join public\.submission_publications sp[\s\S]*sp\.revoked_at is null/);
  assert.match(freeze, /join public\.submission_media sm[\s\S]*sm\.status = 'FINALIZED'[\s\S]*sm\.is_current/);
});

test('new media deletion is blocked during protected lifecycles', () => {
  const prepare = deletion.slice(deletion.indexOf('create or replace function public.admin_prepare_media_deletion'));
  assert.match(prepare, /v_contest\.status in \('VOTING_OPEN','VOTING_CLOSED','CLOSED'\)/);
  assert.match(prepare, /media_delete_blocked_lifecycle/);
});

test('pending media deletion cannot be finalized after voting starts', () => {
  assert.match(migration, /create or replace function public\.admin_finalize_media_deletion/);
  assert.match(migration, /select c\.\* into v_contest[\s\S]*v_request\.contest_id/);
  assert.match(migration, /v_contest\.status in \('VOTING_OPEN','VOTING_CLOSED','CLOSED'\)/);
  assert.match(migration, /raise exception using errcode='P0001',message='media_delete_blocked_lifecycle'/);
  assert.ok(migration.indexOf("if v_contest.status in") < migration.indexOf('delete from public.submission_media'));
});

test('final media deletion keeps the two-phase Storage safety check and audit', () => {
  assert.match(migration, /storage\.objects/);
  assert.match(migration, /storage_delete_required/);
  assert.match(migration, /contest_media_deletion_audit/);
  assert.match(migration, /delete from public\.submission_media/);
});

test('Admin voting UI keeps exceptional revoke and removes media deletion controls', () => {
  const safety = index.slice(index.lastIndexOf('const adminRevokeBeforeVotingSafety='));
  assert.match(safety, /adminSelectedContest\?\.status!=='VOTING_OPEN'/);
  assert.match(safety, /confirm\(`Revocare questa candidatura durante la votazione\?/);
  assert.match(safety, /querySelectorAll\('\[data-media-delete\]'\)\.forEach\(button=>button\.remove\(\)\)/);
  assert.match(safety, /adminRevoke\(button\.dataset\.id/);
});

test('Admin revoke preserves the pre-voting behavior', () => {
  const safety = index.slice(index.lastIndexOf('const adminRevokeBeforeVotingSafety='));
  assert.match(safety, /return adminRevokeBeforeVotingSafety\(id,voteCount\)/);
});

test('voting action remains server-authoritative and unchanged', () => {
  assert.match(index, /supabase\.rpc\('cast_contest_vote'/);
  assert.match(index, /submission_not_public/);
  assert.doesNotMatch(migration, /cast_contest_vote|contest_votes/);
});

