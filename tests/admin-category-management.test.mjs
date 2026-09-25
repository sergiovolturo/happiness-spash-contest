import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260922000516_admin_category_management.sql', import.meta.url), 'utf8');
const reorderFix = await readFile(new URL('../supabase/migrations/20260922000518_fix_category_reorder_constraint_resolution.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('category management exposes explicit Admin-only RPC grants', () => {
  for (const [name, signature] of [
    ['admin_create_contest_category', 'uuid, text, text, integer, integer'],
    ['admin_update_contest_category', 'uuid, text, text, integer, integer, boolean'],
    ['admin_reorder_contest_categories', 'uuid, uuid[]'],
    ['admin_delete_contest_category', 'uuid'],
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) from public, anon, service_role`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to authenticated`, 'i'));
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/i);
});

test('category mutations check Admin identity and use an empty search path', () => {
  for (const name of ['admin_create_contest_category', 'admin_update_contest_category', 'admin_reorder_contest_categories', 'admin_delete_contest_category']) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    const end = migration.indexOf('$function$;', start);
    const body = migration.slice(start, end);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path\s*=\s*''/i);
    assert.match(body, /public\.admin_users/);
    assert.match(body, /admin_required/);
  }
});

test('category order is complete, unique and transactionally deferrable', () => {
  assert.match(migration, /unique\s*\(contest_id, display_order\)\s*deferrable initially deferred/i);
  assert.match(reorderFix, /set constraints public\.contest_categories_contest_display_order_key deferred/i);
  assert.match(reorderFix, /set search_path\s*=\s*''/i);
  assert.match(migration, /cardinality\(p_category_ids\) <> v_count/i);
  assert.match(migration, /count\(distinct x\.id\)/i);
  assert.match(migration, /with ordinality/i);
});

test('category cap, finalist snapshots, publication and historical delete are protected', () => {
  assert.match(migration, /category_cap_below_occupied/);
  assert.match(migration, /p_submission_cap < v_occupied/);
  assert.match(migration, /finalists_count_frozen/);
  assert.match(migration, /public\.contest_result_snapshots/);
  assert.match(migration, /category_has_active_publications/);
  assert.match(migration, /category_has_history/);
  assert.match(migration, /public\.submissions s where s\.category_id = p_category_id/);
});

test('Admin UI supports dynamic categories and hides Player tab from Admin navigation', () => {
  assert.match(index, /function nav\(\)\{const tabs=isAdmin\?\[\['home','Contest'\],\['admin','Amministra'\]\]/);
  assert.match(index, /admin_create_contest_category/);
  assert.match(index, /admin_update_contest_category/);
  assert.match(index, /admin_reorder_contest_categories/);
  assert.match(index, /admin_delete_contest_category/);
  assert.match(index, /adminCategoryRows|adminCategoryManager/);
});

test('Admin category mutations refresh the public Contest/category read surface', () => {
  assert.match(index, /refresh=async\(\)=>\{await loadAdminContests\(\);const selected=adminContestRows\.find\(c=>c\.id===adminSelectedContestId\);if\(selected\)await selectAdminContest\(selected\);else await adminView\(\)\}/);
});
