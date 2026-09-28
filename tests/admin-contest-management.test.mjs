import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260922000520_admin_contest_management.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Admin Contest management is incremental, fail-closed and explicitly granted', () => {
  for (const fn of ['admin_list_contests', 'admin_create_contest', 'admin_update_contest', 'admin_delete_contest', 'admin_open_contest_submissions']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}`));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${fn}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}.*authenticated`, 's'));
  }
  assert.match(migration, /security definer set search_path = ''/i);
  assert.match(migration, /admin_required/);
  assert.match(migration, /status <> 'DRAFT'/);
  assert.match(migration, /contest_category_required/);
});

test('Admin Contest UI supports fresh Contest creation, selection and opening submissions', () => {
  assert.match(index, /rpc\('admin_list_contests'/);
  assert.match(index, /rpc\('admin_create_contest'/);
  assert.match(index, /rpc\('admin_update_contest'/);
  assert.match(index, /rpc\('admin_open_contest_submissions'/);
  assert.match(index, /Gestione Contest/);
});

test('Admin Contest creation is compact and lifecycle-aware', () => {
  assert.match(index, /adminNewContestToggle/);
  assert.match(index, /id="adminNewContestForm"/);
  assert.match(index, /hidden=!form\.hidden/);
  assert.match(index, /adminSubmissionWindowMessageAt/);
  assert.match(index, /Candidature programmate/);
  assert.match(index, /Periodo candidature terminato/);
});

test('Admin Contest creation keeps exactly one runtime toggle', () => {
  assert.match(index, /adminRemoveLegacyContestToggle/);
  assert.match(index, /querySelectorAll\('\.adminCreateToggle'\)/);
  const activeCreate = index.slice(index.indexOf('const adminBindOverviewCreate='), index.indexOf('const adminRenderAuthoritativeShell='));
  assert.equal((activeCreate.match(/id="adminNewContestToggle"/g) || []).length, 1);
  assert.equal((activeCreate.match(/type="button"[^>]*>\+ Crea nuovo Contest/g) || []).length, 1);
  assert.doesNotMatch(activeCreate, /adminCreateToggle/);
  assert.match(index, /adminBindOverviewCreate/);
  assert.match(index, /form\.hidden=!form\.hidden/);
});

test('Admin lifecycle copy is human-readable and readonly categories are compact', () => {
  assert.match(index, /const adminStatusLabel=\{VOTING_OPEN:'Votazione aperta'/);
  assert.match(index, /const adminStatusText=status=>adminStatusLabel\[status\]\|\|status/);
  assert.match(index, /adminReadableStatus/);
  assert.match(index, /adminOverviewMessage/);
  assert.match(index, /adminSubmissionWindowLabelAt/);
  assert.match(index, /Verifica readiness e apri votazione/);
});

