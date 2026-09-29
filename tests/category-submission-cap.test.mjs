import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260930000300_category_submission_capacity.sql', import.meta.url), 'utf8');
const submissionMigration = await readFile(new URL('../supabase/migrations/20260928000100_functional_cleanup.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('public category capacity is aggregate-only and exposes occupied and available slots', () => {
  assert.match(migration, /occupied_submission_count bigint/i);
  assert.match(migration, /available_submission_count bigint/i);
  assert.match(migration, /status in \('PENDING','APPROVED','REJECTED'\)/i);
  assert.match(migration, /greatest\(cc\.submission_cap::bigint-counts\.occupied_submission_count,0::bigint\)/i);
  assert.doesNotMatch(migration, /contestant_display_name|participation_id|auth\.users/i);
});

test('public capacity RPC keeps the public ACL and security-definer boundary', () => {
  assert.match(migration, /language sql security definer set search_path=''/i);
  assert.match(migration, /revoke execute on function public\.get_public_contest_categories\(uuid\) from public,anon,service_role/i);
  assert.match(migration, /grant execute on function public\.get_public_contest_categories\(uuid\) to anon,authenticated/i);
});

test('cap reduction is rejected server-side after locking the category', () => {
  const start = migration.indexOf('create or replace function public.admin_update_contest_category(');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /from public\.contest_categories cc[\s\S]*for update/i);
  assert.match(body, /select count\(\*\) into v_occupied/i);
  assert.match(body, /s\.status in \('PENDING','APPROVED','REJECTED'\)/i);
  assert.match(body, /if p_submission_cap<v_occupied/i);
  assert.match(body, /category_cap_below_occupied/i);
});

test('the legacy settings RPC also protects the cap invariant', () => {
  const start = migration.indexOf('create or replace function public.admin_update_contest_category_settings(');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /for update/i);
  assert.match(body, /p_submission_cap<v_occupied/i);
  assert.match(body, /category_cap_below_occupied/i);
});

test('submission creation remains atomic under concurrent requests', () => {
  const start = submissionMigration.indexOf('create or replace function public.create_submission(');
  const end = submissionMigration.indexOf('$function$;', start);
  const body = submissionMigration.slice(start, end);
  const lock = body.indexOf('from public.contest_categories cc where cc.id=p_category_id for update');
  const count = body.indexOf('select count(*) into v_occupied_count');
  const insert = body.indexOf('insert into public.submissions');
  assert.ok(lock >= 0, 'category row must be the serialization point');
  assert.ok(count > lock, 'capacity must be counted after the category lock');
  assert.ok(insert > count, 'insert must happen after the capacity check');
  assert.match(body, /v_occupied_count >= v_category\.submission_cap/i);
});

test('Player exposes capacity and disables a full category without replacing backend enforcement', () => {
  assert.match(index, /categoryCapacityLabel/);
  assert.match(index, /available_submission_count/);
  assert.match(index, /Categoria completa/);
  assert.match(index, /create_submission/);
  assert.match(index, /category_full/);
});

test('public category cards show received candidature and available places', () => {
  assert.match(index, /candidature ricevute/);
  assert.match(index, /posti disponibili/);
  assert.match(index, /categoryCapacity/);
});

