import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const fix = fs.readFileSync(new URL('../supabase/migrations/20261009075311_grant_archived_winner_storage_helper_execute.sql', import.meta.url), 'utf8');
const retention = fs.readFileSync(new URL('../supabase/migrations/20261008115634_archive_winner_only_retention.sql', import.meta.url), 'utf8');
const archiveAcl = fs.readFileSync(new URL('../supabase/migrations/20261008154951_allow_pending_archive_thumbnail_select.sql', import.meta.url), 'utf8');

test('archived-winner helper ACL grants only the Storage policy roles', () => {
  assert.match(fix, /_storage_object_is_archived_winner\(text, text\)/);
  assert.match(fix, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(fix, /grant execute on function[\s\S]*to anon, authenticated/);
  assert.doesNotMatch(fix, /grant execute[\s\S]*to service_role/);
});

test('helper signature and SECURITY DEFINER behavior remain unchanged', () => {
  assert.match(retention, /create or replace function public\._storage_object_is_archived_winner\(p_bucket_id text,p_object_name text\)/);
  assert.match(retention, /returns boolean language sql stable security definer set search_path=''/);
});

test('public winner-retention policies require anon/authenticated helper execution', () => {
  assert.match(retention, /on storage\.objects for select to anon,authenticated/);
  assert.match(retention, /public\._storage_object_is_archived_winner\('contest-thumbnails',name\)/);
  assert.match(retention, /public\._storage_object_is_archived_winner\(p_bucket_id,p_object_name\)/);
});

test('pending thumbnail DELETE remains separately scoped to the archive plan', () => {
  assert.match(archiveAcl, /on storage\.objects for select to authenticated/);
  assert.match(archiveAcl, /bucket_id = 'contest-thumbnails'/);
  assert.match(archiveAcl, /public\._admin_archive_storage_delete_allowed\(bucket_id, name\)/);
  assert.doesNotMatch(fix, /admin_contest_archive/);
});
