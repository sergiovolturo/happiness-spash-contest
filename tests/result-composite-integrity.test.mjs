import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL(
  '../supabase/migrations/20261009150000_harden_result_composite_integrity.sql',
  import.meta.url,
), 'utf8');

test('snapshot integrity validates Contest and category together', () => {
  assert.match(migration, /create or replace function public\._validate_result_snapshot_integrity/);
  assert.match(migration, /select cc\.contest_id[\s\S]*where cc\.id = new\.category_id/);
  assert.match(migration, /v_category_contest_id is distinct from new\.contest_id/);
  assert.match(migration, /contest_result_snapshots_integrity_trg/);
});

test('submission integrity validates category and participation Contest', () => {
  assert.match(migration, /create or replace function public\._validate_submission_contest_category_integrity/);
  assert.match(migration, /where cp\.id = new\.participation_id/);
  assert.match(migration, /v_category_contest_id is distinct from v_participation_contest_id/);
  assert.match(migration, /submissions_contest_category_integrity_trg/);
});

test('result entries validate snapshot Contest/category and submission identity', () => {
  assert.match(migration, /where rs\.id = new\.snapshot_id/);
  assert.match(migration, /where s\.id = new\.submission_id/);
  assert.match(migration, /v_submission_category_id is distinct from v_snapshot_category_id/);
  assert.match(migration, /v_submission_contest_id is distinct from v_snapshot_contest_id/);
  assert.match(migration, /contest_result_entries_integrity_trg/);
});

test('hardening does not add duplicate columns, backfill data, or change RPC signatures', () => {
  assert.doesNotMatch(migration, /alter table public\.(contests|contest_categories|submissions|contest_result_snapshots|contest_result_entries)[\s\S]*add column/i);
  assert.doesNotMatch(migration, /update public\.|insert into public\.|delete from public\./i);
  assert.doesNotMatch(migration, /create or replace function public\.(freeze_contest_results|resolve_contest_result_tie|confirm_contest_finalists|publish_contest_finalists|get_public_contest_results|get_public_archive_contest_results)/i);
});

test('trigger validators retain a locked search path and no client EXECUTE grant', () => {
  assert.equal((migration.match(/set search_path = ''/g) || []).length, 5);
  assert.match(migration, /revoke all on function public\._validate_result_snapshot_integrity\(\) from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\._validate_submission_contest_category_integrity\(\) from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\._validate_result_entry_integrity\(\) from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\._validate_participation_contest_integrity\(\) from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\._validate_category_contest_integrity\(\) from public, anon, authenticated, service_role/);
});

test('parent updates cannot invalidate existing child relationships', () => {
  assert.match(migration, /before update of contest_id[\s\S]*on public\.contest_participations/);
  assert.match(migration, /s\.participation_id = new\.id[\s\S]*cc\.contest_id is distinct from new\.contest_id/);
  assert.match(migration, /before update of contest_id[\s\S]*on public\.contest_categories/);
  assert.match(migration, /s\.category_id = new\.id[\s\S]*cp\.contest_id is distinct from new\.contest_id/);
  assert.match(migration, /rs\.category_id = new\.id[\s\S]*rs\.contest_id is distinct from new\.contest_id/);
});

test('integrity validators use row-level locks for concurrent parent and child changes', () => {
  assert.equal((migration.match(/for update/g) || []).length, 7);
  assert.match(migration, /where cc\.id = new\.category_id\s+for update/);
  assert.match(migration, /where cp\.id = new\.participation_id\s+for update/);
  assert.match(migration, /where rs\.id = new\.snapshot_id\s+for update/);
  assert.match(migration, /where s\.id = new\.submission_id\s+for update of s/);
  assert.match(migration, /order by cc\.id\s+for update of cc/);
  assert.match(migration, /order by cp\.id\s+for update of cp/);
});
