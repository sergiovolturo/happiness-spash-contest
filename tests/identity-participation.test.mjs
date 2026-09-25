import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000507_ensure_contest_participation.sql', import.meta.url),
  'utf8',
);

test('identity/participation resolution derives ownership from auth.uid()', () => {
  assert.match(migration, /create or replace function public\.ensure_contest_participation\(p_contest_id uuid\)/i);
  assert.match(migration, /v_auth_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /if v_auth_user_id is null[\s\S]*message = 'unauthorized'/i);
  assert.match(migration, /insert into public\.platform_identities \(auth_user_id\)[\s\S]*values \(v_auth_user_id\)/i);
  assert.doesNotMatch(migration, /p_auth_user_id|p_identity_id|p_user_id/i);
});

test('RPC reuses Step 1 unique constraints with idempotent upserts', () => {
  assert.match(migration, /on conflict \(auth_user_id\) do update/i);
  assert.match(migration, /on conflict \(contest_id, identity_id\) do update/i);
  assert.match(migration, /returning id into v_identity_id/i);
  assert.match(migration, /returning id into v_participation_id/i);
  assert.match(migration, /returns table \([\s\S]*platform_identity_id uuid[\s\S]*contest_participation_id uuid[\s\S]*contest_id uuid/i);
});

test('Contest validation is existence-only and introduces no new lifecycle rule', () => {
  assert.match(migration, /from public\.contests c[\s\S]*where c\.id = p_contest_id/i);
  assert.match(migration, /message = 'contest_not_found'/i);
  assert.doesNotMatch(migration, /SUBMISSIONS_OPEN|DRAFT|VOTING_OPEN|status\s*=/i);
});

test('RPC does not create roles, submissions or unrelated records', () => {
  assert.doesNotMatch(migration, /admin_users|submissions|contest_categories|votes|verified_voter/i);
  assert.doesNotMatch(migration, /create\s+role|set\s+role|grant\s+.*admin/i);
});

test('RPC is SECURITY DEFINER with an empty search_path and explicit ACL', () => {
  assert.match(migration, /language plpgsql[\s\S]*security definer[\s\S]*set search_path to ''/i);
  assert.match(migration, /revoke execute on function public\.ensure_contest_participation\(uuid\)[\s\S]*from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.ensure_contest_participation\(uuid\)[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute .*anon|grant execute .*service_role/i);
});

test('Migration is incremental and does not alter Step 1 tables or policies', () => {
  assert.doesNotMatch(migration, /create table|alter table|drop table|create policy|drop policy/i);
  assert.doesNotMatch(migration, /public\.platform_identities[\s\S]*on delete/i);
});
