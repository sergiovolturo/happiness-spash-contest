import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261005090000_post_voting_results_flow.sql', import.meta.url), 'utf8');

const contestRpcSource = name => {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = migration.indexOf('create or replace function public.', start + 1);
  return migration.slice(start, end < 0 ? migration.length : end);
};

test('public Contest RPCs use only real contest_status values', () => {
  const valid = ['DRAFT', 'SUBMISSIONS_OPEN', 'SUBMISSIONS_CLOSED', 'MODERATION', 'READY_FOR_VOTING', 'VOTING_OPEN', 'VOTING_CLOSED', 'CLOSED'];
  const publicList = contestRpcSource('get_public_contests()');
  const publicSingle = contestRpcSource('get_public_contest()');
  for (const status of valid.filter(value => value !== 'DRAFT')) {
    if (status === 'CLOSED') continue;
    assert.match(publicList, new RegExp(`'${status}'`));
  }
  for (const invalid of ['FROZEN', 'CONFIRMED', 'PUBLISHED']) {
    assert.doesNotMatch(publicList, new RegExp(`'${invalid}'`));
    assert.doesNotMatch(publicSingle, new RegExp(`'${invalid}'`));
  }
  assert.match(publicList, /'VOTING_CLOSED'/);
  assert.doesNotMatch(publicList, /'CLOSED'/);
});

test('Admin preview is rendered independently of the freeze button', () => {
  const wrapperStart = index.indexOf('const renderAdminResultsWithoutPreview=');
  const wrapper = index.slice(wrapperStart, index.indexOf('bindNav();', wrapperStart));
  assert.doesNotMatch(wrapper, /!view\.querySelector\('#freezeResults'\)/);
  assert.match(wrapper, /data\?\.preview/);
  assert.match(wrapper, /Classifica provvisoria/);
  assert.match(wrapper, /Parità da risolvere/);
  assert.match(wrapper, /Finalisti pubblicati/);
});

test('Admin results flow explains each post-vote state', () => {
  assert.match(index, /Risultati e finalisti/);
  assert.match(index, /Gestisci la selezione dei finalisti ufficiali del Contest/);
  for (const step of ['Votazioni concluse', 'Risultati da congelare', 'Eventuali parità da risolvere', 'Finalisti da confermare', 'Finalisti pubblicati']) {
    assert.match(index, new RegExp(step));
  }
  assert.match(index, /Stato corrente:/);
});

test('Public finalisti are shown only from official result rows', () => {
  assert.match(index, /publicOfficialFinalistsMarkup/);
  assert.match(index, /filter\(row=>row\.is_finalist\)/);
  assert.match(index, /Finalisti ufficiali/);
  assert.match(index, /Questi candidati accedono alla Finalissima Instagram/);
  assert.match(index, /\['VOTING_CLOSED','CLOSED'\]\.includes\(publicContest\.status\)/);
  assert.doesNotMatch(index, /publicContest\.status==='PUBLISHED'/);
});

test('Public results remain snapshot-based and do not add Instagram logic', () => {
  const results = contestRpcSource('get_public_contest_results(p_contest_id uuid)');
  assert.match(results, /status='PUBLISHED' and rs\.invalidated_at is null/);
  assert.match(results, /_current_contest_result_snapshots/);
  assert.match(index, /Finalissima Instagram/);
});
