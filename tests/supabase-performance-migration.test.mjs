import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261110100000_optimize_contest_rls_and_public_indexes.sql', import.meta.url),
  'utf8'
);

test('performance migration keeps RLS semantics while using statement-scoped auth.uid', () => {
  assert.match(migration, /alter policy/i);
  assert.match(migration, /replace\(p\.qual, 'auth\.uid\(\)', '\(select auth\.uid\(\)\)'\)/i);
  assert.match(migration, /replace\(p\.with_check, 'auth\.uid\(\)', '\(select auth\.uid\(\)\)'\)/i);
  assert.doesNotMatch(migration, /drop policy|disable row level security/i);
});

test('performance migration adds only targeted public/results indexes', () => {
  assert.match(migration, /contest_finalists_contest_category_idx/i);
  assert.match(migration, /contest_result_entries_submission_idx/i);
  assert.match(migration, /contest_result_snapshots_category_idx/i);
  assert.match(migration, /create index if not exists/i);
});
