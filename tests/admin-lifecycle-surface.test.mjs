import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const index=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const helperStart=index.indexOf('const adminLifecyclePhaseAt=');
const helperEnd=index.indexOf('const adminLifecycleLabel=',helperStart);
const helpers=new Function(index.slice(helperStart,helperEnd)+';return {adminLifecyclePhaseAt,adminOpeningPrerequisites};')();

test('Admin lifecycle surface derives the current phase from Contest status',()=>{
  assert.equal(helpers.adminLifecyclePhaseAt({status:'DRAFT'}),'CONFIGURATION');
  assert.equal(helpers.adminLifecyclePhaseAt({status:'SUBMISSIONS_OPEN'}),'SUBMISSIONS');
  assert.equal(helpers.adminLifecyclePhaseAt({status:'VOTING_OPEN'}),'VOTING');
  assert.equal(helpers.adminLifecyclePhaseAt({status:'VOTING_CLOSED'}),'RESULTS');
});

test('Admin opening prerequisites block zero categories and accept a valid window',()=>{
  const contest={name:'Contest',submissions_open_at:'2026-09-28T08:00:00Z',submissions_close_at:'2026-09-30T18:00:00Z',voting_open_at:'2026-10-01T08:00:00Z',voting_close_at:'2026-10-03T18:00:00Z'};
  assert.equal(helpers.adminOpeningPrerequisites(contest,[]).valid,false);
  assert.equal(helpers.adminOpeningPrerequisites(contest,[{is_active:false}]).valid,false);
  const valid=helpers.adminOpeningPrerequisites(contest,[{is_active:true}]);
  assert.equal(valid.valid,true);
  assert.equal(valid.submissionPeriod,true);
  assert.equal(valid.votingPeriod,true);
  assert.equal(valid.ordering,true);
  assert.equal(helpers.adminOpeningPrerequisites({...contest,submissions_close_at:contest.submissions_open_at},[{is_active:true}]).valid,false);
  assert.equal(helpers.adminOpeningPrerequisites({...contest,voting_open_at:'2026-09-30T17:00:00Z'},[{is_active:true}]).valid,false);
});

test('DRAFT composition keeps configuration and hides operational surfaces',()=>{
  const renderer=index.slice(index.indexOf('const renderAdminContestSectionAuthoritativeLegacy='),index.indexOf('const renderAdminSubmissionsSectionAuthoritative='))+index.slice(index.indexOf('const renderAdminContestSectionAuthoritative=',index.indexOf('const renderAdminSubmissionsSectionAuthoritative=')),index.indexOf('boot();'));
  assert.match(renderer,/adminSelectedContest\.status==='DRAFT'/);
  assert.match(renderer,/adminDraftQuickLaunch/);
  assert.doesNotMatch(renderer,/adminContestSurfaceLegacyFinal|adminRemoveLegacyComposition/);
  assert.match(index,/adminOpeningPrerequisites\(adminSelectedContest,adminSelectedCategories\)/);
});

test('SUBMISSIONS_OPEN composition keeps moderation and collapses manual entry',()=>{
  const renderer=index.slice(index.indexOf('const renderAdminSubmissionsSectionAuthoritative='),index.indexOf('const renderAdminResultsSectionAuthoritative='));
  assert.match(renderer,/adminSelectedContest\.status==='SUBMISSIONS_OPEN'/);
  assert.match(renderer,/submissionWindowStateAt\(adminSelectedContest\)==='OPEN'/);
  assert.match(renderer,/adminManualToggle\(/);
  assert.match(index,/adminSubmissionGrid/);
  assert.match(index,/\+ Inserisci candidatura/);
});

test('VOTING_OPEN and RESULTS compositions foreground the correct surfaces',()=>{
  const active=index.slice(index.indexOf('async function renderAdmin('));
  const contestRenderer=index.slice(index.indexOf('const renderAdminContestSectionAuthoritativeLegacy='),index.indexOf('const renderAdminSubmissionsSectionAuthoritative='))+index.slice(index.indexOf('const renderAdminContestSectionAuthoritative=',index.indexOf('const renderAdminSubmissionsSectionAuthoritative=')),index.indexOf('boot();'));
  const resultsRenderer=index.slice(index.indexOf('const renderAdminResultsSectionAuthoritative='),index.indexOf('const adminRenderAuthoritativeShell='));
  assert.match(contestRenderer,/adminVotingStatusSurface/);
  assert.match(index,/contest\?\.status==='VOTING_OPEN'/);
  assert.match(index,/cast_contest_vote/);
  assert.match(resultsRenderer,/renderAdminResults/);
  assert.match(resultsRenderer,/removeAdminVoteVerificationSurface/);
  assert.match(active,/renderAdminResultsSectionAuthoritative/);
});

test('Admin lifecycle copy is translated at the final active surface',()=>{
  assert.match(index,/Gestisci il Contest, le categorie e le date/);
  assert.match(index,/Crea le categorie in cui i partecipanti potranno candidarsi/);
  assert.match(index,/\['identity','partecipante'\]/);
  assert.match(index,/participation/);
  assert.match(index,/\['publication','pubblicazione'\]/);
});


test('authoritative renderer dispatches directly without a legacy wrapper',()=>{
  const active=index.slice(index.indexOf('async function renderAdmin('));
  assert.match(index,/adminView=renderAdmin/);
  assert.match(active,/renderAdminContestSectionAuthoritative/);
  assert.match(active,/renderAdminSubmissionsSectionAuthoritative/);
  assert.match(active,/renderAdminResultsSectionAuthoritative/);
  assert.doesNotMatch(active,/adminContestSurfaceLegacyFinal\(requestId\)|adminRemoveLegacyComposition/);
  assert.doesNotMatch(index,/adminView=async function/);
});

