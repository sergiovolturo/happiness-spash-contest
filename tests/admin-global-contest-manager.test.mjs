import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const managerStart = index.indexOf('function adminContestManager()');
const managerEnd = index.indexOf('function bindAdminContestManager', managerStart);
const manager = index.slice(managerStart, managerEnd);
const lifecycleStart = index.indexOf('const adminLifecycleSurfaceBase=');
const lifecycleEnd = index.indexOf('const adminLifecycleActionGuardBase=', lifecycleStart);
const lifecycle = index.slice(lifecycleStart, lifecycleEnd);
const votingBranch = lifecycle.match(/else if\(phase==='VOTING'\)\{([\s\S]*?)\}else if\(phase==='RESULTS'\)/)?.[1] || '';

test('global Contest manager remains visible in every lifecycle phase', () => {
  assert.match(manager, /adminGlobalContestManager/);
  assert.match(manager, /id="adminContestSelect"/);
  assert.match(manager, /id="adminCreateContest"/);
  assert.match(manager, /Stato corrente del Contest/);
  assert.doesNotMatch(lifecycle, /adminHideElement\(manager\)/);
});

test('new Contest form stays available and auto-selects the created Contest', () => {
  assert.match(manager, /Crea Contest DRAFT/);
  assert.match(index, /admin_create_contest/);
  assert.match(index, /await selectAdminContest\(Array\.isArray\(data\)\?data\[0\]:data\)/);
  assert.match(index, /adminNewContestToggle/);
  assert.match(index, /#adminCreateContest>div:has\(input\[name="slug"\]\)/);
});

test('current Contest configuration is separate and hidden during VOTING_OPEN', () => {
  assert.match(manager, /adminCurrentContestConfiguration/);
  assert.match(manager, /adminSubmissionWindow/);
  assert.match(votingBranch, /adminHideElement\(currentConfig\)/);
  assert.match(votingBranch, /adminHideElement\(categoryManager\)/);
  assert.match(votingBranch, /adminShowElement\(groups\)/);
  assert.match(votingBranch, /adminHideElement\(manual\)/);
});

test('DRAFT shows the current configuration while preserving the global manager', () => {
  assert.match(lifecycle, /if\(phase==='CONFIGURATION'\)\{adminShowElement\(currentConfig\)/);
  assert.match(lifecycle, /else if\(phase==='SUBMISSIONS'\)\{adminShowElement\(currentConfig\)/);
  assert.match(manager, /adminOpenSubmissions/);
});

test('Contest carries voting status and candidature cards carry server-side counts', () => {
  assert.match(index, /adminVotingStatusSurface/);
  assert.match(index, /admin_list_contest_submission_cards/);
  assert.match(index, /Voti ricevuti/);
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /renderIsCurrent\(requestId\)/);
  const candidatureWrapper=index.slice(index.indexOf('const adminCandidatureCardsBase='));
  assert.doesNotMatch(candidatureWrapper, /supabase\.from\(['"]contest_votes['"]\)/);
});
