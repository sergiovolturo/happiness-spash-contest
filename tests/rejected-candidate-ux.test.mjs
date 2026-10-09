import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const playerStart = index.indexOf('function submissionCard');
const playerEnd = index.indexOf('function submissionView', playerStart);
const playerCard = index.slice(playerStart, playerEnd);
const workspaceStart = index.indexOf('const loadAdminSubmissionWorkspace');
const workspaceEnd = index.indexOf('const adminAddCategoryFieldLabels', workspaceStart);
const adminWorkspace = index.slice(workspaceStart, workspaceEnd);
const cardStart = index.indexOf('const adminSubmissionCardHtml=');
const cardEnd = index.indexOf('const adminAddCategoryFieldLabels=', cardStart);
const adminCard = index.slice(cardStart, cardEnd);

test('REJECTED keeps the rejection reason and offers replacement/re-submit CTA', () => {
  assert.match(playerCard, /r\.rejection_reason\?msg\(r\.rejection_reason,'error'\)/);
  assert.match(playerCard, /Sostituisci il video e ripresenta la candidatura/);
  assert.match(playerCard, /r\.status==='REJECTED'/);
});

test('Player upload rule matches the backend-supported states', () => {
  assert.match(playerCard, /canUpload=\(r\.status==='PENDING'&&!current\)\|\|\(r\.status==='REJECTED'&&recovery\.available\)/);
  assert.doesNotMatch(playerCard, /canUpload=r\.status==='REJECTED'\|\|!current/);
});

test('Admin loads the existing deletion preflight for each submission', () => {
  assert.match(adminWorkspace, /admin_get_submission_delete_status/);
  assert.match(adminWorkspace, /deleteStatuses=new Map/);
});

test('Admin only renders candidate deletion when preflight explicitly allows it', () => {
  assert.match(adminCard, /canDeleteSubmission=!adminSelectedContest\?\.archived_at&&deleteStatus\?\.deletable===true/);
  assert.match(adminCard, /canDeleteSubmission\?`<button class="btn danger"[^`]*data-submission-delete/);
  assert.doesNotMatch(adminCard, /!adminSelectedContest\?\.archived_at\?`<button class="btn danger" type="button" data-submission-delete/);
});

test('Admin moderation and media controls remain present', () => {
  assert.match(adminCard, /data-decision="APPROVED"/);
  assert.match(adminCard, /data-decision="REJECTED"/);
  assert.match(adminCard, /data-media-delete/);
});
