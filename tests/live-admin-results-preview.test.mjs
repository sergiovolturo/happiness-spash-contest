import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('live Admin preview renders the pre-freeze summary from two preview rows', () => {
  const nameStart = index.indexOf('adminPreFreezeSummaryHtml=');
  const start = index.lastIndexOf('const ', nameStart);
  const end = index.indexOf('\r\n renderAdminResults=async function', start);
  assert.ok(start >= 0 && end > start, 'pre-freeze summary helper must be present');
  const helper = Function('esc', `${index.slice(start, end)}; return adminPreFreezeSummaryHtml;`)(value => String(value));
  const html = helper({
    categories: [
      { id: 'volée', name: 'TOP VOLÉE', finalists_count: 4 },
      { id: 'smash', name: 'TOP SMASH', finalists_count: 4 },
    ],
    preview: [
      { category_id: 'volée', contestant_display_name: 'Matteo Volturo', vote_count: 2, rank_position: 1, is_finalist_candidate: true, is_cutoff_tie: false },
      { category_id: 'smash', contestant_display_name: 'Matteo Volturo', vote_count: 4, rank_position: 1, is_finalist_candidate: true, is_cutoff_tie: false },
    ],
  });
  for (const text of ['Riepilogo prima del congelamento', 'Candidati eleggibili: 1', 'Voti totali: 2', 'Voti totali: 4', 'Finalisti previsti: 4', 'Matteo Volturo', '2 voti', '4 voti']) assert.match(html, new RegExp(text));
});

test('Admin preview is fetched once and remains read-only before freeze', () => {
  assert.equal((index.match(/rpc\('admin_preview_contest_results'/g) || []).length, 1);
  const wrapper = index.slice(index.indexOf('const renderAdminResultsWithoutPreview='), index.indexOf('const homeViewWithPublishedFinalists='));
  assert.match(wrapper, /adminResultsLoadedData=null/);
  assert.match(wrapper, /adminPreFreezeSummaryHtml\(data\)/);
  assert.match(wrapper, /Congelando i risultati verrà creato lo snapshot ufficiale/);
  assert.match(wrapper, /Anteprima riservata agli Admin; non crea snapshot né finalisti/);
  assert.doesNotMatch(wrapper, /rpc\(['"](?:freeze_contest_results|confirm_contest_finalists|publish_contest_finalists)/);
});

test('preview rows remain Admin-only and are not added to public results', () => {
  const wrapper = index.slice(index.indexOf('const renderAdminResultsWithoutPreview='), index.indexOf('const homeViewWithPublishedFinalists='));
  assert.match(wrapper, /if\(!data\|\|!renderIsCurrent\(activeRenderRequestId\)\|\|!adminSelectedContest\)return/);
  assert.match(wrapper, /Solo Admin/);
  assert.doesNotMatch(wrapper, /publicContestRows|publicResultRows/);
});
