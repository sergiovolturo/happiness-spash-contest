import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261004100000_admin_submission_deletion.sql'), 'utf8');
const snapshotFix = fs.readFileSync(path.join(root, 'supabase/migrations/20261004110000_admin_submission_deletion_category_snapshot_fix.sql'), 'utf8');
const auditCleanup = fs.readFileSync(path.join(root, 'supabase/migrations/20261004120000_admin_submission_deletion_media_audit_cleanup.sql'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'supabase/migrations/20261004130000_admin_submission_delete_preflight_storage_acl.sql'), 'utf8');
const storageAcl = fs.readFileSync(path.join(root, 'supabase/migrations/20261004140000_admin_submission_storage_helper_acl.sql'), 'utf8');
const thumbnailDeletePolicy = fs.readFileSync(path.join(root, 'supabase/migrations/20261004150000_admin_submission_thumbnail_delete_policy.sql'), 'utf8');
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

test('technical media audit cleanup is scoped to the deleted submission', () => {
  assert.match(auditCleanup, /delete from public\.contest_media_deletion_requests where submission_id=p_submission_id/);
  assert.match(auditCleanup, /delete from public\.contest_media_deletion_audit where submission_id=p_submission_id/);
  assert.match(auditCleanup, /delete from public\.submission_media where submission_id=p_submission_id/);
  assert.match(auditCleanup, /delete from public\.submissions where id=p_submission_id/);
  assert.match(auditCleanup, /contest_result_entries where submission_id=p_submission_id/);
  assert.match(auditCleanup, /contest_finalists where submission_id=p_submission_id/);
  assert.doesNotMatch(auditCleanup, /delete from public\.contest_media_deletion_(requests|audit)\s*;/);
});

test('preflight blocks protected submissions before Storage deletion', () => {
  assert.match(preflight, /create or replace function public\.admin_get_submission_delete_status/);
  assert.match(preflight, /grant execute on function public\.admin_get_submission_delete_status\(uuid\) to authenticated/);
  assert.match(preflight, /publication_exists/);
  assert.match(preflight, /votes_exist/);
  assert.match(preflight, /results_exist/);
  assert.match(preflight, /finalist_exists/);
  assert.match(preflight, /lifecycle_locked/);
  assert.match(index, /admin_get_submission_delete_status/);
  assert.match(index, /if\(!status\?\.deletable\)/);
  assert.match(index, /adminRemoveSubmissionObject\(item\.storage_bucket,item\.storage_path\)/);
  assert.match(index, /const preflight=await supabase\.rpc\('admin_get_submission_delete_status'/);
});

test('Storage helper is executable by the internal policy evaluator but remains Admin/path scoped', () => {
  assert.match(preflight, /grant execute on function public\._admin_submission_storage_delete_allowed\(text,text\)\s+to supabase_storage_admin/);
  assert.match(preflight, /_admin_submission_storage_delete_allowed/);
  assert.doesNotMatch(preflight, /grant execute on function public\._admin_submission_storage_delete_allowed\(text,text\)\s+to anon/);
});

test('thumbnail deletion treats only a missing optional object as non-blocking', () => {
  assert.match(index, /const adminStorageObjectMissing=error=>/);
  assert.match(index, /adminRemoveSubmissionObject\('contest-thumbnails'/);
  assert.match(index, /adminRemoveSubmissionObject\('contest-thumbnails',[^,]+,true\)/);
  assert.match(index, /status\|\|error\?\.statusCode\)===404/);
  assert.match(index, /adminRemoveSubmissionObject\(item\.storage_bucket,item\.storage_path\)/);
  assert.match(storageAcl, /to authenticated/);
  assert.match(storageAcl, /to supabase_storage_admin/);
});

test('thumbnail DELETE policy passes the authenticated Admin explicitly through the Storage evaluator', () => {
  assert.match(thumbnailDeletePolicy, /_admin_submission_storage_delete_allowed_for_user\(text,text,uuid\)/);
  assert.match(thumbnailDeletePolicy, /admin_users au where au\.user_id=p_auth_user_id/);
  assert.match(thumbnailDeletePolicy, /_admin_submission_storage_delete_allowed_for_user\(bucket_id,name,auth\.uid\(\)\)/);
  assert.match(thumbnailDeletePolicy, /to authenticated/);
  assert.match(thumbnailDeletePolicy, /to supabase_storage_admin/);
  assert.doesNotMatch(thumbnailDeletePolicy, /to anon/);
  for (const table of ['submission_publications','contest_votes','vote_deletion_audits','contest_result_entries','contest_finalists']) {
    assert.match(thumbnailDeletePolicy, new RegExp(`public\\.${table}`));
  }
});

test('submission deletion covers every media version and both optional thumbnail extensions', () => {
  assert.match(adminDelete, /\.eq\('submission_id',submissionId\)/);
  assert.doesNotMatch(adminDelete, /\.eq\('is_current',true\)/);
  assert.match(adminDelete, /item\.storage_bucket,item\.storage_path/);
  assert.match(adminDelete, /for\(const extension of \['webp','jpg'\]\)/);
  assert.match(adminDelete, /adminRemoveSubmissionObject\('contest-thumbnails'/);
});

test('Storage deletion policy is narrow and does not grant anonymous writes', () => {
  assert.match(migration, /create policy admin_submission_objects_delete/);
  assert.match(migration, /on storage\.objects for delete to authenticated/);
  assert.doesNotMatch(migration, /for delete to anon/);
  assert.match(migration, /_admin_submission_storage_delete_allowed/);
  assert.match(migration, /submission-thumbnails\/'\|\|sm\.submission_id/);
  assert.match(migration, /sm\.storage_path/);
});

