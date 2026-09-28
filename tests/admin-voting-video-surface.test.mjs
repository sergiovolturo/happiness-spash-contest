import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = index.indexOf('const adminVotingMediaEligible=');
const helperEnd = index.indexOf('async function renderAdminVotingVideos', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Admin voting media helpers must be present');
const { adminVotingMediaEligible, adminVotingMediaByCategory } = Function(`${index.slice(helperStart, helperEnd)};return {adminVotingMediaEligible,adminVotingMediaByCategory};`)();

test('Admin voting surface renders only current finalized active publications', () => {
  assert.equal(adminVotingMediaEligible({ is_current: true, status: 'FINALIZED' }), true);
  assert.equal(adminVotingMediaEligible({ is_current: false, status: 'FINALIZED' }), false);
  assert.equal(adminVotingMediaEligible({ is_current: true, status: 'PREPARED' }), false);
  assert.equal(adminVotingMediaEligible({ is_current: true, status: 'FINALIZED', revoked_at: '2026-09-28T10:00:00Z' }), false);
});

test('Admin voting videos are isolated by Contest and grouped by real category', () => {
  const categories = [{ id: 'cat-a', name: 'Categoria A' }, { id: 'cat-b', name: 'Categoria B' }];
  const rows = [
    { contest_id: 'contest-1', category_id: 'cat-a', submission_id: 'sub-1', is_current: true, status: 'FINALIZED' },
    { contest_id: 'contest-1', category_id: 'cat-b', submission_id: 'sub-2', is_current: true, status: 'FINALIZED' },
    { contest_id: 'contest-2', category_id: 'cat-a', submission_id: 'foreign', is_current: true, status: 'FINALIZED' },
    { contest_id: 'contest-1', category_id: 'cat-a', submission_id: 'revoked', is_current: true, status: 'FINALIZED', revoked_at: '2026-09-28T10:00:00Z' }
  ];
  const groups = adminVotingMediaByCategory(rows, categories, 'contest-1');
  assert.deepEqual(groups.map(group => group.rows.map(row => row.submission_id)), [['sub-1'], ['sub-2']]);
});

test('Admin voting UI exposes private video playback and legacy name fallback', () => {
  assert.match(index, /Video in votazione/);
  assert.match(index, /renderAdminVotingVideos\(view,requestId\)/);
  assert.match(index, /adminSignedMedia\(row\)/);
  assert.match(index, /Nome candidato non disponibile/);
  assert.match(index, /\.eq\('contest_id',contestId\)/);
  assert.match(index, /category_id/);
});

test('Admin moderation, manual submission and category editing are hidden during voting', () => {
  const votingBranch = index.match(/else if\(phase==='VOTING'\)\{([\s\S]*?)\}else if\(phase==='RESULTS'\)/)?.[1] || '';
  assert.match(votingBranch, /adminHideElement\(categoryManager\)/);
  assert.match(votingBranch, /adminHideElement\(moderationAction\)/);
  assert.match(votingBranch, /adminHideElement\(groups\)/);
  assert.match(votingBranch, /adminHideElement\(manual\)/);
  assert.match(votingBranch, /adminHideElement\(results\?\.querySelector\(':scope > \.grid'\)\)/);
  assert.match(votingBranch, /Risultati e finalisti saranno disponibili dopo la chiusura della votazione/);
});

test('Voting rule remains one verified vote per category', () => {
  assert.match(index, /Regola voto: 1 voto verificato per ciascuna categoria/);
  assert.match(index, /get_my_voted_categories/);
  assert.match(index, /cast_contest_vote/);
});
