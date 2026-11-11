import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migration=await readFile(new URL('../supabase/migrations/20261111101419_guard_category_definition_renames.sql',import.meta.url),'utf8');

test('category definition image updates are global-library safe and preserve Admin authorization',()=>{
  assert.match(migration,/create or replace function public\.admin_update_category_definition\(p_definition_id uuid,p_name text,p_image_path text default null\)/i);
  assert.match(migration,/exists\(select 1 from public\.admin_users where user_id=auth\.uid\(\)\)/i);
  assert.match(migration,/update public\.contest_category_definitions[\s\S]*image_path=nullif\(btrim\(p_image_path\),''\)/i);
  assert.match(migration,/update public\.contest_categories[\s\S]*where category_definition_id=d\.id/i);
  assert.doesNotMatch(migration,/category_definition_not_test_contest|9a01c0d3-67fd-452e-9ea4-7094f88dbd16/i);
});

test('category definition image update keeps the existing validation and security shape',()=>{
  assert.match(migration,/category_name_required/);
  assert.match(migration,/category_slug_exists/);
  assert.match(migration,/category_definition_not_found/);
  assert.match(migration,/security definer/i);
  assert.match(migration,/set search_path=''/i);
  assert.doesNotMatch(migration,/grant execute|revoke execute|drop function|alter table|delete from/i);
});

test('image-only updates skip contest-category writes while renames guard closed contests',()=>{
  assert.match(migration,/identity_changed:=d\.name is distinct from canonical_name or d\.slug is distinct from s/i);
  assert.match(migration,/if identity_changed then[\s\S]*update public\.contest_categories/i);
  assert.match(migration,/category_definition_rename_not_allowed/);
  assert.match(migration,/c\.status='DRAFT'[\s\S]*c\.status='SUBMISSIONS_OPEN'[\s\S]*c\.submissions_open_at is not null[\s\S]*now\(\)<c\.submissions_open_at/i);
});

test('the lifecycle fix does not weaken the existing category configuration guard',()=>{
  assert.doesNotMatch(migration,/disable trigger|disable row level security|_guard_contest_category_configuration\(\)\s*returns/i);
  assert.match(migration,/security definer/i);
  assert.match(migration,/exists\(select 1 from public\.admin_users where user_id=auth\.uid\(\)\)/i);
});
