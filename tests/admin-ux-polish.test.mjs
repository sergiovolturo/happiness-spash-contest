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

test('Settings summary is real, phase-aware and category-scoped', () => {
  assert.match(index, /Riepilogo generale/);
  assert.match(index, /adminSettingsCategorySummary\(adminSelectedCategories,submissions,media,votes/);
  assert.match(index, /submissions\.filter\(row=>row\.category_id===category\.id\)/);
  assert.match(index, /submissionIds\.has\(row\.submission_id\)/);
  assert.match(index, /status==='VOTING_OPEN'.*Risultati: in corso/);
  assert.doesNotMatch(index, /Risultati: assenti/);
});

test('Contest deletion uses a strong modal and preserves the guarded backend flow', () => {
  const modal = index.slice(index.indexOf('function adminContestDeletionModal'), index.indexOf('const renderAdminOverview='));
  const deletion = index.slice(index.indexOf('async function adminDeleteContest'), index.indexOf('const renderAdminOverview='));
  assert.match(modal, /Eliminare definitivamente il Contest\?/);
  assert.match(modal, /data-admin-delete-cancel/);
  assert.match(modal, /data-admin-delete-confirm disabled/);
  assert.match(modal, /input\.value!==contestName/);
  assert.match(deletion, /admin_prepare_contest_deletion/);
  assert.match(deletion, /admin_finalize_contest_deletion/);
  assert.match(deletion, /admin_cancel_contest_deletion/);
  assert.ok(deletion.indexOf('adminContestDeletionModal') < deletion.indexOf('admin_prepare_contest_deletion'));
});

test('Danger actions use readable, distinct visual treatments', () => {
  assert.match(index, /adminConfirmOverlay \[data-admin-close-voting-confirm\]\{background:#111;color:#FFD400/);
  assert.match(index, /danger-zone \[data-admin-delete-contest\]\{background:#fff0f1;color:#8F1D1D;border:1px solid #8F1D1D/);
});
