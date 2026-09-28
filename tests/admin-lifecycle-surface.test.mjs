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
  const contest={name:'Contest',submissions_open_at:'2026-09-28T08:00:00Z',submissions_close_at:'2026-09-30T18:00:00Z'};
  assert.equal(helpers.adminOpeningPrerequisites(contest,[]).valid,false);
  assert.equal(helpers.adminOpeningPrerequisites(contest,[{is_active:false}]).valid,false);
  const valid=helpers.adminOpeningPrerequisites(contest,[{is_active:true}]);
  assert.deepEqual(valid,{name:true,categories:true,period:true,valid:true});
  assert.equal(helpers.adminOpeningPrerequisites({...contest,submissions_close_at:contest.submissions_open_at},[{is_active:true}]).valid,false);
});

test('DRAFT composition keeps configuration and hides operational surfaces',()=>{
  assert.match(index,/phase==='CONFIGURATION'/);
  assert.match(index,/adminHideElement\(moderationAction\)/);
  assert.match(index,/adminHideElement\(groups\)/);
  assert.match(index,/adminHideElement\(manual\)/);
  assert.match(index,/adminHideElement\(results\)/);
  assert.match(index,/adminOpeningPrerequisites\(publicContest,publicCategories\)/);
});

test('SUBMISSIONS_OPEN composition keeps moderation and collapses manual entry',()=>{
  assert.match(index,/phase==='SUBMISSIONS'/);
  assert.match(index,/adminShowElement\(groups\)/);
  assert.match(index,/adminManualToggle\(manual\)/);
  assert.match(index,/\+ Inserisci candidatura/);
});

test('VOTING_OPEN and RESULTS compositions foreground the correct surfaces',()=>{
  assert.match(index,/phase==='VOTING'/);
  assert.match(index,/Regola voto: 1 voto verificato per ciascuna categoria/);
  assert.match(index,/published_submission_media/);
  assert.match(index,/phase==='RESULTS'/);
  assert.match(index,/adminReplaceResultIdentifiers/);
});

test('Admin lifecycle copy is translated at the final active surface',()=>{
  assert.match(index,/Gestisci il Contest, le categorie e le date/);
  assert.match(index,/Crea le categorie in cui i partecipanti potranno candidarsi/);
  assert.match(index,/\['identity','partecipante'\]/);
  assert.match(index,/participation/);
  assert.match(index,/\['publication','pubblicazione'\]/);
});
