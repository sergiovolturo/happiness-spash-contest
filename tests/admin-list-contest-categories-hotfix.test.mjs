import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration=await readFile(new URL('../supabase/migrations/20260928192044_fix_admin_list_contest_categories.sql',import.meta.url),'utf8');

test('admin_list_contest_categories expands the composite row with cc.*',()=>{
  assert.match(migration,/return query\s+select cc\.\*\s+from public\.contest_categories cc\s+where cc\.contest_id=p_contest_id\s+order by cc\.display_order,cc\.id;/);
  assert.doesNotMatch(migration,/return query\s+select cc\s+from public\.contest_categories/);
});

test('admin_list_contest_categories preserves Admin security, Contest isolation and ACL',()=>{
  assert.match(migration,/returns setof public\.contest_categories/);
  assert.match(migration,/security definer set search_path=''/);
  assert.match(migration,/auth\.uid\(\).*admin_users/s);
  assert.match(migration,/where cc\.contest_id=p_contest_id/);
  assert.match(migration,/revoke execute on function public\.admin_list_contest_categories\(uuid\) from public, anon, service_role/);
  assert.match(migration,/grant execute on function public\.admin_list_contest_categories\(uuid\) to authenticated/);
});

test('the current rowtype audit has no other live alias-only return-query cases',async()=>{
  const source=await readFile(new URL('../supabase/migrations/20260928191324_fix_admin_list_contests.sql',import.meta.url),'utf8');
  assert.match(source,/select c\.\*/);
  assert.doesNotMatch(source,/select c\s+from public\.contests/);
});
