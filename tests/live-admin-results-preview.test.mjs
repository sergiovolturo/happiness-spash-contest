import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('live Admin pre-definition surface uses clear finalist terminology', () => {
  const compact = index.slice(index.indexOf('const adminResultsFlowStep='), index.indexOf('const adminRenderCompactResults='));
  assert.match(compact, /Definisci finalisti/);
  assert.doesNotMatch(compact, /Congela risultati/);
  assert.doesNotMatch(compact, /Riepilogo prima del congelamento/);
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
