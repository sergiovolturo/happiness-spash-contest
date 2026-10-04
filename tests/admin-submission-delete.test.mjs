import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261004100000_admin_submission_deletion.sql'), 'utf8');
const snapshotFix = fs.readFileSync(path.join(root, 'supabase/migrations/20261004110000_admin_submission_deletion_category_snapshot_fix.sql'), 'utf8');
const card = index.slice(index.indexOf('const adminSubmissionCardHtml='), index.indexOf('const adminAddCategoryFieldLabels='));
const adminDelete = index.slice(index.indexOf('async function adminDeleteSubmission'), index.indexOf('const adminContestDeletionReason='));

test('Admin submission deletion is a distinct action from media deletion', () => {
  assert.match(card, /Elimina video/);
  assert.match(card, /data-submission-delete/);
  assert.match(card, /Elimina candidatura/);
  assert.match(index, /querySelectorAll\('\[data-submission-delete\]'\)/);
  assert.match(adminDelete, /admin_delete_submission/);
  assert.match(adminDelete, /contest-thumbnails/);
});

test('submission deletion requires an explicit confirmation and preserves the media-only flow', () => {
  assert.match(index, /adminSubmissionDeletionModal/);
  assert.match(adminDelete, /await adminSubmissionDeletionModal/);
  assert.match(index, /admin_prepare_media_deletion/);
  assert.match(index, /admin_finalize_media_deletion/);
  assert.match(migration, /storage_delete_required/);
  assert.match(migration, /delete from public\.submission_media/);
  assert.match(migration, /delete from public\.submissions/);
});

test('submission deletion is Admin-only and blocks preserved history', () => {
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /public\.admin_users/);
  for (const table of [
    'submission_publications', 'contest_votes', 'vote_deletion_audits',
    'contest_result_entries', 'contest_finalists', 'submission_moderation_events',
    'contest_media_deletion_requests', 'contest_media_deletion_audit',
    'contest_result_snapshots'
  ]) assert.match(migration, new RegExp(`public\\.${table}`));
  assert.match(migration, /submission_delete_blocked/);
});

test('a category snapshot alone does not block an unrelated submission', () => {
  assert.match(snapshotFix, /contest_result_entries re where re\.submission_id=p_submission_id/);
  assert.match(snapshotFix, /contest_finalists cf where cf\.submission_id=p_submission_id/);
  assert.doesNotMatch(snapshotFix, /contest_result_snapshots rs where rs\.contest_id=.*category_id/);
  assert.match(snapshotFix, /contest_media_deletion_audit da where da\.submission_id=p_submission_id/);
});

test('Storage deletion policy is narrow and does not grant anonymous writes', () => {
  assert.match(migration, /create policy admin_submission_objects_delete/);
  assert.match(migration, /on storage\.objects for delete to authenticated/);
  assert.doesNotMatch(migration, /for delete to anon/);
  assert.match(migration, /_admin_submission_storage_delete_allowed/);
  assert.match(migration, /submission-thumbnails\/'\|\|sm\.submission_id/);
  assert.match(migration, /sm\.storage_path/);
});

