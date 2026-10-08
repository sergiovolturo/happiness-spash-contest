import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261008115634_archive_winner_only_retention.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const prepare = migration.slice(migration.indexOf('create or replace function public.admin_prepare_contest_archive'));
const finalize = migration.slice(migration.indexOf('create or replace function public.admin_finalize_contest_archive'));
const hall = migration.slice(migration.indexOf('create or replace function public.get_public_hall_of_fame'), migration.indexOf('create or replace function public._storage_object_is_archived_winner'));

test('archive requires every active winner-required category and validates the official published winner media', () => {
  assert.match(prepare, /cc\.is_active and cc\.winner_required/);
  assert.match(prepare, /winner_required_missing/);
  assert.match(prepare, /_archive_contest_winner_media\(p_contest_id\)/);
  assert.match(prepare, /winner_not_valid_published_finalist_media/);
  assert.match(migration, /cf\.published_at is not null/);
  assert.match(migration, /crs\.status = 'PUBLISHED'/);
  assert.match(migration, /crs\.invalidated_at is null/);
  assert.match(migration, /sm\.status = 'FINALIZED'/);
  assert.match(migration, /sm\.is_current/);
  assert.match(migration, /sm\.storage_deleted_at is null/);
});

test('archive plan explicitly separates retained winner media from every object to delete', () => {
  assert.match(prepare, /'retained_media_ids'/);
  assert.match(prepare, /'deleted_media_ids'/);
  assert.match(prepare, /'retained_objects'/);
  assert.match(prepare, /'objects'/);
  assert.match(prepare, /contest-thumbnails/);
  assert.match(prepare, /contest-videos/);
  assert.match(prepare, /except select distinct wm\.storage_bucket/);
  assert.match(index, /for\(const object of Array\.isArray\(plan\?\.objects\)/);
});

test('finalization is two-phase, retry-safe, and marks only non-winner media as deleted', () => {
  assert.match(finalize, /if v_request\.status='COMPLETED' then/);
  assert.match(finalize, /storage_delete_required/);
  assert.match(finalize, /deleted_media_ids/);
  assert.match(finalize, /jsonb_array_elements_text/);
  assert.match(finalize, /storage_deleted_at=coalesce/);
  assert.match(finalize, /is_current=false/);
  assert.doesNotMatch(finalize, /where sm\.submission_id = s\.id\s+and cc\.contest_id/);
  assert.match(finalize, /archived_at=coalesce/);
});

test('Hall of Fame includes archived winners while retaining publication/media safety checks', () => {
  assert.match(hall, /c\.status='CLOSED'/);
  assert.doesNotMatch(hall, /c\.archived_at is null/);
  assert.match(hall, /c\.deletion_locked_at is null/);
  assert.match(hall, /from public\.contest_winners cw/);
  assert.match(hall, /cf\.published_at is not null/);
  assert.match(hall, /crs\.status='PUBLISHED'/);
  assert.match(hall, /sm\.status='FINALIZED'/);
  assert.match(hall, /sm\.storage_deleted_at is null/);
});

test('Storage access after archive is limited to winner-linked objects', () => {
  assert.match(migration, /_storage_object_is_archived_winner/);
  assert.match(migration, /c\.archived_at is not null/);
  assert.match(migration, /drop policy if exists published_contest_thumbnail_bucket_objects_select/);
  assert.match(migration, /create or replace function public\.storage_object_is_published\(p_bucket_id text,p_object_name text\)/);
  assert.match(migration, /grant execute on function public\.storage_object_is_published\(text,text\) to anon,authenticated/);
});

test('Admin copy explains winner-only retention', () => {
  assert.match(index, /solo il video e l’eventuale anteprima dei vincitori definitivi/);
  assert.match(index, /L’archiviazione conserverà solo il video e l’eventuale anteprima dei vincitori definitivi/);
});
