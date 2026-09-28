import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const runtime = index.slice(index.indexOf('<script>'));

test('Candidature cards retain private video playback and real candidate/category data', () => {
  assert.match(index, /adminSignedMedia\(/);
  assert.match(index, /contestant_display_name/);
  assert.match(index, /category\.name/);
  assert.match(index, /submission_publications/);
  assert.match(index, /Voti ricevuti/);
});

test('Voting open keeps candidature cards visible and removes the separate voting grid', () => {
  const votingBranch = index.match(/else if\(phase==='VOTING'\)\{([\s\S]*?)\}else if\(phase==='RESULTS'\)/)?.[1] || '';
  assert.match(votingBranch, /adminShowElement\(groups\)/);
  assert.match(votingBranch, /adminHideElement\(manual\)/);
  assert.doesNotMatch(runtime, /adminVotingVideoGrid|Video in votazione/);
});

test('Voting safeguards remain one verified vote per category', () => {
  assert.match(runtime, /get_my_voted_categories/);
  assert.match(runtime, /cast_contest_vote/);
});
