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

test('public home puts the summary and categories before the compact date block',()=>{
  const home=index.slice(index.indexOf('const renderPublicHomeShell='),index.indexOf('homeView=async function',index.indexOf('const renderPublicHomeShell=')));
  assert.match(home,/publicContestSummary muted/);
  assert.match(index,/const publicScheduleSurfaceHtml=.*Date del Contest/s);
  assert.match(index,/publicDesktopComposition/);
  assert.match(index,/publicDesktopInfo/);
  assert.match(index,/publicDesktopCategories/);
  assert.match(index,/publicDesktopDates/);
  assert.match(index,/composition\.append\(info,categories,dates\)/);
  assert.match(index,/append\(schedule\)/);
  assert.match(index,/\.publicScheduleSurface\{padding:12px 16px/);
});

test('public desktop composition is three-column and preserves mobile content order',()=>{
  assert.match(index,/\.publicDesktopComposition\{display:grid;grid-template-columns:minmax\(220px,\.8fr\) minmax\(480px,1\.6fr\) minmax\(260px,\.8fr\)/);
  assert.match(index,/\.publicDesktopCategories \.publicCategoryGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)/);
  assert.match(index,/\.publicDesktopDates \.publicScheduleGrid\{grid-template-columns:1fr\}/);
  assert.match(index,/@media\(max-width:760px\)\{\.publicDesktopComposition\{display:block\}/);
  const ensure=index.slice(index.indexOf('const ensurePublicScheduleSurface='),index.indexOf('const homeViewWithPublicSchedule='));
  assert.ok(ensure.indexOf("info.append(title)")<ensure.indexOf("categories.append(grid)"));
  assert.ok(ensure.indexOf("categories.append(grid)")<ensure.indexOf("composition.append(info,categories,dates)"));
  assert.match(ensure,/if\(schedule\)dates\.append\(schedule\)/);
  assert.match(ensure,/composition\.append\(info,categories,dates\)/);
});

test('empty public category state is informative and not an actionable button',()=>{
  assert.match(index,/document\.createElement\('article'\)/);
  assert.match(index,/categoryInfoPill/);
  assert.match(index,/\.categoryCardInformative\{cursor:default!important;pointer-events:none\}/);
  assert.match(index,/Nessun video pubblicato/);
  assert.match(index,/Guarda i video/);
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

test('Admin temporal labels receive the full Contest object',()=>{
  assert.match(index,/adminReadableStatus\(c\)/);
  assert.doesNotMatch(index,/adminReadableStatus\(c\.status\)/);
  assert.doesNotMatch(index,/adminReadableStatus\(adminSelectedContest\.status\)/);
  assert.doesNotMatch(index,/adminReadableStatus\(adminSelectedContest\?\.status\)/);
});
