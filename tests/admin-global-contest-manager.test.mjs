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

test('authoritative Admin shell replaces the legacy global Contest manager', () => {
  const active = index.slice(index.indexOf('async function renderAdmin('));
  assert.match(active, /adminRemoveLegacyComposition/);
  assert.match(active, /adminRenderAuthoritativeShell/);
  assert.doesNotMatch(active, /adminGlobalContestManager|adminContestSelect/);
});

test('new Contest form stays available and auto-selects the created Contest', () => {
  assert.match(index, /adminBindOverviewCreate/);
  assert.match(index, /admin_create_contest/);
  assert.match(index, /adminSelectedContestId=created\?\.id\|\|null/);
  assert.match(index, /adminNewContestToggle/);
  assert.match(index, /id="adminNewContestForm"/);
});

test('current Contest configuration is separate and hidden during VOTING_OPEN', () => {
  const active = index.slice(index.indexOf('async function renderAdmin('));
  assert.match(index, /adminCurrentContestConfiguration/);
  assert.match(index, /adminSubmissionWindow/);
  assert.match(active, /adminRemoveLegacyComposition/);
  assert.match(active, /adminVotingStatusSurface/);
  assert.match(index, /contest\?\.status==='VOTING_OPEN'/);
  assert.match(active, /adminVotingStatusSurface/);
  assert.doesNotMatch(active, /adminGlobalContestManager/);
});

test('DRAFT shows the current configuration while preserving the global manager', () => {
  const active = index.slice(index.indexOf('async function renderAdmin('));
  assert.match(active, /publicContest\.status==='DRAFT'/);
  assert.match(active, /adminDraftQuickLaunch/);
  assert.match(index, /adminOpenSubmissions/);
  assert.doesNotMatch(active, /adminGlobalContestManager/);
});

test('Contest carries voting status and candidature cards carry server-side counts', () => {
  assert.match(index, /adminVotingStatusSurface/);
  assert.match(index, /adminContestSurfaceLegacyFinal/);
  assert.match(index, /adminModerationGroup/);
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /renderIsCurrent\(requestId\)/);
  const candidatureWrapper=index.slice(index.indexOf('const adminCandidatureCardsBase='));
  assert.doesNotMatch(candidatureWrapper, /supabase\.from\(['"]contest_votes['"]\)/);
});

