import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261005090000_post_voting_results_flow.sql', import.meta.url), 'utf8');
const scope = (rows, contestId, categoryId = null) => rows.filter(
  row => row.contest_id === contestId && (categoryId === null || row.category_id === categoryId),
);

const rows = [
  { contest_id: 'contest-a', category_id: 'volee', contestant_display_name: 'A', is_finalist: true },
  { contest_id: 'contest-b', category_id: 'volee', contestant_display_name: 'B', is_finalist: true },
  { contest_id: 'contest-b', category_id: 'smash', contestant_display_name: 'C', is_finalist: true },
];

test('results from Contest A never appear in Contest B', () => {
  assert.deepEqual(scope(rows, 'contest-b').map(row => row.contestant_display_name), ['B', 'C']);
  assert.match(index, /row\.contest_id===contestId/);
  assert.match(index, /publicContestResultRowsById/);
});

test('Contest TEST 2 renders only its own published finalists', () => {
  const finalists = scope(rows, 'contest-b').filter(row => row.is_finalist);
  assert.deepEqual(finalists.map(row => row.contestant_display_name), ['B', 'C']);
  assert.match(index, /data-public-finalists-contest/);
  assert.match(index, /publicOfficialFinalistsCompactMarkup\(contestId\)/);
});

test('a contest without published results renders no finalists block', () => {
  const publishedRows = [];
  assert.equal(publishedRows.filter(row => row.is_finalist).length, 0);
  assert.match(index, /if\(!rows\.length\)return ''/);
  assert.match(migration, /status='PUBLISHED' and rs\.invalidated_at is null/);
});

test('TOP VOLÉE gallery is scoped to the selected category and cannot show TOP SMASH', () => {
  assert.deepEqual(scope(rows, 'contest-b', 'volee').map(row => row.contestant_display_name), ['B']);
  assert.match(index, /row\.category_id===categoryId/);
  assert.match(index, /publicOfficialFinalistsCompactMarkup\(publicContest\.id,gallerySelectedCategoryId\)/);
  assert.match(index, /querySelectorAll\('\.publicCategoryGrid'\)/);
});

test('public finalist rendering exposes no votes, Top N, rank, cutoff or Admin preview data', () => {
  const publicFinalistFlow = index.slice(index.indexOf('const publicOfficialFinalistsCompactMarkup='), index.indexOf('const loadPublicContestSelectionScoped'));
  assert.doesNotMatch(publicFinalistFlow, /Voti:\s|Top\s+\d|vote_count|rank_position|cutoff|admin_preview_contest_results/i);
  const finalGalleryWrapper = index.slice(index.indexOf('const galleryViewWithScopedPrivacy'), index.indexOf('adminView=renderAdmin;', index.indexOf('const galleryViewWithScopedPrivacy')));
  assert.doesNotMatch(finalGalleryWrapper, /Voti:\s|Top\s+\d|vote_count|rank_position|cutoff|admin_preview_contest_results/i);
});

test('public result and category scoping are explicit in the final renderer', () => {
  assert.match(index, /rows\.filter\(row=>row\.contest_id===contestId&&\(categoryId===null\|\|row\.category_id===categoryId\)\)/);
  assert.match(index, /rows=galleryRows\.filter\(row=>row\.contest_id===publicContest\.id&&row\.category_id===category\.id\)/);
});
