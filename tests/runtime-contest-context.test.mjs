import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('current bootstrap context reads Admin identity but never contest_settings', () => {
  const currentStart = index.indexOf('async function loadCurrentContestContext');
  const legacyStart = index.indexOf('async function loadLegacySettingsContext');
  const current = index.slice(currentStart, legacyStart);
  assert.match(current, /from\('admin_users'\)/);
  assert.doesNotMatch(current, /contest_settings/);
  assert.match(index, /async function loadContext\(\)\{return loadCurrentContestContext\(\)\}/);
});

test('boot and auth refresh use the current Contest context only', () => {
  const runtimeStart = index.indexOf('async function boot()');
  const runtimeEnd = index.indexOf('function forgotPasswordView()', runtimeStart);
  const runtime = index.slice(runtimeStart, runtimeEnd);
  assert.doesNotMatch(runtime, /loadLegacySettingsContext/);
  assert.match(runtime, /loadContext\(\)/);
  assert.match(index, /submissionWindowStateAt=\(contest/);
  assert.match(index, /votingWindowStateAt=\(contest/);
});

test('legacy settings are lazy and isolated to legacy video/vote surfaces', () => {
  const legacyStart = index.indexOf('async function loadLegacySettingsContext');
  const legacyEnd = index.indexOf('const adminErrorLabel', legacyStart);
  const legacy = index.slice(legacyStart, legacyEnd);
  assert.match(legacy, /from\('contest_settings'\)/);
  assert.match(index, /const legacyUploadView=uploadView/);
  assert.match(index, /const legacyVoteView=voteView/);
  assert.match(legacy, /from\('videos'\)/);
  assert.match(legacy, /from\('votes'\)/);
});

test('current upload and vote navigation does not use the legacy settings writer', () => {
  assert.equal((index.match(/updateSettings\(/g) || []).length, 1);
  assert.match(index, /admin_update_contest_configuration/);
  assert.match(index, /cast_contest_vote/);
});
