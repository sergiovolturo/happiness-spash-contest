import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL(
  '../supabase/migrations/20261009140000_reject_invalidated_winner_snapshot.sql',
  import.meta.url,
), 'utf8');

const source = migration.slice(
  migration.indexOf('create or replace function public.admin_select_contest_winner'),
);

test('winner selection accepts published non-invalidated snapshots', () => {
  assert.match(source, /crs\.status = 'PUBLISHED'/);
  assert.match(source, /crs\.invalidated_at is null/);
});

test('winner selection rejects published invalidated snapshots', () => {
  assert.match(source, /and crs\.invalidated_at is null/);
});

test('existing winner and archive guards remain unchanged', () => {
  assert.match(source, /message = 'contest_archived'/);
  assert.match(source, /message = 'contest_archive_locked'/);
  assert.match(source, /on conflict \(contest_id, category_id\) do update/);
});

test('winner selection keeps the original finalist and category scoping', () => {
  assert.match(source, /cf\.contest_id = p_contest_id/);
  assert.match(source, /cf\.category_id = p_category_id/);
  assert.match(source, /cf\.submission_id = p_submission_id/);
  assert.match(source, /crs\.contest_id = p_contest_id/);
  assert.match(source, /crs\.category_id = p_category_id/);
  assert.match(source, /s\.category_id = p_category_id/);
});
