import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const index=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const helperStart=index.indexOf('const adminLifecyclePhaseAt=');
const helperEnd=index.indexOf('const adminLifecycleLabel=',helperStart);
const helpers=new Function(index.slice(helperStart,helperEnd)+';return {adminOpeningPrerequisites};')();

const validContest={name:'Contest',submissions_open_at:'2026-09-28T08:00:00Z',submissions_close_at:'2026-09-30T18:00:00Z',voting_open_at:'2026-10-01T08:00:00Z',voting_close_at:'2026-10-03T18:00:00Z'};

test('quick launch requires ordered submission and voting windows',()=>{
  assert.equal(helpers.adminOpeningPrerequisites(validContest,[{is_active:true}]).valid,true);
  assert.equal(helpers.adminOpeningPrerequisites({...validContest,voting_open_at:'2026-09-30T17:00:00Z'},[{is_active:true}]).valid,false);
  assert.equal(helpers.adminOpeningPrerequisites({...validContest,voting_close_at:'2026-10-01T07:00:00Z'},[{is_active:true}]).valid,false);
});

test('DRAFT exposes one quick-launch configuration and bottom launch CTA',()=>{
  assert.match(index,/adminDraftQuickLaunch/);
  assert.match(index,/id="adminDraftConfigForm"/);
  assert.match(index,/id="adminSaveDraftConfig"/);
  assert.match(index,/admin_update_contest/);
  assert.match(index,/admin_set_submission_window/);
  assert.match(index,/admin_set_voting_window/);
  assert.match(index,/id="adminDraftLaunchChecklist"/);
  assert.match(index,/id="adminDraftLaunch"/);
  assert.match(index,/id="adminDraftDeleteContest"/);
  assert.match(index,/document\.querySelector\('\.adminManualSubmissionSurface'\)\?\.remove\(\)/);
});

test('category UX is compact and preserves category RPC actions',()=>{
  assert.match(index,/id="adminDraftCategories"/);
  assert.match(index,/id="adminDraftCategoryForm"/);
  assert.match(index,/\+ Aggiungi/);
  assert.match(index,/admin_create_contest_category/);
  assert.match(index,/data-draft-category-delete/);
  assert.match(index,/admin_update_contest_category/);
});

test('global Contest selector separates current contests from historical archive',()=>{
  assert.match(index,/optgroup label="Contest correnti"/);
  assert.match(index,/optgroup label="Archivio storico"/);
  assert.match(index,/adminCompactContestArchive/);
});

test('SUBMISSIONS_OPEN is compact while manual upload remains collapsed',()=>{
  assert.match(index,/adminSubmissionPhaseCompact/);
  assert.match(index,/adminManualToggle\(document\.querySelector\('#adminManualSubmission'\)/);
  assert.match(index,/adminSubmissionScheduleSummary/);
});

test('READY_FOR_VOTING uses automatic schedule without manual opening CTA',()=>{
  assert.match(index,/adminReadyForVotingSurface/);
  assert.match(index,/si aprirà automaticamente/);
  assert.match(index,/status==='READY_FOR_VOTING'/);
  assert.doesNotMatch(index,/READY_FOR_VOTING:\['open_contest_voting'/);
});

