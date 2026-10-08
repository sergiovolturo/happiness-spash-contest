import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261008154951_allow_pending_archive_thumbnail_select.sql', import.meta.url), 'utf8');
const archive = fs.readFileSync(new URL('../supabase/migrations/20261006150908_contest_archive_media_cleanup.sql', import.meta.url), 'utf8');
const retention = fs.readFileSync(new URL('../supabase/migrations/20261008115634_archive_winner_only_retention.sql', import.meta.url), 'utf8');

test('pending archive thumbnail SELECT is Admin-only and scoped to the archive plan', () => {
  assert.match(migration, /on storage\.objects for select to authenticated/);
  assert.match(migration, /bucket_id = 'contest-thumbnails'/);
  assert.match(migration, /_admin_archive_storage_delete_allowed\(bucket_id, name\)/);
  assert.doesNotMatch(migration, /to anon/);
});

test('thumbnail paths outside the pending plan are not allowed by the new policy', () => {
  assert.match(archive, /r\.status = 'PENDING'/);
  assert.match(archive, /object_row->>'bucket'\) = p_bucket/);
  assert.match(archive, /object_row->>'path'\) = p_path/);
  assert.match(archive, /exists \(\s*select 1 from public\.admin_users au where au\.user_id = auth\.uid\(\)/s);
});

test('winner-retained thumbnail visibility remains handled by the existing public policy', () => {
  assert.match(retention, /_storage_object_is_archived_winner\('contest-thumbnails',name\)/);
  assert.match(retention, /bucket_id='contest-thumbnails'/);
});

test('archive Storage flow keeps the existing delete and finalize phases', () => {
  assert.match(archive, /create policy admin_contest_archive_objects_delete/);
  assert.match(archive, /admin_finalize_contest_archive/);
  assert.match(archive, /storage_delete_required/);
});
