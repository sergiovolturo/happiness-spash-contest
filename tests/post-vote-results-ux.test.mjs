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

test('Admin result surface is compact and independent of the technical preview', () => {
  const compact = index.slice(index.indexOf('const adminResultsFlowStep='), index.indexOf('const adminRenderCompactResults='));
  assert.match(compact, /adminCompactResultsMarkup/);
  assert.match(compact, /FINALISTI DEFINITI/);
  assert.match(compact, /Definisci finalisti/);
  assert.doesNotMatch(compact, /Classifica provvisoria|Parità da risolvere|Risultati congelati/);
});

test('Admin results flow explains each post-vote state', () => {
  const compact = index.slice(index.indexOf('const adminResultsFlowStep='), index.indexOf('const adminRenderCompactResults='));
  for (const step of ['Votazione chiusa', 'Finalisti definiti', 'Pubblica']) {
    assert.match(compact, new RegExp(step));
  }
  for (const technical of ['Congela', 'Conferma risultati', 'Finalisti confermati']) {
    assert.doesNotMatch(compact, new RegExp(technical));
  }
  assert.match(index, /adminApplyPublicFinalistsFlow/);
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
