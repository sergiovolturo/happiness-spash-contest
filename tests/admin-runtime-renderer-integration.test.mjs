import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('authenticated Admin candidature entry uses the authoritative renderer', () => {
  const renderAdminCall = "renderStep(renderAdmin(requestId),'admin',requestId,requestedTab)";
  assert.ok(index.includes(`if(requestedTab==='admin'&&renderIsCurrent(requestId))await ${renderAdminCall}`));
  assert.match(index, /else if\(adminSection==='submissions'\)await renderAdminSubmissionsSectionAuthoritative\(view,requestId\)/);
  assert.match(index, /const adminSubmissionCardHtml=/);
  assert.match(index, /class="adminSubmissionMedia"/);
});

test('authoritative runtime card cannot fall back to the legacy large-player/delete surface', () => {
  const start = index.indexOf('const renderAdminSubmissionsSectionAuthoritative=');
  const end = index.indexOf('const renderAdminResultsSectionAuthoritative=', start);
  assert.ok(start >= 0 && end > start);
  const renderer = index.slice(start, end);
  assert.doesNotMatch(renderer, /Apri player grande|Eliminazione definitiva video|Elimina definitivamente video/);
  assert.match(renderer, /data-media-delete/);
  assert.match(renderer, /adminSubmissionCardHtml/);
});

test('the real Admin route preserves the two-column card contract with published media present', () => {
  const cardStart = index.indexOf('const adminSubmissionCardHtml=');
  const cardEnd = index.indexOf('const adminAddCategoryFieldLabels=', cardStart);
  const card = index.slice(cardStart, cardEnd);
  assert.match(card, /class="adminSubmissionInfo"/);
  assert.match(card, /class="adminSubmissionMedia"/);
  assert.match(card, /<video controls preload="metadata" playsinline/);
  assert.match(card, /Elimina video/);
  assert.doesNotMatch(card, />FINALIZED</);
  assert.doesNotMatch(card, />PREPARED</);
  assert.doesNotMatch(card, /Apri player grande/);
  assert.doesNotMatch(card, /Video candidatura \$\{esc\(row\.submission_id\)\}/);
});
