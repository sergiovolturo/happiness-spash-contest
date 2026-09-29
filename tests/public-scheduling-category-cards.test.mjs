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
});

test('public Contest header is one compact block with both dynamic date ranges',()=>{
  const home=index.slice(index.indexOf('const renderPublicHomeShell='),index.indexOf('homeView=async function',index.indexOf('const renderPublicHomeShell=')));
  assert.match(home,/publicContestSummary muted/);
  assert.match(index,/const publicContestScheduleInlineHtml=.*Candidature.*Votazioni/s);
  assert.match(index,/title\.querySelectorAll\('\.publicContestSummary'\)\.forEach\(node=>node\.remove\(\)\)/);
  assert.match(index,/title\.insertAdjacentHTML\('beforeend',publicContestScheduleInlineHtml\(publicContest\)\)/);
  assert.doesNotMatch(index,/holder\?\.after\(schedule\.firstElementChild\)/);
  assert.match(index,/gallerySection\.publicDesktopSurface/);
  assert.match(index,/section\.classList\.add\('publicDesktopSurface'\)/);
  assert.match(index,/\.section-title>\.publicContestScheduleInline\{display:grid;grid-template-columns:1fr/);
  assert.doesNotMatch(index,/\.section-title>\.publicContestScheduleInline\{display:grid;grid-template-columns:repeat\(2,/);
  assert.match(index,/\.section-title>\.publicContestScheduleInline[^}]*margin-top:8px[^}]*padding-top:0[^}]*border-top:0/);
  assert.match(index,/\.gallerySection\.publicDesktopSurface>\.section-title\{display:block;text-align:left\}/);
  assert.match(index,/\.section-title:has\(> \.publicCategoryGrid\)\{display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-rows:auto auto auto/);
  assert.match(index,/\.section-title:has\(> \.publicCategoryGrid\)>\.publicContestScheduleInline\{[^}]*width:100%;margin-top:8px/);
  assert.match(index,/\.publicCategoryGrid\{display:grid;grid-column:1;grid-row:3;grid-template-columns:repeat\(2,minmax\(0,1fr\)/);
  assert.match(index,/@media\(max-width:760px\)\{\.gallerySection\.publicDesktopSurface>\.section-title:has\(> \.publicCategoryGrid\)\{display:flex;flex-direction:column/);
  assert.match(index,/\.publicContestScheduleInline \.muted\{display:block;white-space:nowrap/);
  assert.match(index,/@media\(max-width:760px\)\{\.gallerySection\.publicDesktopSurface>\.section-title>\.publicContestScheduleInline\{grid-template-columns:1fr/);
  const activePublicComposition=index.slice(index.indexOf('const publicContestScheduleInlineHtml='));
  assert.doesNotMatch(activePublicComposition,/Date del Contest/);
  assert.doesNotMatch(activePublicComposition,/Le candidature sono aperte fino al/);
});

test('anonymous top-level Candidatura navigation binds a real click handler',()=>{
  const nav=index.slice(index.indexOf('function nav()'),index.indexOf('function bindNavStable='));
  assert.match(nav,/\['home','Vista pubblica'\],\['upload','Candidatura'\]/);
  assert.match(index,/function bindNav\(\)\{document\.querySelectorAll\('\[data-tab\]'\)\.forEach\(b=>b\.addEventListener\('click',event=>\{event\.preventDefault\(\);currentTab=b\.dataset\.tab;void render\(\)\}\)\)\}/);
});

test('public desktop surface uses CSS grid without DOM reparenting and preserves mobile order',()=>{
  assert.match(index,/\.gallerySection\.publicDesktopSurface\{display:grid;grid-template-columns:minmax\(220px,\.8fr\) minmax\(0,1\.8fr\) minmax\(260px,\.8fr\)/);
  assert.match(index,/\.gallerySection\.publicDesktopSurface>\.section-title\{grid-column:1;grid-row:1;display:block/);
  assert.match(index,/\.gallerySection\.publicDesktopSurface>\.publicCategoryGrid\{grid-column:2;grid-row:1/);
  assert.match(index,/\.gallerySection\.publicDesktopSurface>#publicGalleryArea\{grid-column:1\/-1;grid-row:2/);
  assert.match(index,/@media\(min-width:1100px\)\{\.gallerySection\.publicDesktopSurface\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(480px,1fr\)/);
  assert.match(index,/\.gallerySection\.publicDesktopSurface>\.section-title:has\(> \.publicCategoryGrid\)> \.publicCategoryGrid\{grid-column:1\/-1;grid-row:2/);
  assert.match(index,/@media\(max-width:760px\)\{\.gallerySection\.publicDesktopSurface\{display:flex;flex-direction:column/);
  const ensure=index.slice(index.indexOf('const ensurePublicScheduleSurface='),index.indexOf('const homeViewWithPublicSchedule='));
  assert.doesNotMatch(ensure,/publicScheduleSurfaceHtml|after\(schedule/);
  assert.match(ensure,/publicContestScheduleInlineHtml/);
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
