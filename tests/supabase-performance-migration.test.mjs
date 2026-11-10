import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261110100000_optimize_contest_rls_and_public_indexes.sql', import.meta.url),
  'utf8'
);

test('performance migration uses explicit policy alterations without dynamic catalog loops', () => {
  assert.match(migration, /alter policy contest_participations_admin_all/i);
  assert.match(migration, /alter policy submissions_select_own_or_admin/i);
  assert.match(migration, /alter policy submission_media_select_owner_or_admin/i);
  assert.doesNotMatch(migration, /pg_policies|for\s+p\s+in|replace\s*\(/i);
  assert.doesNotMatch(migration, /drop policy|disable row level security/i);
});

test('performance migration adds only targeted public/results indexes', () => {
  assert.match(migration, /contest_finalists_contest_category_idx/i);
  assert.match(migration, /contest_result_entries_submission_idx/i);
  assert.match(migration, /contest_result_snapshots_category_idx/i);
  assert.match(migration, /create index if not exists/i);
});
