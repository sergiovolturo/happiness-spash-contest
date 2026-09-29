import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const helperSource=index.slice(index.indexOf("const ROME_TIME_ZONE="),index.indexOf('function syncAuthButtons'));
const helpers=new Function(`${helperSource};return {submissionWindowStateAt,votingWindowStateAt,publicContestStatusLabelAt,publicContestScheduleMessageAt,publicCategoryCtaAt};`)();
const contest={status:'SUBMISSIONS_OPEN',submissions_open_at:'2026-10-01T12:00:00Z',submissions_close_at:'2026-10-02T12:00:00Z',voting_open_at:'2026-10-02T13:00:00Z',voting_close_at:'2026-10-05T12:00:00Z'};
const before=Date.parse('2026-10-01T11:00:00Z');
const during=Date.parse('2026-10-01T13:00:00Z');
const after=Date.parse('2026-10-02T12:00:00Z');

test('public/player temporal labels stay aligned with real windows',()=>{
  assert.equal(helpers.publicContestStatusLabelAt(contest,before),'Candidature programmate');
  assert.equal(helpers.publicContestStatusLabelAt(contest,during),'Candidature aperte');
  assert.equal(helpers.publicContestStatusLabelAt(contest,after),'Candidature chiuse');
  assert.match(helpers.publicContestScheduleMessageAt(contest,before),/apriranno/);
  assert.match(helpers.publicContestScheduleMessageAt(contest,during),/aperte fino/);
  assert.match(helpers.publicContestScheduleMessageAt(contest,after),/votazione aprirà/);
  const voting={...contest,status:'VOTING_OPEN'};
  assert.equal(helpers.publicContestStatusLabelAt(voting,Date.parse('2026-10-02T12:30:00Z')),'Votazione programmata');
  assert.equal(helpers.publicContestStatusLabelAt(voting,Date.parse('2026-10-02T14:00:00Z')),'Votazione aperta');
});

test('category CTA never promises videos that are not published',()=>{
  assert.deepEqual(helpers.publicCategoryCtaAt(contest,0,before),{label:'Contest in partenza',enabled:false});
  assert.deepEqual(helpers.publicCategoryCtaAt(contest,0,during),{label:'Nessun video pubblicato',enabled:false});
  assert.deepEqual(helpers.publicCategoryCtaAt(contest,2,during),{label:'Guarda i video',enabled:true});
  assert.match(index,/publicCategoryCtaAt\(publicContest,count\)/);
  assert.match(index,/Candidature programmate/);
  assert.match(index,/publicContestSchedule/);
});

test('public and Admin category surfaces use the 3:1 image slot and responsive compact grid',()=>{
  assert.match(index,/\.categoryVisualSlot\{aspect-ratio:3\/1/);
  assert.match(index,/\.publicCategoryGrid\{grid-template-columns:repeat\(auto-fit/);
  assert.match(index,/\.categoryManagerList\{grid-template-columns:repeat\(auto-fit/);
  assert.match(index,/@media\(max-width:760px\)\{\.publicCategoryCard\{max-width:none\}/);
  assert.match(index,/categoryImageUrl\(category\)/);
});

test('submission form remains disabled before opening and does not redirect guests to Auth',()=>{
  const finalSubmission=index.slice(index.lastIndexOf('const submissionViewWithPublicWindow='));
  assert.match(finalSubmission,/before=publicContest\?\.status==='SUBMISSIONS_OPEN'&&submissionWindowState\(\)==='BEFORE'/);
  assert.match(finalSubmission,/if\(form\)form\.onsubmit=null/);
  assert.match(finalSubmission,/button\.disabled=true/);
});

test('safe editing and date ordering remain regression-covered without new migration',()=>{
  assert.equal(index.includes('admin_update_contest_configuration'),true);
  assert.match(index,/p_submissions_open_at/);
  assert.match(index,/p_submissions_close_at/);
  assert.match(index,/voting_open_at/);
  assert.equal(index.includes('create or replace function public.admin_update_contest_configuration'),false);
});
