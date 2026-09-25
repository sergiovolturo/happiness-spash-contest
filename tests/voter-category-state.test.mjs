import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000512_voter_category_state.sql', import.meta.url),
  'utf8',
);

test('RPC exposes only category_id for the authenticated voter', () => {
  assert.match(migration, /create or replace function public\.get_my_voted_categories\(p_contest_id uuid\)/i);
  assert.match(migration, /returns table\(category_id uuid\)/i);
  const output = migration.slice(migration.indexOf('returns table'), migration.indexOf('language plpgsql'));
  assert.doesNotMatch(output, /submission_id|vote_id|email_hash|voter_identity_id|count\s*\(/i);
  assert.match(migration, /select distinct cv\.category_id/i);
});

test('RPC requires the current Auth identity and does not create state', () => {
  assert.match(migration, /v_auth_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /authentication_required/i);
  assert.doesNotMatch(migration, /insert into|update public\.|delete from/i);
});

test('RPC resolves only verified voter identity and the requested Contest', () => {
  assert.match(migration, /join public\.verified_voter_identities/i);
  assert.match(migration, /vvi\.auth_user_id = v_auth_user_id/i);
  assert.match(migration, /vvi\.status = 'VERIFIED'/i);
  assert.match(migration, /join public\.contest_categories/i);
  assert.match(migration, /cc\.contest_id = p_contest_id/i);
  assert.match(migration, /select distinct cv\.category_id/i);
});

test('RPC is explicitly read-only and minimally executable', () => {
  assert.match(migration, /language plpgsql/i);
  assert.match(migration, /stable/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path to ''/i);
  assert.match(migration, /revoke all on function public\.get_my_voted_categories\(uuid\)\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.get_my_voted_categories\(uuid\)\s+to authenticated/i);
});

test('RPC has no direct table grants or legacy vote dependency', () => {
  assert.doesNotMatch(migration, /grant select on table/i);
  assert.doesNotMatch(migration, /public\.votes/i);
  assert.doesNotMatch(migration, /contest_votes[^\n]*select\s+\*/i);
});
