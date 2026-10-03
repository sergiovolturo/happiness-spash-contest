import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261002175402_public_contest_archive_retention.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionSource = fs.readFileSync(new URL('../supabase/functions/retain-finalist-media/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

const archiveEligible = contest => ['VOTING_CLOSED', 'CLOSED'].includes(contest.status);
const currentSnapshots = rows => Object.values(rows.reduce((acc, row) => {
  if (!acc[row.category_id] || row.frozen_at > acc[row.category_id].frozen_at) acc[row.category_id] = row;
  return acc;
}, {}));
const officialFinalist = (snapshots, finalists, submissionId) => {
  const currentIds = new Set(currentSnapshots(snapshots)
    .filter(row => row.status === 'PUBLISHED' && !row.invalidated_at)
    .map(row => row.id));
  return finalists.some(row => row.submission_id === submissionId && currentIds.has(row.snapshot_id));
};

test('public ordering puts submissions open before voting open and sorts each phase newest first', () => {
  const ordering = migration.slice(migration.indexOf('create or replace function public.get_public_contests()'), migration.indexOf('create or replace function public.get_public_contest_archive()'));
  assert.match(ordering, /when 'SUBMISSIONS_OPEN'.*then 1[\s\S]*when 'VOTING_OPEN'.*then 2/);
  assert.match(ordering, /c\.updated_at desc nulls last,c\.created_at desc/);
  assert.doesNotMatch(ordering, /when 'VOTING_OPEN'.*then 1/);
});

test('archive is a separate public surface restricted to concluded lifecycle states', () => {
  assert.match(migration, /create or replace function public\.get_public_contest_archive\(\)/);
  assert.match(migration, /c\.status in \(\s*'VOTING_CLOSED'.*'CLOSED'/s);
  assert.match(migration, /create or replace function public\.get_public_archive_contest_categories\(p_contest_id uuid\)/);
  assert.match(migration, /create or replace function public\.get_public_archive_contest_results\(p_contest_id uuid\)/);
  assert.doesNotMatch(migration, /c\.archived_at is not null or c\.status in/);
  assert.equal(archiveEligible({ status: 'DRAFT', archived_at: '2026-10-02T00:00:00Z' }), false, 'archived DRAFT must stay private');
  assert.equal(archiveEligible({ status: 'VOTING_CLOSED', archived_at: null }), true);
  assert.equal(archiveEligible({ status: 'CLOSED', archived_at: null }), true);
  assert.doesNotMatch(index, /Archivio Contest/);
  assert.doesNotMatch(index, /get_public_archive_contest_categories/);
  assert.doesNotMatch(index, /get_public_archive_contest_results/);
});

test('public archive is absent while Admin archive retention remains covered', () => {
  assert.doesNotMatch(index, /const returnToActiveHome=async\(requestId\)=>/);
  assert.doesNotMatch(index, /returnToActiveHome\(requestId\)/);
  assert.match(index, /adminArchive/);
  assert.match(index, /admin_archive_contest/);
});

test('current snapshot is canonical and blocks retention when latest snapshot is not definitive', () => {
  assert.match(migration, /create or replace function public\._current_contest_result_snapshots\(p_contest_id uuid\)/);
  assert.match(migration, /order by rs\.category_id,rs\.frozen_at desc,rs\.id desc/);
  assert.match(migration, /current_snapshot\.status='PUBLISHED'/);
  assert.match(migration, /current_snapshot\.invalidated_at is null/);
  assert.match(migration, /finalists_not_definitive/);
  assert.match(migration, /admin_prepare_finalist_media_retention[\s\S]*_current_contest_result_snapshots\(p_contest_id\)/);
  assert.match(migration, /join public\._current_contest_result_snapshots\(p_contest_id\) current_snapshot/);
  assert.match(migration, /join public\._current_contest_result_snapshots\(v_request\.contest_id\) current_snapshot/);
});

test('retention snapshot cases protect only the current official finalist', () => {
  const old = { id: 'old', category_id: 'cat', frozen_at: '2026-01-01', status: 'PUBLISHED', invalidated_at: null };
  const current = { id: 'current', category_id: 'cat', frozen_at: '2026-02-01', status: 'PUBLISHED', invalidated_at: null };
  const nonDefinitive = { id: 'pending', category_id: 'cat', frozen_at: '2026-03-01', status: 'FROZEN', invalidated_at: null };
  assert.equal(officialFinalist([old, current], [{ snapshot_id: 'old', submission_id: 's-old' }], 's-old'), false);
  assert.equal(officialFinalist([old, current], [{ snapshot_id: 'current', submission_id: 's-current' }], 's-current'), true);
  assert.equal(officialFinalist([old, nonDefinitive], [{ snapshot_id: 'old', submission_id: 's-old' }], 's-old'), false);
});

test('retention never deletes finalists and requires Storage deletion first', () => {
  const finalize = migration.slice(migration.indexOf('create or replace function public.admin_finalize_finalist_media_retention'));
  assert.match(finalize, /finalist_media_protected/);
  assert.match(finalize, /storage_delete_required/);
  assert.match(finalize, /insert into public\.contest_media_deletion_audit/);
  assert.match(finalize, /delete from public\.submission_media/);
  assert.match(finalize, /NON_FINALIST_CLEANUP/);
  assert.doesNotMatch(finalize, /delete from public\.(submissions|contest_votes|contest_result_snapshots|contest_finalists)/);
});

test('retention worker supports Admin JWT and a server-side worker token without a client secret', () => {
  assert.match(functionSource, /callerIsAdmin/);
  assert.match(functionSource, /RETENTION_WORKER_TOKEN/);
  assert.match(functionSource, /x-retention-worker-token/);
  assert.match(functionSource, /sameSecret/);
  assert.match(functionSource, /eq\('status', 'CLOSED'\)/);
  assert.match(functionSource, /admin_prepare_finalist_media_retention/);
  assert.match(functionSource, /admin_finalize_finalist_media_retention/);
  assert.match(functionSource, /storage_path/);
  assert.match(functionSource, /if \(!finalizeError\) completed \+= 1/);
  assert.match(config, /\[functions\.retain-finalist-media\]\s+verify_jwt = false/);
  assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(functionSource, /SUPABASE_SECRET_KEYS/);
  assert.doesNotMatch(functionSource, /service_role\s*[:=]\s*['"][^'" ]+['"]/i);
});

test('retention preserves application history, protects finalists, and is retry-safe', () => {
  assert.match(migration, /contest_media_deletion_requests/);
  assert.match(migration, /contest_media_deletion_audit/);
  assert.match(migration, /delete from public\.submission_publications/);
  assert.match(migration, /delete from public\.submission_media/);
  assert.doesNotMatch(migration, /delete from public\.submissions/);
  assert.doesNotMatch(migration, /delete from public\.contest_votes/);
  assert.match(migration, /if v_request\.status='COMPLETED' then return/);
  assert.match(functionSource, /contestId/);
  assert.match(functionSource, /eq\('id', contestId\)/);
});
