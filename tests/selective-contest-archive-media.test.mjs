import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261008103000_selective_contest_archive_media_retention.sql', import.meta.url),
  'utf8',
);

const prepare = migration.slice(
  migration.indexOf('create or replace function public.admin_prepare_contest_archive'),
  migration.indexOf('create or replace function public.admin_finalize_contest_archive'),
);
const finalize = migration.slice(
  migration.indexOf('create or replace function public.admin_finalize_contest_archive'),
);

test('archive protects only current finalized media of official finalists', () => {
  assert.match(prepare, /from public\.contest_finalists f/);
  assert.match(prepare, /_current_contest_result_snapshots\(p_contest_id\)/);
  assert.match(prepare, /current_snapshot\.status = 'PUBLISHED'/);
  assert.match(prepare, /current_snapshot\.invalidated_at is null/);
  assert.match(prepare, /is_official_finalist/);
  assert.match(prepare, /status = 'FINALIZED'/);
  assert.match(prepare, /and is_current/);
  assert.match(prepare, /protected_media/);
  assert.match(prepare, /deletable_media/);
});

test('archive plan deletes non-protected originals and generated thumbnails only', () => {
  assert.match(prepare, /select distinct dm\.storage_bucket as bucket, dm\.storage_path as path/);
  assert.match(prepare, /from deletable_media dm/);
  assert.match(prepare, /'contest-thumbnails'/);
  assert.match(prepare, /submission-thumbnails\/' \|\| dm\.submission_id/);
  assert.match(prepare, /'delete_media_ids'/);
  assert.match(prepare, /'delete_media_count'/);
  assert.match(prepare, /'retained_media_count'/);
});

test('finalize marks only planned deletions and leaves retained finalist media current', () => {
  assert.match(finalize, /storage_delete_required/);
  assert.match(finalize, /jsonb_array_elements_text\(coalesce\(v_request\.plan->'delete_media_ids'/);
  assert.match(finalize, /update public\.submission_media sm/);
  assert.match(finalize, /storage_deleted_at = coalesce/);
  assert.match(finalize, /is_current = false/);
  assert.doesNotMatch(finalize, /where sm\.submission_id = s\.id[\s\S]*cc\.contest_id = v_request\.contest_id/);
  assert.doesNotMatch(finalize, /delete from public\.(submission_media|submissions|contest_votes|contest_finalists|contest_result_snapshots)/);
});

test('archive remains two-phase, retry-safe, and keeps historical Contest rows', () => {
  assert.match(prepare, /contest_archive_requests/);
  assert.match(prepare, /deletion_locked_at = now\(\)/);
  assert.match(finalize, /if v_request\.status = 'COMPLETED' then/);
  assert.match(finalize, /archived_at = coalesce\(archived_at, now\(\)\)/);
  assert.match(finalize, /status = 'COMPLETED', completed_at = now\(\)/);
  assert.doesNotMatch(migration, /delete from public\.(contests|contest_categories|submissions|contest_participations|contest_votes|contest_finalists|contest_result_snapshots)/);
});
