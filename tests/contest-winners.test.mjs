import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20261008094007_contest_winners.sql', import.meta.url),
  'utf8'
);
const finalistMigration = await readFile(
  new URL('../supabase/migrations/20260922000500_step5_voting.sql', import.meta.url),
  'utf8'
);

test('winner model is dedicated and unique per Contest/category', () => {
  assert.match(migration, /create table public\.contest_winners/i);
  assert.match(migration, /unique \(contest_id, category_id\)/i);
  assert.match(migration, /contest_winners_contest_category_idx/i);
});

test('categories default to requiring a winner without changing historical rows', () => {
  assert.match(migration, /alter table public\.contest_categories[\s\S]*add column if not exists winner_required boolean not null default true/i);
});

test('winner explicitly references the finalist and its Contest/category/submission', () => {
  assert.match(migration, /contest_winners_finalist_fk[\s\S]*foreign key \(finalist_id, contest_id, category_id, submission_id\)[\s\S]*references public\.contest_finalists \(id, contest_id, category_id, submission_id\)/i);
  assert.match(migration, /contest_finalists_identity_unique[\s\S]*unique \(id, contest_id, category_id, submission_id\)/i);
});

test('Admin RPC validates a published official finalist and exact Contest/category/submission scope', () => {
  assert.match(migration, /create or replace function public\.admin_select_contest_winner\(\s*p_contest_id uuid,\s*p_category_id uuid,\s*p_submission_id uuid\s*\)/i);
  assert.match(migration, /cf\.contest_id = p_contest_id/i);
  assert.match(migration, /cf\.category_id = p_category_id/i);
  assert.match(migration, /cf\.submission_id = p_submission_id/i);
  assert.match(migration, /crs\.status = 'PUBLISHED'/i);
  assert.match(migration, /s\.category_id = p_category_id/i);
  assert.match(migration, /submission_not_published_finalist/i);
});

test('winner replacement is allowed before archive and rejected after archive or archive lock', () => {
  assert.match(migration, /v_contest\.archived_at is not null[\s\S]*contest_archived/i);
  assert.match(migration, /v_contest\.deletion_locked_at is not null[\s\S]*contest_archive_locked/i);
  assert.match(migration, /on conflict \(contest_id, category_id\) do update/i);
});

test('winner RPC is Admin-only and the table is not directly writable', () => {
  assert.match(migration, /exists \(\s*select 1 from public\.admin_users au[\s\S]*au\.user_id = v_auth_user_id/i);
  assert.match(migration, /revoke all on table public\.contest_winners from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select on table public\.contest_winners to authenticated/i);
  assert.match(migration, /revoke execute on function public\.admin_select_contest_winner\(uuid, uuid, uuid\)\s+from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.admin_select_contest_winner\(uuid, uuid, uuid\)\s+to authenticated/i);
});

test('existing finalist publication RPCs remain untouched by the winner migration', () => {
  assert.match(finalistMigration, /create or replace function public\.freeze_contest_results/i);
  assert.match(finalistMigration, /create or replace function public\.confirm_contest_finalists/i);
  assert.match(finalistMigration, /create or replace function public\.publish_contest_finalists/i);
  assert.doesNotMatch(migration, /freeze_contest_results|resolve_contest_result_tie|confirm_contest_finalists|publish_contest_finalists/i);
});
