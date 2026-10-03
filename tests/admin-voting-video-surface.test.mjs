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
  assert.match(index, /adminSubmissionGrid/);
});

test('Voting open keeps candidature cards visible and removes the separate voting grid', () => {
  const active = index.slice(index.indexOf('async function renderAdmin('));
  const candidature = index.slice(index.indexOf('const renderAdminSubmissionsSectionAuthoritative='), index.indexOf('const renderAdminResultsSectionAuthoritative='));
  assert.match(active, /renderAdminSubmissionsSectionAuthoritative/);
  assert.match(candidature, /adminSubmissionGroupsHtml/);
  assert.doesNotMatch(active, /adminContestSurfaceLegacyFinal\(requestId\)|adminRemoveLegacyComposition/);
  assert.doesNotMatch(runtime, /adminVotingVideoGrid|Video in votazione/);
});

test('Voting safeguards remain one verified vote per category', () => {
  assert.match(runtime, /get_my_voted_categories/);
  assert.match(runtime, /cast_contest_vote/);
});

