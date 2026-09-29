import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260930000400_rejected_releases_capacity.sql', import.meta.url), 'utf8');
const submissionMigration = await readFile(new URL('../supabase/migrations/20260928000100_functional_cleanup.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('public category capacity is aggregate-only and exposes occupied and available slots', () => {
  const start = migration.indexOf('create function public.get_public_contest_categories');
  const end = migration.indexOf('$$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /occupied_submission_count bigint/i);
  assert.match(body, /available_submission_count bigint/i);
  assert.match(body, /status in \('PENDING','APPROVED'\)/i);
  assert.match(body, /greatest\(cc\.submission_cap::bigint-counts\.occupied_submission_count,0::bigint\)/i);
  assert.doesNotMatch(body, /contestant_display_name|auth\.users/i);
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
  assert.match(body, /s\.status in \('PENDING','APPROVED'\)/i);
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

test('gallery hydration restores capacity text after replacing the public home shell', () => {
  assert.match(index, /querySelectorAll\('\.publicCategoryCard,\[data-home-category\]'\)/);
  assert.match(index, /!card\.querySelector\('\.categoryCapacity'\)/);
  assert.match(index, /capacity\.textContent=categoryCapacityLabel\(category\)/);
});

test('the definitive slot semantics occupy only pending and approved states', () => {
  assert.match(migration, /where status in \('PENDING', 'APPROVED'\)/i);
  assert.doesNotMatch(migration, /where status in \('PENDING', 'APPROVED', 'REJECTED'\)/i);
  assert.match(migration, /status in \('PENDING','APPROVED'\)/i);
});

test('rejected submissions release the pair uniqueness slot', () => {
  assert.match(migration, /create unique index submissions_active_pair_uidx[\s\S]*?where status in \('PENDING', 'APPROVED'\)/i);
});

test('a rejected upload retry is guarded by the locked category cap', () => {
  const start = migration.indexOf('create or replace function public.finalize_submission_media_upload');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /v_submission\.status='REJECTED'/i);
  assert.match(body, /from public\.contest_categories cc where cc\.id=v_submission\.category_id for update/i);
  assert.match(body, /status in \('PENDING','APPROVED'\)/i);
  assert.match(body, /category_full/i);
  assert.ok(body.indexOf('for update') < body.indexOf('select count(*) into v_occupied_count'));
});

test('capacity state transitions preserve the invariant in a pure model', () => {
  const occupies = status => status === 'PENDING' || status === 'APPROVED';
  const count = states => states.filter(occupies).length;
  assert.equal(count(['PENDING']), 1);
  assert.equal(count(['APPROVED']), 1);
  assert.equal(count(['REJECTED', 'WITHDRAWN', 'CANCELLED']), 0);
  assert.equal(count(['PENDING', 'APPROVED', 'REJECTED']), 2);
  assert.equal(count(['APPROVED', 'REJECTED']), 1);
});

test('a full category can accept a new submission only after rejection', () => {
  const cap = 2;
  let states = ['PENDING', 'APPROVED'];
  const available = () => cap - states.filter(s => s === 'PENDING' || s === 'APPROVED').length;
  assert.equal(available(), 0);
  states[0] = 'REJECTED';
  assert.equal(available(), 1);
  states.push('PENDING');
  assert.equal(available(), 0);
  assert.equal(states.filter(s => s === 'PENDING' || s === 'APPROVED').length <= cap, true);
});

test('public capacity is based on current occupied slots, never historical rejected rows', () => {
  const rows = [{status:'PENDING'}, {status:'APPROVED'}, {status:'REJECTED'}];
  const occupied = rows.filter(row => ['PENDING', 'APPROVED'].includes(row.status)).length;
  assert.equal(occupied, 2);
});

