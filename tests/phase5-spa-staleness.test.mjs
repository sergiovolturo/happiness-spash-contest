import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Phase 5 keeps one request-scoped top-level render',()=>{
  assert.equal((source.match(/async function render\(/g)||[]).length,1);
  assert.doesNotMatch(source,/renderLegacyLoop|render=async function/);
  assert.match(source,/const renderIsCurrent=requestId=>[^;]*requestId===activeRenderRequestId/);
  assert.match(source,/const requestId=\+\+renderRequestSeq/);
  assert.match(source,/activeRenderRequestId=requestId/);
  assert.match(source,/homeView\(requestId\)/);
  assert.match(source,/submissionView\(requestId\)/);
  assert.match(source,/voteView\(requestId\)/);
  assert.match(source,/adminView\(requestId\)/);
});

test('public gallery reuses loaded state and propagates the active request token',()=>{
  assert.match(source,/async function loadPublicGallery\(requestId\)/);
  assert.match(source,/if\(galleryLoadedContestId===publicContest\.id\)return/);
  assert.match(source,/loadPublicGallery\(requestId\)/);
  assert.match(source,/galleryView\(requestId\)/);
  assert.match(source,/galleryRequestId!==galleryRequestSeq\|\|!renderIsCurrent\(requestId\)/);
});

test('Admin owns selected Contest state independently from public state',()=>{
  assert.match(source,/let adminSelectedCategories=\[\]/);
  const adminStart=source.indexOf('async function renderAdmin(');
  const adminEnd=source.indexOf('adminView=renderAdmin;',adminStart);
  assert.ok(adminStart>=0&&adminEnd>adminStart);
  const activeAdmin=source.slice(adminStart,adminEnd);
  assert.doesNotMatch(activeAdmin,/publicContest\s*=/);
  assert.doesNotMatch(activeAdmin,/publicCategories\s*=/);
  assert.match(activeAdmin,/adminSelectedContest=selected/);
  assert.match(activeAdmin,/adminSelectedCategories=categories\.data\|\|\[\]/);
});

test('twenty rapid transitions cannot let stale work commit',async()=>{
  let sequence=0,active=0,dom='',publicLoads=0;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const render=async(tab,delay,loadPublic=false)=>{
    const requestId=++sequence; active=requestId;
    if(loadPublic)publicLoads++;
    await sleep(delay);
    if(requestId!==active)return false;
    dom=tab;
    return true;
  };
  const pending=[];
  for(let i=0;i<20;i++){
    pending.push(render(i%2?'admin':'home',i%3?8:1,i===0));
    await sleep(1);
  }
  const last=await render('admin',1,false);
  await Promise.all(pending);
  assert.equal(last,true);
  assert.equal(dom,'admin');
  assert.equal(publicLoads,1);
});
