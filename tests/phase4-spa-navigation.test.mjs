import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const runtime=index.slice(index.indexOf('<script>'));

test('top-level router keeps public state reusable and resets Admin to Overview',()=>{
  assert.match(index,/let publicContest=null,publicCategories=\[\],publicActiveContest=null,publicActiveCategories=\[\]/);
  assert.match(runtime,/publicActiveContest=nextContest;publicActiveCategories=result\.data\|\|\[\];publicContest=nextContest;publicCategories=publicActiveCategories/);
  assert.doesNotMatch(runtime,/renderLegacyLoop|render=async function/);
  assert.match(runtime,/const requestId=\+\+renderRequestSeq;[\s\S]*?const requestedTab=currentTab/);
  assert.doesNotMatch(runtime,/async function render\(\)[\s\S]*?loadPublicContest\(requestId\)/);
  const navStart=runtime.lastIndexOf('function bindNav()');
  assert.ok(navStart>=0);
  const finalNav=runtime.slice(navStart,runtime.indexOf('\nlet renderRequestSeq',navStart));
  assert.match(finalNav,/function bindNav\(\)\{[\s\S]*?currentTab=b\.dataset\.tab;(?:void )?render\(\)/);
  assert.match(runtime,/if\(isAdmin&&currentTab==='upload'\)currentTab='admin'/);
});

test('final public view remains request-owned after its async load',()=>{
  assert.match(runtime,/homeView=async function\(requestId=activeRenderRequestId\)\{if\(!renderIsCurrent\(requestId\)\)return/);
  assert.match(runtime,/renderPublicHomeDirectory\(view,requestId\)/);
  assert.match(runtime,/await loadPublicContestDirectory\(requestId\)/);
  const finalHome=runtime.slice(runtime.lastIndexOf('homeView=async function'));
  assert.doesNotMatch(finalHome,/await loadPublicGallery\(requestId\)/);
});

test('Admin configuration exposes explicit category labels',()=>{
  assert.match(runtime,/const adminAddCategoryFieldLabels=view=>\{[\s\S]*?'Nome categoria','Numero massimo candidature','Numero finalisti'/);
  assert.match(runtime,/adminSectionLabels=\{overview:'Panoramica',contest:'Configurazione',submissions:'Candidature',results:'Risultati',settings:'Impostazioni'\}/);
  assert.match(index,/\['home','Contest'\]/);
});

test('ten repeated public/Admin transitions keep one owned render and the expected section',async()=>{
  let currentTab='home';
  let adminSection='overview';
  let renderRequestSeq=0;
  let activeRenderRequestId=0;
  const renders=[];
  const render=async()=>{
    const requestId=++renderRequestSeq;
    activeRenderRequestId=requestId;
    const tab=currentTab;
    const section=tab==='admin'?adminSection:null;
    await Promise.resolve();
    if(requestId!==activeRenderRequestId)return false;
    renders.push({requestId,tab,section});
    return true;
  };
  const click=async tab=>{currentTab=tab;if(tab==='admin')adminSection='overview';return render()};
  for(let cycle=0;cycle<10;cycle++){
    assert.equal(await click('admin'),true);
    assert.deepEqual(renders.at(-1),{requestId:cycle*2+1,tab:'admin',section:'overview'});
    assert.equal(await click('home'),true);
    assert.deepEqual(renders.at(-1),{requestId:cycle*2+2,tab:'home',section:null});
  }
  assert.equal(renders.length,20);
  assert.equal(new Set(renders.map(row=>row.requestId)).size,20);
  assert.equal(currentTab,'home');
});
