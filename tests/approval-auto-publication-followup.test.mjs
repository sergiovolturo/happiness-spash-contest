import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260930000600_fix_approval_status_enum.sql', import.meta.url),
  'utf8',
);

test('moderation compares deployed contest status enums without invalid enum casts', () => {
  assert.match(migration, /v_contest\.status::text in/i);
  assert.match(migration, /approved_submission_in_competition/i);
  assert.doesNotMatch(migration, /v_contest\.status in \([\s\S]*FROZEN/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path to ''/i);
});
