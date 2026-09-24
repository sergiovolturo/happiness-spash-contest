import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000506_public_contest_category_read_surface.sql', import.meta.url),
  'utf8',
);

test('public Contest RPC exposes only the non-DRAFT current read model', () => {
  assert.match(migration, /create or replace function public\.get_public_contest\(\)/i);
  assert.match(migration, /c\.status in \([\s\S]*'SUBMISSIONS_OPEN'::public\.contest_status[\s\S]*'CLOSED'::public\.contest_status/i);
  assert.match(migration, /order by c\.updated_at desc, c\.created_at desc/i);
  assert.match(migration, /limit 1/i);
  for (const field of ['id', 'slug', 'name', 'status', 'submissions_open_at', 'submissions_close_at', 'voting_open_at', 'voting_close_at']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, 'i'));
  }
  for (const field of ['description', 'configuration', 'configuration_version', 'created_by']) {
    assert.doesNotMatch(migration, new RegExp(`returns table[\\s\\S]*${field}`, 'i'));
  }
});

test('public category RPC returns only active categories for a visible Contest', () => {
  assert.match(migration, /create or replace function public\.get_public_contest_categories\(p_contest_id uuid\)/i);
  assert.match(migration, /cc\.is_active/i);
  assert.match(migration, /c\.status in \([\s\S]*'SUBMISSIONS_OPEN'::public\.contest_status[\s\S]*'CLOSED'::public\.contest_status/i);
  assert.match(migration, /cc\.contest_id = p_contest_id/i);
  assert.match(migration, /order by cc\.display_order, cc\.created_at/i);
  for (const field of ['id', 'contest_id', 'name', 'slug', 'display_order', 'submission_cap']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, 'i'));
  }
  assert.doesNotMatch(migration, /finalists_count/i);
});

test('read surface is read-only, hardened and explicitly granted', () => {
  assert.match(migration, /language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path to ''/i);
  assert.doesNotMatch(migration, /\b(insert|update|delete|merge|truncate)\s+into?\b/i);
  assert.match(migration, /revoke execute on function public\.get_public_contest\(\) from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.get_public_contest\(\) to anon, authenticated/i);
  assert.match(migration, /revoke execute on function public\.get_public_contest_categories\(uuid\) from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.get_public_contest_categories\(uuid\) to anon, authenticated/i);
});

test('underlying Contest/category tables remain administrative and no direct grants are added', () => {
  assert.match(migration, /revoke all on table public\.contests, public\.contest_categories from public, anon/i);
  assert.doesNotMatch(migration, /grant select on table public\.(contests|contest_categories)/i);
  assert.doesNotMatch(migration, /alter table public\.(contests|contest_categories)/i);
});

test('migration does not expose administrative category fields or later domains', () => {
  assert.doesNotMatch(migration, /finalists_count|configuration|submission_media|contest_votes|contest_finalists/i);
});
