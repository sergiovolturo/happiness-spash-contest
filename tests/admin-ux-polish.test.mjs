import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Admin submissions are rendered in category-owned blocks with capacity and finalist metadata', () => {
  const renderer = index.slice(index.indexOf('const adminSubmissionGroupsHtml='), index.indexOf('const renderAdminResultsSectionAuthoritative='));
  assert.match(renderer, /workspace\.cards\.filter\(row=>row\.category_id===category\.id\)/);
  assert.match(renderer, /data-admin-category-group=/);
  assert.match(renderer, /candidatura.*posti.*finalisti/);
  assert.match(renderer, /adminSubmissionGrid/);
  assert.match(renderer, /adminSubmissionCardHtml\(row,workspace\)/);
});

test('Submission cards cannot be rendered in the wrong category block', () => {
  const renderer = index.slice(index.indexOf('const adminSubmissionGroupsHtml='), index.indexOf('const renderAdminResultsSectionAuthoritative='));
  assert.doesNotMatch(renderer, /workspace\.cards\.map\(row=>adminSubmissionCardHtml/);
  assert.match(renderer, /row\.category_id===category\.id/);
});

test('Admin results keep rankings and finalist status scoped to each category', () => {
  const results = index.slice(index.indexOf('async function renderAdminResults'), index.indexOf('function adminCategoryManager'));
  assert.match(results, /data\.categories\.map\(category=>/);
  assert.match(results, /s\.category_id===category\.id/);
  assert.match(results, /snapshot\.status/);
  assert.match(results, /e\.rank_position/);
  assert.match(results, /category\.finalists_count/);
});

test('Early voting close opens confirmation before the close RPC', () => {
  const start = index.indexOf('function closeAdminVotingConfirmation');
  const end = index.indexOf('async function adminFreezeResults', start);
  const flow = index.slice(start, end);
  assert.match(flow, /Chiudere anticipatamente la votazione\?/);
  assert.match(flow, /Annulla/);
  assert.match(flow, /Conferma chiusura/);
  assert.match(flow, /data-admin-close-voting-confirm/);
  assert.match(flow, /adminResultAction\('close-voting'/);
  assert.ok(flow.indexOf('data-admin-close-voting-confirm') < flow.indexOf("adminResultAction('close-voting'"));
  assert.doesNotMatch(flow, /confirm\(/);
});

test('Retention implementation remains outside this frontend-only change', () => {
  assert.equal(index.includes('retain-finalist-media'), false);
});
