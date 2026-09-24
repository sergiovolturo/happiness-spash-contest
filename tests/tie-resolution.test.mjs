import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000513_tie_resolution.sql', import.meta.url),
  'utf8',
);

test('tie decisions are append-only and audited', () => {
  assert.match(migration, /create table public\.contest_tie_resolutions/i);
  assert.match(migration, /snapshot_id[\s\S]*contest_id[\s\S]*category_id/i);
  assert.match(migration, /tie_submission_ids uuid\[\][\s\S]*selected_submission_ids uuid\[\]/i);
  assert.match(migration, /decided_by_auth_user_id[\s\S]*decided_at/i);
  assert.doesNotMatch(migration, /update public\.contest_tie_resolutions|delete from public\.contest_tie_resolutions/i);
});
test('resolution is Admin-only and locked to the snapshot', () => {
  assert.match(migration, /admin_required/i);
  assert.match(migration, /from public\.contest_result_snapshots[\s\S]*for update/i);
  assert.match(migration, /v_snapshot\.status <> 'TIE_REQUIRES_DECISION'/i);
});
test('tie group and remaining slots are calculated server-side', () => {
  assert.match(migration, /is_cutoff_tie/i);
  assert.match(migration, /v_required_count := v_snapshot\.finalists_count - v_safe_count/i);
  assert.match(migration, /invalid_tie_selection_count/i);
});
test('selection must be unique and entirely inside the tie', () => {
  assert.match(migration, /duplicate_tie_selection/i);
  assert.match(migration, /submission_not_in_tie/i);
  assert.match(migration, /selected_id = any\(v_tie_ids\)/i);
});
test('confirm remains blocked without resolution and uses selected tie entries', () => {
  assert.match(migration, /message = 'tie_requires_decision'/i);
  assert.match(migration, /unnest\(v_resolution\.selected_submission_ids\)/i);
  assert.match(migration, /e\.rank_position < v_cutoff_rank/i);
});
test('confirm preserves finalist count and ranking values', () => {
  assert.match(migration, /invalid_finalist_count/i);
  assert.doesNotMatch(migration, /update public\.contest_result_entries|set vote_count|set rank_position/i);
});
test('explicit ACLs do not rely on defaults', () => {
  assert.match(migration, /revoke all on table public\.contest_tie_resolutions from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select on table public\.contest_tie_resolutions to authenticated/i);
  assert.match(migration, /revoke execute on function public\.resolve_contest_result_tie\(uuid, uuid\[\], text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.resolve_contest_result_tie\(uuid, uuid\[\], text\)[\s\S]*to authenticated/i);
});
test('security definer functions use an empty search path', () => {
  assert.match(migration, /security definer[\s\S]*set search_path to ''/i);
});
