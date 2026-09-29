import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260928152839_public_active_contest_selection.sql', import.meta.url), 'utf8');

test('public resolver excludes DRAFT and historical closed Contest rows', () => {
  assert.match(migration, /where c\.status in \([\s\S]*'SUBMISSIONS_OPEN'[\s\S]*'VOTING_OPEN'/i);
  assert.doesNotMatch(migration, /'VOTING_CLOSED'::public\.contest_status/);
  assert.doesNotMatch(migration, /'CLOSED'::public\.contest_status/);
  assert.match(migration, /limit 1/i);
});

test('public resolver prioritizes active voting and returns no row when none is active', () => {
  assert.match(migration, /when 'VOTING_OPEN'::public\.contest_status then 1/i);
  assert.match(migration, /when 'READY_FOR_VOTING'::public\.contest_status then 2/i);
  assert.match(migration, /when 'SUBMISSIONS_OPEN'::public\.contest_status then 4/i);
  assert.match(migration, /from public\.contests c[\s\S]*where c\.status in/i);
});

test('Admin selection is independent from publicContest and preserves valid prior selection', () => {
  assert.match(index, /const selectAdminContestId=\(rows,currentId\)=>rows\.some\(c=>c\.id===currentId\)\?currentId:\(rows\[0\]\?\.id\|\|null\)/);
  assert.doesNotMatch(index, /adminSelectedContestId=publicContest\?\.id\|\|adminContestRows/);
  const start = index.indexOf('const selectAdminContestId=');
  const end = index.indexOf(';', start) + 1;
  const selectAdminContestId = new Function(index.slice(start, end) + ';return selectAdminContestId;')();
  const rows = [{id:'draft'}, {id:'closed'}];
  assert.equal(selectAdminContestId(rows, null), 'draft');
  assert.equal(selectAdminContestId(rows, 'closed'), 'closed');
  assert.equal(selectAdminContestId(rows, 'missing'), 'draft');
});

test('Admin selection explicitly loads the selected Contest categories', () => {
  assert.match(index, /const selected=adminContestRows\.find/);
  assert.match(index, /adminSelectedContest=selected/);
  assert.match(index, /admin_list_contest_categories',\{p_contest_id:selected\.id\}/);
});

test('RESULTS renders from an empty view without legacy configuration surfaces', () => {
  const active=index.slice(index.indexOf('async function renderAdmin('));
  const results=index.slice(index.indexOf('const renderAdminResultsSectionAuthoritative='),index.indexOf('const adminRenderAuthoritativeShell='));
  assert.match(active, /view\.innerHTML=''/);
  assert.match(active, /adminSection==='results'.*renderAdminResultsSectionAuthoritative/);
  assert.match(results, /renderAdminResults\(view\)/);
  assert.doesNotMatch(results, /adminManualSubmission|adminCurrentContestConfiguration|adminContestSurfaceLegacyFinal|adminRemoveLegacyComposition/);
});

test('Global manager, timeline, results and audit remain present', () => {
  assert.match(index, /adminGlobalContestManager/);
  assert.match(index, /adminLifecycleTimeline/);
  assert.match(index, /class="card adminResults"/);
  assert.match(index, /class="adminAudit"/);
  assert.match(index, /Nuovo Contest|Crea Contest/);
});

