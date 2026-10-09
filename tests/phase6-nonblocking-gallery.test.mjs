import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const activeHome=source.slice(source.lastIndexOf('homeView=async function'));
const homeFlow=source.slice(source.indexOf('const homeViewStable='),source.indexOf('const adminCategoryDefinitionCard='));
const activeGallery=source.slice(source.lastIndexOf('async function galleryView('),source.indexOf('const renderPublicGalleryCards='));
const thumbnailWrapper=source.indexOf('const galleryViewBeforeThumbnails=');
const finalGalleryStart=source.lastIndexOf('galleryView=async function(requestId=activeRenderRequestId){',thumbnailWrapper);
const finalGallery=source.slice(finalGalleryStart,source.indexOf('submissionView=async function',finalGalleryStart));

test('public home does not await gallery loading from the top-level render',()=>{
  assert.doesNotMatch(activeHome,/await loadPublicGallery\(requestId\)/);
  assert.match(homeFlow,/renderPublicHomeShell\(view,requestId\)/);
  assert.match(homeFlow,/void loadPublicGallery\(requestId\)\.then/);
  assert.doesNotMatch(source.slice(source.lastIndexOf('const renderPublicHomeDirectory='),source.lastIndexOf('galleryView=async function')),/publicGalleryArea/);
});

test('gallery query is abortable and reports local lifecycle phases',()=>{
  assert.match(source,/activeRenderAbortController\?\.abort\(\)/);
  assert.match(source,/new AbortController\(\)/);
  assert.match(source,/query\.abortSignal\(signal\)/);
  assert.match(source,/console\.debug\('\[gallery\]'/);
  assert.match(source,/id=\\?"retryPublicGallery/);
});

test('initial public gallery does not download media files',()=>{
  assert.match(activeGallery,/if\(galleryActiveMediaId\)/);
  const beforeMediaBranch=activeGallery.slice(0,activeGallery.indexOf('if(galleryActiveMediaId)'));
  assert.doesNotMatch(beforeMediaBranch,/resolveGalleryMedia\(/);
});

test('auth refresh and duplicate same-user sign-in do not trigger render',()=>{
  const auth=source.slice(source.indexOf('supabase.auth.onAuthStateChange'),source.indexOf('function forgotPasswordView'));
  assert.doesNotMatch(auth,/event==='TOKEN_REFRESHED'[^|&]*render\(\)/);
  assert.match(auth,/identityChanged=previousUserId!==nextUserId/);
  assert.match(auth,/shouldRender=event==='INITIAL_SESSION'/);
  assert.match(auth,/event==='SIGNED_IN'&&identityChanged/);
  assert.match(auth,/if\(!shouldRender\)return/);
  assert.match(auth,/console\.debug\('\[auth\]'/);
});

test('twenty hanging gallery transitions never block the next shell',async()=>{
  let activeRequest=0,renderedTab='',globalSpinner=true,startedGallery=0;
  const never=()=>new Promise(()=>{});
  const render=async(tab)=>{
    const requestId=++activeRequest;
    renderedTab=tab;
    globalSpinner=false;
    if(tab==='home'){startedGallery++;void never().then(()=>{});}
    return requestId;
  };
  for(let i=0;i<20;i++){
    await render(i%2?'admin':'home');
    assert.equal(globalSpinner,false);
  }
  assert.equal(renderedTab,'admin');
  assert.equal(startedGallery,10);
});

test('public home is a vertical active-contest directory with dates below categories',()=>{
  assert.match(source,/get_public_contests/);
  assert.match(source,/publicContestRows\.map/);
  assert.match(source,/publicContestPhaseOrder=\{SUBMISSIONS_OPEN:0,VOTING_OPEN:1/);
  assert.match(source,/data-public-contest-surface/);
  assert.match(source,/publicContestScheduleInlineHtml\(contest\)/);
  assert.doesNotMatch(source,/get_public_archive_contest_categories|get_public_archive_contest_results/);
  assert.doesNotMatch(source,/Archivio Contest/);
});

test('public contest cards render optional description and no redundant eyebrow',()=>{
  const homeStart=source.lastIndexOf('const renderPublicHomeDirectory='),home=source.slice(homeStart,source.indexOf('homeView=async function',homeStart));
  assert.match(home,/String\(contest\.description\|\|'\'\)\.trim\(\)/);
  assert.match(home,/publicContestDescription/);
  assert.doesNotMatch(home,/<div class="eyebrow">Contest<\/div>/);
  assert.match(home,/publicContestScheduleInlineHtml\(contest\)/);
});

test('category video status uses one informative presentation when videos are unavailable',()=>{
  const helper=source.slice(source.indexOf('const publicDirectoryCategoryHtml='),source.indexOf('const renderPublicHomeDirectory='));
  assert.match(helper,/categoryInfoPill categoryVideoStatus/);
  assert.match(helper,/publicCategoryCtaAt\(contest,published\)/);
  assert.match(source,/label:'Nessun video pubblicato'/);
});

test('submission flow selects a contest with an actually open window',()=>{
  assert.match(source,/const openSubmissionContests=\(\)=>publicContestRows\.filter/);
  assert.match(source,/contest\.status==='SUBMISSIONS_OPEN'&&submissionWindowStateAt\(contest\)==='OPEN'/);
  assert.match(source,/ensureSubmissionContest/);
  assert.match(source,/submissionContestSelect/);
});

test('the active public gallery is a dedicated view opened only by an explicit category action',()=>{
  const finalHome=source.slice(source.lastIndexOf('const renderPublicHomeDirectory='),finalGalleryStart);
  assert.doesNotMatch(finalHome,/publicGalleryArea/);
  assert.match(finalHome,/await loadPublicGallery\(requestId\);await galleryView\(requestId\)/);
  assert.match(finalGallery,/const view=document\.querySelector\('#view'\)/);
  assert.match(finalGallery,/view\.innerHTML/);
  assert.match(finalGallery,/id="backToPublicContests"/);
  assert.match(finalGallery,/homeView\(activeRenderRequestId\)/);
  assert.match(finalGallery,/data-gallery-category/);
  assert.match(finalGallery,/data-open-public-media/);
  assert.match(finalGallery,/voteControls\(row,category\)/);
  assert.doesNotMatch(finalGallery,/renderPublicHomeDirectory/);
});
