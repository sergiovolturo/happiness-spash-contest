import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync('index.html','utf8');
const renderer=index.slice(index.indexOf('async function renderAdmin('));

test('Admin has one authoritative renderer and no historical assignments',()=>{
  assert.equal((index.match(/adminView=async function/g)||[]).length,0);
  assert.match(index,/adminView=renderAdmin/);
  assert.match(index,/adminRenderAuthoritativeShell/);
  assert.doesNotMatch(renderer,/adminContestManager()|adminGlobalContestManager/);
});

test('overview creation is compact and auto-selects the created Contest',()=>{
  assert.match(index,/id="adminNewContestForm"/);
  assert.match(index,/id="adminNewContestToggle"/);
  assert.match(index,/admin_create_contest/);
  assert.match(index,/adminSelectedContestId=created?.id||null/);
  assert.doesNotMatch(index.slice(index.indexOf('id="adminNewContestForm"'),index.indexOf('id="adminNewContestForm"')+500),/name="slug"/);
});

test('workspace routes sections without direct nested Admin renders',()=>{
  for(const marker of ['data-admin-section','adminDraftQuickLaunch','adminManualToggle','adminResults','adminSettingsSurface','adminVotingStatusSurface'])assert.match(index,new RegExp(marker));
  assert.doesNotMatch(renderer,/await adminView\(/);
});

test('legacy surfaces are removed before the authoritative section is shown',()=>{
  assert.match(index,/adminRemoveLegacyComposition/);
  assert.match(index,/adminCurrentContestConfiguration/);
  assert.match(index,/adminManualSubmissionClosed/);
  assert.match(index,/I risultati saranno disponibili dopo la chiusura/);
});

