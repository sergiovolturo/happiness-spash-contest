import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261008153000_archive_plan_existing_storage_objects.sql', import.meta.url), 'utf8');
const prepare = migration.slice(migration.indexOf('create or replace function public.admin_prepare_contest_archive'));

test('archive plan is built from existing Storage objects only', () => {
  assert.match(prepare, /with media_scope as/);
  assert.match(prepare, /candidates as/);
  assert.match(prepare, /from storage\.objects so/);
  assert.match(prepare, /join candidates c on c\.bucket=so\.bucket_id and c\.path=so\.name/);
  assert.match(prepare, /not exists \(select 1 from retained/);
});

test('missing jpg/webp and legacy paths cannot enter the deletion plan', () => {
  assert.match(prepare, /contest-thumbnails/);
  assert.match(prepare, /contest-videos/);
  assert.match(prepare, /\.webp/);
  assert.match(prepare, /\.jpg/);
  assert.doesNotMatch(prepare, /jsonb_agg\(jsonb_build_object\('bucket', o\.bucket, 'path', o\.path\)[\s\S]*from \(\s*select distinct sm\.storage_bucket/);
});

test('pending archive retries reuse the request and refresh its plan', () => {
  assert.match(prepare, /deletion_locked_at is not null/);
  assert.match(prepare, /status = 'PENDING'/);
  assert.match(prepare, /for update/);
  assert.match(prepare, /v_request := v_existing\.id/);
  assert.match(prepare, /v_retry := true/);
  assert.match(prepare, /update public\.contest_archive_requests set plan = v_plan where id = v_request/);
  const retryStart = prepare.indexOf('if v_retry then');
  const retryBranch = prepare.slice(retryStart, prepare.indexOf('else', retryStart));
  assert.doesNotMatch(retryBranch, /insert into public\.contest_archive_requests/);
});

test('winner retained objects stay out of the deletion plan', () => {
  assert.match(prepare, /retained as/);
  assert.match(prepare, /_archive_contest_winner_media\(p_contest_id\)/);
  assert.match(prepare, /where not exists \(select 1 from retained r/);
  assert.match(prepare, /'retained_objects'/);
});

test('empty Storage plans are represented as an empty array and remain finalizable', () => {
  assert.match(prepare, /'objects', coalesce\(/);
  assert.match(prepare, /'\[\]'::jsonb/);
});
