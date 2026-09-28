import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration=await readFile(new URL('../supabase/migrations/20260928191324_fix_admin_list_contests.sql',import.meta.url),'utf8');

test('admin_list_contests expands the contests composite row with c.*',()=>{
  assert.match(migration,/return query\s+select c\.\*\s+from public\.contests c\s+order by \(c\.archived_at is not null\), c\.created_at desc, c\.id desc;/);
  assert.doesNotMatch(migration,/return query\s+select c\s+from public\.contests/);
});

test('admin_list_contests preserves Admin security and least-privilege ACL',()=>{
  assert.match(migration,/returns setof public\.contests/);
  assert.match(migration,/security definer set search_path=''/);
  assert.match(migration,/auth\.uid\(\).*admin_users/s);
  assert.match(migration,/revoke execute on function public\.admin_list_contests\(\) from public, anon, service_role/);
  assert.match(migration,/grant execute on function public\.admin_list_contests\(\) to authenticated/);
});
