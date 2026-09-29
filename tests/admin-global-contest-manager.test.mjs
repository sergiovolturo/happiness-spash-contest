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
  assert.match(active, /adminRenderAuthoritativeShell/);
  assert.match(active, /renderAdminContestSectionAuthoritative/);
  assert.match(active, /renderAdminSubmissionsSectionAuthoritative/);
  assert.match(active, /renderAdminResultsSectionAuthoritative/);
  assert.doesNotMatch(active, /adminContestSurfaceLegacyFinal\(|adminRemoveLegacyComposition|adminGlobalContestManager|adminContestSelect/);
});

test('new Contest form stays available and auto-selects the created Contest', () => {
  assert.match(index, /adminBindOverviewCreate/);
  assert.match(index, /admin_create_contest/);
  assert.match(index, /adminSelectedContestId=created\?\.id\|\|null/);
  assert.match(index, /adminNewContestToggle/);
  assert.match(index, /id="adminNewContestForm"/);
});

test('current Contest configuration is rendered directly and voting status is isolated', () => {
  const active = index.slice(index.indexOf('async function renderAdmin('));
  const contestRenderer = index.slice(index.indexOf('const renderAdminContestSectionAuthoritativeLegacy='), index.indexOf('const renderAdminSubmissionsSectionAuthoritative=')) + index.slice(index.indexOf('const renderAdminContestSectionAuthoritative=', index.indexOf('const renderAdminSubmissionsSectionAuthoritative=')), index.indexOf('boot();'));
  assert.match(active, /renderAdminContestSectionAuthoritative/);
  assert.match(contestRenderer, /adminSelectedContest\.status==='DRAFT'/);
  assert.match(contestRenderer, /adminDraftQuickLaunch/);
  assert.match(contestRenderer, /adminVotingStatusSurface/);
  assert.match(index, /contest\?\.status==='VOTING_OPEN'/);
  assert.doesNotMatch(contestRenderer, /adminCurrentContestConfiguration|adminRemoveLegacyComposition/);
});

test('DRAFT uses only the direct quick-launch configuration', () => {
  const contestRenderer = index.slice(index.indexOf('const renderAdminContestSectionAuthoritativeLegacy='), index.indexOf('const renderAdminSubmissionsSectionAuthoritative=')) + index.slice(index.indexOf('const renderAdminContestSectionAuthoritative=', index.indexOf('const renderAdminSubmissionsSectionAuthoritative=')), index.indexOf('boot();'));
  assert.match(contestRenderer, /adminSelectedContest\.status==='DRAFT'/);
  assert.match(contestRenderer, /adminDraftQuickLaunch/);
  assert.match(index, /adminOpenSubmissions/);
  assert.doesNotMatch(contestRenderer, /adminGlobalContestManager|adminContestSurfaceLegacyFinal/);
});

test('Contest carries voting status and candidature cards carry server-side counts', () => {
  assert.match(index, /adminVotingStatusSurface/);
  assert.match(index, /admin_list_contest_submission_cards/);
  assert.match(index, /adminSubmissionCardHtml/);
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /renderIsCurrent\(requestId\)/);
  const candidatureRenderer=index.slice(index.indexOf('const renderAdminSubmissionsSectionAuthoritative='),index.indexOf('const renderAdminResultsSectionAuthoritative='));
  assert.doesNotMatch(candidatureRenderer, /supabase\.from\(['"]contest_votes['"]\)/);
});

