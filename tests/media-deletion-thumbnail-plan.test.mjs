import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20261009170000_media_deletion_thumbnail_plan.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const prepare = migration.slice(migration.indexOf('create or replace function public.admin_prepare_media_deletion'));
const finalize = migration.slice(migration.indexOf('create or replace function public.admin_finalize_media_deletion'));
const mediaDeletion = index.slice(index.indexOf('async function adminDeleteMedia'), index.indexOf('function adminSubmissionDeletionModal'));

test('media deletion stores a real-object plan for video and optional webp/jpg thumbnails', () => {
  assert.match(migration, /add column if not exists storage_objects jsonb/);
  assert.match(prepare, /from storage\.objects/);
  assert.match(prepare, /contest-thumbnails/);
  assert.match(prepare, /\.webp/);
  assert.match(prepare, /\.jpg/);
  assert.match(prepare, /jsonb_agg\(jsonb_build_object\('bucket',objects\.bucket,'path',objects\.path\)/);
  assert.match(prepare, /storage_objects=v_objects/);
  assert.match(prepare, /'objects',coalesce\(v_request\.storage_objects/);
});

test('pending retries reuse one request and normalize stale plans without creating a second request', () => {
  assert.match(prepare, /where media_id=p_media_id and status='PENDING'/);
  assert.match(prepare, /for update/);
  assert.match(prepare, /if not found then[\s\S]*insert into public\.contest_media_deletion_requests/);
  assert.match(prepare, /else[\s\S]*update public\.contest_media_deletion_requests[\s\S]*storage_objects=v_objects/);
  assert.match(prepare, /returning \* into v_request/);
});

test('finalize checks every planned object before changing publication, audit or media rows', () => {
  assert.match(finalize, /v_objects=coalesce\(v_request\.storage_objects/);
  assert.match(finalize, /jsonb_array_elements\(v_objects\)/);
  assert.match(finalize, /raise exception using errcode='P0001',message='storage_delete_required'/);
  assert.ok(finalize.indexOf('storage_delete_required') < finalize.indexOf('delete from public.submission_media'));
  assert.match(finalize, /contest_media_deletion_audit/);
  assert.match(finalize, /from jsonb_array_elements\(v_objects\)/);
});

test('legacy video-only requests remain finalizable and completed requests remain idempotent', () => {
  assert.match(finalize, /coalesce\(v_request\.storage_objects,\s*jsonb_build_array/);
  assert.match(finalize, /if v_request\.status='COMPLETED' then return jsonb_build_object\('status','COMPLETED'\)/);
  assert.match(mediaDeletion, /Array\.isArray\(plan\?\.objects\)/);
  assert.match(mediaDeletion, /plan\?\.storage_bucket&&plan\?\.storage_path/);
});

test('UI removes all planned objects, tolerates already-missing objects, and leaves pending requests for retry', () => {
  assert.match(mediaDeletion, /for\(const object of objects\)/);
  assert.match(mediaDeletion, /adminStorageObjectMissing\(removed\.error\)/);
  assert.doesNotMatch(mediaDeletion, /admin_cancel_media_deletion/);
  assert.match(mediaDeletion, /admin_finalize_media_deletion/);
});

test('media deletion remains distinct from submission deletion', () => {
  assert.match(mediaDeletion, /p_media_id:button\.dataset\.mediaId/);
  assert.doesNotMatch(mediaDeletion, /admin_delete_submission/);
});
