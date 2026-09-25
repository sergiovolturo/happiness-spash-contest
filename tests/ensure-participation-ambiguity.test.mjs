import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000515_fix_ensure_participation_ambiguity.sql', import.meta.url),
  'utf8',
);

test('participation resolver keeps its public contract and security boundary', () => {
  assert.match(migration, /create or replace function public\.ensure_contest_participation\(p_contest_id uuid\)/i);
  assert.match(migration, /returns table \([\s\S]*platform_identity_id uuid[\s\S]*contest_participation_id uuid[\s\S]*contest_id uuid/i);
  assert.match(migration, /security definer[\s\S]*set search_path to ''/i);
  assert.match(migration, /v_auth_user_id uuid := auth\.uid\(\)/i);
});

test('named constraints remove output-column ambiguity from both upserts', () => {
  assert.match(migration, /insert into public\.platform_identities as pi \(auth_user_id\)/i);
  assert.match(migration, /on conflict on constraint platform_identities_auth_user_id_key do update/i);
  assert.match(migration, /returning pi\.id into v_identity_id/i);
  assert.match(migration, /insert into public\.contest_participations as cp \(contest_id, identity_id\)/i);
  assert.match(migration, /on conflict on constraint contest_participations_contest_id_identity_id_key do update/i);
  assert.match(migration, /returning cp\.id into v_participation_id/i);
  assert.doesNotMatch(migration, /on conflict \(contest_id, identity_id\)/i);
});

test('idempotent behavior and explicit ACL remain unchanged', () => {
  assert.match(migration, /do update[\s\S]*set updated_at = now\(\)/i);
  assert.match(migration, /return query[\s\S]*select v_identity_id, v_participation_id, p_contest_id/i);
  assert.match(migration, /revoke execute on function public\.ensure_contest_participation\(uuid\)[\s\S]*from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.ensure_contest_participation\(uuid\)[\s\S]*to authenticated/i);
});

test('fix does not alter tables, RLS or unrelated domain objects', () => {
  assert.doesNotMatch(migration, /create table|alter table|create policy|drop policy|public\.profiles|public\.submissions/i);
});
