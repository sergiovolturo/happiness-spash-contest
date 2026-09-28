import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const html=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const manualUi=html.slice(html.indexOf('function adminManualSubmissionForm'),html.indexOf('const adminMimeByExtension'));

test('render ownership is request-scoped, not a boolean global',()=>{
  assert.match(html,/const renderIsCurrent=requestId=>Number\.isInteger\(requestId\)&&requestId===activeRenderRequestId/);
  assert.match(html,/renderStep\(homeView\(requestId\)/);
  assert.match(html,/renderStep\(submissionView\(requestId\)/);
  assert.match(html,/renderStep\(voteView\(requestId\)/);
  assert.match(html,/renderStep\(adminView\(requestId\)/);
  assert.doesNotMatch(html,/const renderIsCurrent=\(\)=>activeRenderRequestId!==0/);
});

test('late render A cannot commit after render B owns the token',async()=>{
  let activeRenderRequestId=1;
  let dom='';
  const renderIsCurrent=requestId=>requestId===activeRenderRequestId;
  const view=async(requestId,label,delay)=>{
    await new Promise(resolve=>setTimeout(resolve,delay));
    if(renderIsCurrent(requestId))dom=label;
  };
  const renderA=view(1,'A',25);
  activeRenderRequestId=2;
  const renderB=view(2,'B',1);
  await Promise.all([renderA,renderB]);
  assert.equal(dom,'B');
});

test('manual Admin UI copy contains no technical identity/participation labels',()=>{
  const visibleCopy=manualUi.replace(/name="identity"/g,'').replace(/'participation:'/g,'').replace(/'identity:'/g,'');
  assert.doesNotMatch(visibleCopy,/Nuova identity|nuova identity|\bIdentity\b|\bparticipation\b/i);
  assert.match(manualUi,/Crea nuovo partecipante/);
  assert.match(manualUi,/Nome del partecipante/);
  assert.match(manualUi,/Partecipazione esistente/);
});

test('closed manual submission is compact and does not keep the full form',()=>{
  assert.match(html,/manual&&!windowInfo\.enabled\)\{manual\.outerHTML=/);
  assert.match(html,/Candidature chiuse/);
  assert.match(html,/Inserimento manuale non disponibile in questa fase/);
  assert.match(html,/id="adminManualSubmissionClosed"/);
});

test('open manual submission keeps the full form only when the window is enabled',()=>{
  assert.match(html,/else if\(manual\)\{manual\.querySelectorAll\('input,select,button,textarea'\)\.forEach\(control=>control\.disabled=false\)\}/);
  assert.match(html,/enabled:contest\.status==='SUBMISSIONS_OPEN'&&temporalState==='OPEN'/);
  assert.match(html,/id="adminManualSubmission"/);
});

test('all runtime gallery definitions accept ownership and vote callback does not use an undefined token',()=>{
  assert.doesNotMatch(html,/async function galleryView\(\)/);
  assert.match(html,/async function galleryView\(renderRequestId=activeRenderRequestId\)/);
  assert.match(html,/voteInFlight\.delete\(key\);await galleryView\(\)\}/);
  assert.doesNotMatch(html,/voteInFlight\.delete\(key\);await galleryView\(requestId\)\}/);
});
