import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = index.indexOf('const adminVotingMediaEligible=');
const helperEnd = index.indexOf('async function renderAdminVotingVideos', helperStart);
const { adminVotingMediaByCategory } = Function(`${index.slice(helperStart, helperEnd)};return {adminVotingMediaByCategory};`)();
const activeRenderStart = index.lastIndexOf('async function renderAdminVotingVideos(');
const activeRenderEnd = index.indexOf('boot();', activeRenderStart);
const activeRender = index.slice(activeRenderStart, activeRenderEnd);
const votingBranch = index.match(/else if\(phase==='VOTING'\)\{([\s\S]*?)\}else if\(phase==='RESULTS'\)/)?.[1] || '';

test('Admin voting surface uses a compact responsive video grid', () => {
  assert.match(index, /adminVotingVideoGrid/);
  assert.match(index, /grid-template-columns:repeat\(4/);
  assert.match(index, /grid-template-columns:repeat\(3/);
  assert.match(index, /grid-template-columns:repeat\(2/);
  assert.match(activeRender, /adminVotingVideoPreview/);
  assert.doesNotMatch(activeRender, /<video[^>]+controls/);
});

test('video modal opens on demand with controls and restores the grid position', () => {
  assert.match(index, /openAdminVotingVideo/);
  assert.match(index, /<video controls preload="metadata" playsinline><\/video>/);
  assert.match(index, /window\.scrollTo\(0,scrollTop\)/);
  assert.match(index, /returnFocus\.focus\(\)/);
  assert.match(index, /data-admin-video-bucket/);
  assert.match(activeRender, /openAdminVotingVideo\(/);
});

test('initial voting render defers signed media loading until a card is opened', () => {
  assert.doesNotMatch(activeRender, /adminSignedMedia\(/);
  assert.match(index, /url=await adminSignedMedia\(media\)/);
  assert.doesNotMatch(activeRender, /autoplay/);
  assert.match(activeRender, /data-admin-voting-filter/);
});

test('category filters and counts are derived from the selected Contest categories', () => {
  const categories = [{ id: 'cat-a', name: 'Smash più bello' }, { id: 'cat-b', name: 'Caduta più bella' }];
  const rows = Array.from({ length: 30 }, (_, index) => ({
    contest_id: 'contest-1',
    category_id: index % 2 ? 'cat-b' : 'cat-a',
    submission_id: `submission-${index}`
  }));
  rows.push({ contest_id: 'contest-2', category_id: 'cat-a', submission_id: 'foreign' });
  const groups = adminVotingMediaByCategory(rows, categories, 'contest-1');
  assert.deepEqual(groups.map(group => group.rows.length), [15, 15]);
  assert.equal(groups.flatMap(group => group.rows).some(row => row.submission_id === 'foreign'), false);
  assert.match(activeRender, /group\.rows\.length/);
  assert.match(activeRender, /data-admin-voting-category/);
});

test('Voting open removes the complete manual and category configuration surfaces', () => {
  assert.match(votingBranch, /adminHideElement\(categoryManager\)/);
  assert.match(votingBranch, /adminHideElement\(manager\)/);
  assert.match(votingBranch, /adminHideElement\(manual\);if\(manual\)manual\.remove\(\)/);
  assert.match(votingBranch, /adminHideElement\(results\?\.querySelector\(':scope > \.grid'\)\)/);
});

test('Audit is collapsed by default and close voting keeps its confirmation', () => {
  assert.match(index, /<details class="adminAudit"><summary>Audit cancellazioni/);
  assert.doesNotMatch(index, /<details[^>]+open/);
  assert.match(index, /Chiudere definitivamente la votazione\? La chiusura impedirà ulteriori voti/);
});

test('Voting safeguards and stale render ownership remain wired', () => {
  assert.match(index, /Regola voto: 1 voto verificato per ciascuna categoria/);
  assert.match(index, /get_my_voted_categories/);
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /renderIsCurrent\(requestId\)/);
});
