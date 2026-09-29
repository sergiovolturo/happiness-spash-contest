import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20260930000100_category_library.sql',import.meta.url),'utf8');
const index=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('category library preserves historical associations and backfills definitions',()=>{
  assert.match(migration,/create table if not exists public\.contest_category_definitions/i);
  assert.match(migration,/add column if not exists category_definition_id uuid/i);
  assert.match(migration,/insert into public\.contest_category_definitions[\s\S]*from public\.contest_categories/i);
  assert.match(migration,/foreign key \(category_definition_id\)[\s\S]*on delete restrict/i);
  assert.match(migration,/published_video_count bigint/i);
});

test('category library exposes admin-only CRUD and contest attachment RPCs',()=>{
  for(const fn of ['admin_list_category_definitions','admin_create_category_definition','admin_update_category_definition','admin_set_category_definition_active','admin_delete_unused_category_definition','admin_attach_category_to_contest','admin_update_contest_category_settings','admin_detach_category_from_contest'])assert.match(migration,new RegExp(`function public\\.${fn}`));
  assert.match(migration,/revoke execute on function public\.admin_list_category_definitions\(\) from public,anon,service_role/i);
  assert.match(migration,/revoke execute on function public\.category_definition_slug\(text\) from public,anon,authenticated,service_role/i);
  assert.match(migration,/grant execute on function public\.admin_attach_category_to_contest\(uuid,uuid,integer,integer,integer\) to authenticated/i);
  assert.match(migration,/is_active/);
});

test('category image storage is a public read bucket with admin-only mutation policies',()=>{
  assert.match(migration,/values\('category-images','category-images',true/i);
  assert.match(migration,/category_images_admin_insert/);
  assert.match(migration,/category_images_admin_update/);
  assert.match(migration,/category_images_admin_delete/);
  assert.match(migration,/exists\(select 1 from public\.admin_users where user_id=auth\.uid\(\)\)/);
});

test('active Admin runtime uses library categories instead of raw contest category creation',()=>{
  assert.match(index,/admin_list_category_definitions/);
  assert.match(index,/admin_attach_category_to_contest/);
  assert.match(index,/adminCategoryLibraryQuickLaunch/);
  assert.match(index,/Gestisci categorie/);
  assert.match(index,/id="adminAttachCategoryForm"/);
  const active=index.match(/const renderAdminContestSectionAuthoritative=[^\n]+/s)?.[0]||'';
  assert.doesNotMatch(active,/admin_create_contest_category/);
});

test('public category cards consume canonical image paths without exposing result counts during voting',()=>{
  assert.match(index,/categoryImageUrl/);
  assert.match(index,/category-images/);
  assert.match(index,/image_path/);
  assert.match(index,/publicCategoryCard/);
  assert.match(index,/voteControls\(row,category\)/);
  assert.match(migration,/get_public_contest_results/);
  assert.match(migration,/status='PUBLISHED'/i);
});
