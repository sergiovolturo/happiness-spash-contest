import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const activeHome=source.slice(source.lastIndexOf('homeView=async function'));
const homeFlow=source.slice(source.indexOf('const homeViewStable='),source.indexOf('const adminCategoryDefinitionCard='));
const activeGallery=source.slice(source.lastIndexOf('async function galleryView('),source.indexOf('const renderPublicGalleryCards='));
const baseGalleryStart=source.indexOf('async function galleryView(renderRequestId=activeRenderRequestId)');
const baseGallery=source.slice(baseGalleryStart,source.indexOf('async function homeViewLegacy',baseGalleryStart));
const secondGalleryStart=source.indexOf('async function galleryView(renderRequestId=activeRenderRequestId)',baseGalleryStart+1);
const secondGallery=source.slice(secondGalleryStart,source.indexOf('async function updateSettings',secondGalleryStart));
const finalGalleryChain=source.slice(source.indexOf('const renderPublicGalleryCards='),source.indexOf('function adminLifecycleActions'));

test('public home does not await gallery loading from the top-level render',()=>{
  assert.doesNotMatch(activeHome,/await loadPublicGallery\(requestId\)/);
  assert.match(homeFlow,/renderPublicHomeShell\(view,requestId\)/);
  assert.match(homeFlow,/void loadPublicGallery\(requestId\)\.then/);
  assert.match(source,/id=\\?"publicGalleryArea/);
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

test('gallery fallback messages stay inside the public gallery area',()=>{
  assert.doesNotMatch(baseGallery,/view\.innerHTML/);
  assert.match(baseGallery,/galleryArea=view\?\.querySelector\('#publicGalleryArea'\)/);
  assert.match(baseGallery,/renderGalleryFallback=html=>\{galleryArea\.innerHTML=html/);
  assert.doesNotMatch(baseGallery,/return view\.innerHTML=msg\(/);
  assert.doesNotMatch(baseGallery,/return view\.innerHTML='<section class="card empty"/);
});

test('all gallery implementations in the final chain render only inside the gallery area',()=>{
  assert.match(secondGallery,/galleryArea=view\?\.querySelector\('#publicGalleryArea'\)/);
  assert.doesNotMatch(secondGallery,/view\.innerHTML/);
  assert.doesNotMatch(finalGalleryChain,/view\.innerHTML/);
});

test('multi-contest home does not duplicate categories or show an empty archive CTA',()=>{
  const directoryHome=source.slice(source.indexOf('const renderPublicHomeWithDirectory='),source.indexOf('homeView=renderPublicHomeWithDirectory'));
  assert.match(secondGallery,/if\(!gallerySelectedCategoryId\)\{galleryArea\.innerHTML='';galleryArea\.hidden=true;return\}/);
  assert.match(directoryHome,/id="publicGalleryArea" class="card" hidden/);
  assert.match(directoryHome,/publicArchiveRows\.length\?/);
});

test('auth refresh and duplicate same-user sign-in do not trigger render',()=>{
  const auth=source.slice(source.indexOf('supabase.auth.onAuthStateChange'),source.indexOf('login.onclick'));
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
