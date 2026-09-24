import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const adminResults = index.slice(index.indexOf('const resultErrorLabel'), index.indexOf('async function adminView'));
const migration = await readFile(new URL('../supabase/migrations/20260922000500_step5_voting.sql', import.meta.url), 'utf8');

test('Admin results reads backend snapshots and entries', () => {
  assert.match(adminResults, /contest_result_snapshots/);
  assert.match(adminResults, /contest_result_entries/);
  assert.match(adminResults, /vote_count/);
});
test('close voting uses the approved RPC', () => assert.match(adminResults, /rpc\('close_contest_voting'/));
test('freeze results uses the approved RPC', () => assert.match(adminResults, /rpc\('freeze_contest_results'/));
test('close and freeze are Admin surface only', () => assert.match(index, /if\(!isAdmin\|\|!session\)return view\.innerHTML/));
test('ranking is rendered from backend rank and counts', () => {
  assert.match(adminResults, /e\.rank_position/);
  assert.match(adminResults, /e\.vote_count/);
  assert.doesNotMatch(adminResults, /reduce\(|sort\([^)]*vote|count\(/i);
});
test('finalists_count is read per category', () => assert.match(adminResults, /finalists_count/));
test('cutoff ties are shown and block confirmation', () => {
  assert.match(adminResults, /tie_requires_decision|is_cutoff_tie/);
  assert.match(adminResults, /!tie/);
});
test('confirm finalists uses the backend RPC', () => assert.match(adminResults, /rpc\('confirm_contest_finalists'/));
test('publish finalists uses the backend RPC', () => assert.match(adminResults, /rpc\('publish_contest_finalists'/));
test('fraudulent vote deletion uses the backend RPC with a reason', () => {
  assert.match(adminResults, /delete_contest_vote/);
  assert.match(adminResults, /p_deletion_reason:reason\.trim\(\)/);
});
test('deletion audit is displayed to Admin only', () => {
  assert.match(adminResults, /vote_deletion_audits/);
  assert.match(adminResults, /deleted_by_auth_user_id/);
});
test('public frontend has no results surface', () => {
  const gallery = index.slice(index.indexOf('// Public gallery flow starts here'), index.indexOf('// New participant domain flow'));
  assert.doesNotMatch(gallery, /contest_result_snapshots|contest_result_entries|vote_count|ranking/i);
});
test('legacy votes are not used by Admin results', () => assert.doesNotMatch(adminResults, /public\.votes|from\(['"]votes['"]\)/i));
test('tie resolution is not invented client-side', () => {
  assert.doesNotMatch(adminResults, /update.*contest_result_entries|insert.*contest_result_entries|random\(|Math\.random/si);
  assert.match(migration, /message = 'tie_requires_decision'/i);
});
test('backend exposes all required Admin RPCs', () => {
  for (const name of ['close_contest_voting', 'freeze_contest_results', 'confirm_contest_finalists', 'publish_contest_finalists', 'delete_contest_vote']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  }
});
test('Admin actions refresh Contest/results state', () => assert.match(adminResults, /await loadPublicContest\(\);await adminView\(\)/));
test('no public ranking/counts are introduced', () => {
  const publicFlow = index.slice(index.indexOf('// Public gallery flow starts here'), index.indexOf('// New participant domain flow'));
  assert.doesNotMatch(publicFlow, /vote_count|ranking|classifica|percentuale/i);
});
test('tie UI shows the backend tie group and remaining finalist slots', () => {
  assert.match(adminResults, /tieEntries=entries\.filter\(e=>e\.is_cutoff_tie\)/);
  assert.match(adminResults, /slotsRemaining=category\.finalists_count-safeCount/);
  assert.match(adminResults, /data-tie-selection/);
});
test('tie selection enforces an exact count before RPC', () => {
  assert.match(adminResults, /selected\.length!==slots/);
  assert.match(adminResults, /button\.disabled=selected\.length!==slots/);
  assert.match(adminResults, /resolve_contest_result_tie/);
});
test('tie resolution can be replaced before confirmation and refreshes state', () => {
  assert.match(adminResults, /Sostituisci decisione tie/);
  assert.match(adminResults, /await loadPublicContest\(\);await adminView\(\)/);
});
test('confirm is enabled only after a resolved tie', () => assert.match(adminResults, /\(!tie\|\|resolved\)/));
test('concurrent tie resolution and finalist actions are guarded', () => {
  assert.match(adminResults, /resolve-tie:/);
  assert.match(adminResults, /confirm-finalists:/);
  assert.match(adminResults, /publish-finalists:/);
});
test('invalidated snapshots are excluded and require a new freeze', () => {
  assert.match(adminResults, /invalidated_at,invalidation_reason/);
  assert.match(adminResults, /category_id===category\.id&&!s\.invalidated_at/);
  assert.match(adminResults, /Risultati invalidati dopo una modifica ai voti/);
  assert.match(adminResults, /Esegui un nuovo freeze/);
});
test('finalized vote deletion is mapped without local state mutation', () => {
  assert.match(adminResults, /result_already_finalized/);
  assert.match(adminResults, /Il risultato è già confermato o pubblicato/);
});
test('stale Admin results cannot repopulate after logout or session change', () => {
  assert.match(adminResults, /adminResultsRequestSeq/);
  assert.match(adminResults, /requestId!==adminResultsRequestSeq/);
  assert.match(index, /adminResultsRequestSeq\+\+;galleryRequestSeq\+\+/);
});
