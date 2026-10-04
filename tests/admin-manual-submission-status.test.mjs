import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const adminMigration = (await readFile(
  new URL('../supabase/migrations/20261004065240_admin_auto_approve_manual_submissions.sql', import.meta.url),
  'utf8',
)).replaceAll('\r\n', '\n');

const submissionMigration = (await readFile(
  new URL('../supabase/migrations/20260930000400_rejected_releases_capacity.sql', import.meta.url),
  'utf8',
)).replaceAll('\r\n', '\n');

test('Admin manual submissions are approved without publishing their media', () => {
  assert.match(adminMigration, /create or replace function public\.admin_create_submission_with_media\(/i);
  assert.match(adminMigration, /set creation_source='ADMIN',created_by_auth_user_id=v_admin_auth_user_id,status='APPROVED'/i);
  assert.match(adminMigration, /'creation_source',v_submission\.creation_source,'status',v_submission\.status/i);
  assert.match(adminMigration, /'PREPARED',false\)\s+returning \* into v_media/i);
  assert.doesNotMatch(adminMigration, /insert into public\.submission_publications/i);
  assert.doesNotMatch(adminMigration, /moderate_submission/i);
});

test('Participant submissions still start PENDING in the shared RPC', () => {
  const createSubmission = submissionMigration.slice(
    submissionMigration.indexOf('create or replace function public.create_submission'),
    submissionMigration.indexOf('create or replace function public.finalize_submission_media_upload'),
  );
  assert.match(createSubmission, /insert into public\.submissions\(participation_id,category_id,contestant_display_name,status\)/i);
  assert.match(createSubmission, /values\(p_participation_id,p_category_id,v_name,'PENDING'\)/i);
  assert.doesNotMatch(createSubmission, /status='APPROVED'/i);
});

test('Admin approval does not alter the existing upload and publication boundaries', () => {
  assert.match(adminMigration, /media_status',v_media\.status/i);
  assert.match(adminMigration, /storage_bucket,storage_path/i);
  assert.doesNotMatch(adminMigration, /submission_publications\s*\(/i);
  assert.doesNotMatch(adminMigration, /storage\.objects\s*\)/i);
});
