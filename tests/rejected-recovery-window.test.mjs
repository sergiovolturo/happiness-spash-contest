import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20261009183000_rejected_recovery_window.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const createSubmission = migration.slice(migration.indexOf('create or replace function public.create_submission'));
const prepare = migration.slice(migration.indexOf('create or replace function public.prepare_submission_media_upload'));
const finalize = migration.slice(migration.indexOf('create or replace function public.finalize_submission_media_upload'));

test('create_submission blocks a duplicate REJECTED pair without changing cap semantics', () => {
  assert.match(createSubmission, /s\.status in \('PENDING','APPROVED','REJECTED'\)/);
  assert.match(createSubmission, /where s\.category_id=p_category_id and s\.status in \('PENDING','APPROVED'\)/);
  assert.match(createSubmission, /if v_occupied_count>=v_category\.submission_cap then/);
});

test('rejected recovery is guarded in both prepare and finalize', () => {
  for (const body of [prepare, finalize]) {
    assert.match(body, /v_submission\.status='REJECTED'/);
    assert.match(body, /v_participation\.status<>'ACTIVE'/);
    assert.match(body, /not v_category\.is_active/);
    assert.match(body, /v_participation\.contest_id<>v_category\.contest_id/);
    assert.match(body, /v_contest\.archived_at is not null or v_contest\.deletion_locked_at is not null/);
    assert.match(body, /v_contest\.status<>'SUBMISSIONS_OPEN'/);
    assert.match(body, /submissions_open_at is not null and v_contest\.submissions_open_at>now\(\)/);
    assert.match(body, /submissions_close_at is not null and v_contest\.submissions_close_at<=now\(\)/);
    assert.match(body, /s\.status in \('PENDING','APPROVED'\)/);
  }
});

test('finalize retains the authoritative capacity check for rejected recovery', () => {
  assert.match(finalize, /select count\(\*\) into v_occupied_count/);
  assert.match(finalize, /v_occupied_count>=v_category\.submission_cap/);
  assert.match(finalize, /message='category_full'/);
  assert.match(finalize, /set status='PENDING',rejection_reason=null/);
});

test('recovery does not require an existing current media row', () => {
  const rejectedBranch = prepare.slice(prepare.indexOf("if v_submission.status='REJECTED'"), prepare.indexOf("if p_mime_type"));
  assert.doesNotMatch(rejectedBranch, /FINALIZED.*is_current/);
  assert.match(rejectedBranch, /submission_already_exists/);
});

test('historical REJECTED plus APPROVED rows are not altered by the migration', () => {
  assert.doesNotMatch(migration, /delete from public\.submissions|update public\.submissions\s+set status='REJECTED'/i);
  assert.match(migration, /s\.status in \('PENDING','APPROVED','REJECTED'\)/);
});

test('player exposes replacement only when rejected recovery is available', () => {
  assert.match(index, /rejectedRecoveryState/);
  assert.match(index, /activeSubmissionForCategory=categoryId=>categoryId&&submissionRows\.some\(row=>row\.category_id===categoryId&&\['PENDING','APPROVED','REJECTED'\]\.includes/);
  assert.match(index, /otherActiveSubmissionForCategory=.*\['PENDING','APPROVED'\]\.includes/);
  assert.match(index, /blocked=activeSubmissionForCategory\(c\.id\)/);
  assert.match(index, /r\.status==='REJECTED'&&recovery\.available/);
  assert.match(index, /La candidatura non può più essere ripresentata perché il periodo candidature è terminato/);
  assert.match(index, /Sostituisci il video e ripresenta la candidatura/);
});
