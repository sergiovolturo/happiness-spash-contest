import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = index.indexOf('async function loadPublicContest');
const end = index.indexOf('// Legacy media flow remains below');
const participantFlow = index.slice(start, end);

test('frontend loads Contest and categories only through public RPCs', () => {
  assert.match(participantFlow, /rpc\('get_public_contest'\)/);
  assert.match(participantFlow, /rpc\('get_public_contest_categories'/);
  assert.doesNotMatch(participantFlow, /from\(['"]contests['"]\)|from\(['"]contest_categories['"]\)/);
  assert.match(participantFlow, /publicContest\?\.status/);
});

test('frontend renders unavailable Contest and RPC errors', () => {
  assert.match(participantFlow, /Non ci sono Contest disponibili/);
  assert.match(participantFlow, /Non riesco a caricare il Contest/);
  assert.match(participantFlow, /Non riesco a caricare le categorie/);
  assert.match(participantFlow, /publicContestError/);
  assert.match(participantFlow, /publicCategoryError/);
});

test('frontend uses backend category identity and ordering', () => {
  assert.match(participantFlow, /publicCategories\.map/);
  assert.match(participantFlow, /value="\$\{esc\(c\.id\)\}/);
  assert.match(participantFlow, /c\.name/);
  assert.match(participantFlow, /c\.submission_cap/);
});

test('frontend resolves identity and participation through the single RPC', () => {
  assert.match(participantFlow, /rpc\('ensure_contest_participation'/);
  assert.match(participantFlow, /p_contest_id:publicContest\.id/);
  assert.match(participantFlow, /contest_participation_id/);
  assert.doesNotMatch(participantFlow, /from\(['"]platform_identities['"]\)|from\(['"]contest_participations['"]\)/);
});

test('frontend creates submissions only through create_submission RPC', () => {
  assert.match(participantFlow, /rpc\('create_submission'/);
  assert.match(participantFlow, /p_participation_id:participantId/);
  assert.match(participantFlow, /p_category_id:categoryId/);
  assert.doesNotMatch(participantFlow, /from\(['"]videos['"]\)|from\(['"]votes['"]\)|from\(['"]contest_settings['"]\)/);
});

test('frontend reads new submission status with an explicit mapping', () => {
  assert.match(participantFlow, /from\(['"]submissions['"]\)/);
  assert.match(participantFlow, /submissionStatusLabel/);
  for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
    assert.match(participantFlow, new RegExp(status));
  }
});

test('frontend does not hide submission read errors as an empty list', () => {
  assert.match(participantFlow, /submissionError\?msg\('Non riesco a caricare le tue candidature/);
});

test('frontend maps domain errors without inventing lifecycle rules', () => {
  for (const error of ['contest_not_open', 'category_full', 'submission_already_exists', 'category_inactive', 'contest_category_mismatch', 'participation_not_active', 'contest_not_found', 'unauthorized']) {
    assert.match(participantFlow, new RegExp(error));
  }
  assert.doesNotMatch(participantFlow, /slot|correction_deadline|CORRECTION_EXPIRED/);
});

test('legacy login/signup remains present while new flow avoids hard-coded Contest UUIDs', () => {
  assert.match(index, /supabase\.auth\.signUp/);
  assert.match(index, /supabase\.auth\.signInWithPassword/);
  assert.doesNotMatch(participantFlow, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test('auth initialization does not race the initial session event', () => {
  assert.match(index, /let authReady=false/);
  assert.match(index, /authReady=true;if\(!session\)return authView/);
  assert.match(index, /if\(!authReady\)return/);
});
