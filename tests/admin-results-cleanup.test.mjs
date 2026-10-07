import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Admin results reuse already-loaded candidate names without invalid contest_id lookup', () => {
  const start = index.indexOf('const adminReplaceResultIdentifiers=');
  const end = index.indexOf('const adminTranslateParticipation=', start);
  const block = index.slice(start, end);
  assert.match(block, /adminTieCandidateRows/);
  assert.doesNotMatch(block, /\.eq\('contest_id',adminSelectedContest\.id\)/);
  assert.doesNotMatch(block, /supabase\.from\('submissions'\)/);
});

test('Admin tie decision note is intentionally rendered on its own line', () => {
  assert.match(index, /\.adminTieDecisionNote\{display:block;margin-top:3px;font-size:12px;line-height:1\.35\}/);
});
