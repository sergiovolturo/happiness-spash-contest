import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20261111090000_fix_remaining_rls_initplans.sql', import.meta.url),
  'utf8'
);

const policies = [
  ['contest_media_deletion_requests', 'contest_media_deletion_requests_admin_select'],
  ['contest_media_deletion_audit', 'contest_media_deletion_audit_admin_select'],
  ['contest_deletion_requests', 'contest_deletion_requests_admin_select'],
  ['contest_deletion_audit', 'contest_deletion_audit_admin_select']
];

test('remaining deletion-history RLS policies use explicit statement-scoped auth.uid', () => {
  for (const [table, policy] of policies) {
    assert.match(migration, new RegExp(`alter policy ${policy}\\s+on public\\.${table}`, 'i'));
  }
  assert.equal((migration.match(/\(select auth\.uid\(\)\)/gi) || []).length, 4);
  assert.doesNotMatch(migration, /pg_policies|for\s+\w+\s+in|replace\s*\(/i);
  assert.doesNotMatch(migration, /drop policy|disable row level security|grant |revoke /i);
});

test('the fix changes only the auth.uid evaluation strategy', () => {
  assert.equal((migration.match(/exists \(select 1 from public\.admin_users au/gi) || []).length, 4);
  assert.doesNotMatch(migration, /to anon|to authenticated|for select|with check/i);
});
