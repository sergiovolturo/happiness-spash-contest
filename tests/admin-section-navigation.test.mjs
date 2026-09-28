import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const index=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const adminViewWrappers=(source)=>[...source.matchAll(/adminView=async function/g)].length;

test('Admin shell exposes five stable sections only inside Amministra',()=>{
  assert.match(index,/id="adminSectionNavigation"/);
  assert.match(index,/aria-label="Navigazione Amministra"/);
  for(const label of ['Panoramica','Contest','Candidature','Votazione','Risultati'])assert.match(index,new RegExp(label));
  assert.match(index,/if\(currentTab==='admin'\)await renderStep\(adminView\(requestId\),'admin'\)/);
});

test('Admin workspace keeps the selected Contest while changing section',()=>{
  assert.match(index,/let adminSection='overview'/);
  assert.match(index,/adminSelectedContestId=selected\.id/);
  assert.match(index,/data-admin-overview-contest/);
  assert.match(index,/adminSection=button\.dataset\.adminSection/);
  assert.match(index,/adminContestSelect/);
});

test('Admin section navigation starts a fresh render for every click',()=>{
  const shell=index.slice(index.indexOf('const renderAdminShell='),index.indexOf('const adminQuickLaunchSurfaceBase='));
  assert.match(shell,/adminSection=button\.dataset\.adminSection;currentTab='admin';render\(\)/);
  assert.doesNotMatch(shell,/adminView\(requestId\)/);
  assert.match(index,/async function render\(\)\{const requestId=\+\+renderRequestSeq;activeRenderRequestId=requestId/);
});

test('Overview CTA preserves the selected Contest and routes through the fresh render',()=>{
  const overview=index.slice(index.indexOf('const renderAdminOverview='),index.indexOf('const renderAdminContestSection='));
  assert.match(overview,/adminSelectedContestId=selected\.id/);
  assert.match(overview,/adminSection=button\.dataset\.adminOverviewSection;currentTab='admin';render\(\)/);
  assert.doesNotMatch(overview,/adminView\(requestId\)/);
});

test('Overview separates current Contest cards from collapsed archive',()=>{
  assert.match(index,/renderAdminOverview/);
  assert.match(index,/I miei Contest/);
  assert.match(index,/adminOverviewGrid/);
  assert.match(index,/details class="adminArchive"/);
  assert.match(index,/Archivio storico/);
  assert.match(index,/adminClearLegacyAdminSurfaces/);
  assert.match(index,/adminLifecycleTimeline/);
  assert.match(index,/adminPrerequisites/);
});

test('Contest workspace preserves calendar, categories, checklist and launch',()=>{
  assert.match(index,/renderAdminContestSection/);
  assert.match(index,/adminDraftConfigForm/);
  assert.match(index,/submissionOpenAt/);
  assert.match(index,/submissionCloseAt/);
  assert.match(index,/votingOpenAt/);
  assert.match(index,/votingCloseAt/);
  assert.match(index,/adminDraftCategories/);
  assert.match(index,/adminDraftLaunchChecklist/);
  assert.match(index,/adminDraftLaunch/);
});

test('Candidature workspace contains manual CTA, upload form and moderation',()=>{
  assert.match(index,/renderAdminSubmissionsSection/);
  assert.match(index,/adminManualToggle/);
  assert.match(index,/adminManualSubmission/);
  assert.match(index,/adminModerationGroup/);
  assert.match(index,/data-decision="APPROVED"/);
  assert.match(index,/data-decision="REJECTED"/);
  assert.match(index,/Vai a Contest/);
  assert.match(index,/Completa la configurazione nella sezione Contest/);
});

test('Voting and Results workspaces keep their dedicated surfaces and hide clutter',()=>{
  assert.match(index,/renderAdminVotingSection/);
  assert.match(index,/adminVotingVideos/);
  assert.match(index,/adminVotingFilters/);
  assert.match(index,/Chiudi votazione/);
  assert.match(index,/renderAdminResultsSection/);
  assert.match(index,/Congela risultati/);
  assert.match(index,/Conferma finalisti/);
  assert.match(index,/Pubblica finalisti/);
  assert.match(index,/adminHideElement\(document\.querySelector\('#adminManualSubmission,#adminManualSubmissionClosed'\)/);
  assert.match(index,/I risultati saranno disponibili dopo la chiusura della votazione/);
  assert.match(index,/Votazione non disponibile/);
});

test('Section transitions retain one authoritative router without adding Admin wrappers',()=>{
  const shell=index.slice(index.indexOf('const renderAdminShell='),index.indexOf('const adminQuickLaunchSurfaceBase='));
  for(const section of ['overview','contest','submissions','voting','results'])assert.match(shell,new RegExp(`adminSection==='${section}'`));
  assert.equal(adminViewWrappers(index),12);
});

test('Admin entry is consolidated behind renderAdmin and wrapper count is reduced',()=>{
  assert.match(index,/async function renderAdmin\(/);
  assert.match(index,/adminView=renderAdmin/);
  assert.ok(adminViewWrappers(index)<13,'the Admin view wrapper chain must be shorter than the previous 13 wrappers');
});

test('existing business surfaces remain wired for regression coverage',()=>{
  for(const marker of ['admin_open_contest_submissions','open_contest_voting','cast_contest_vote','signInWithOtp','adminUploadAndFinalize','adminFreezeResults','adminPublishFinalists'])assert.match(index,new RegExp(marker));
});
