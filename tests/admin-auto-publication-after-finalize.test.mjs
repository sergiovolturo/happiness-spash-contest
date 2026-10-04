import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = (await readFile(
  new URL('../supabase/migrations/20261004090000_admin_submission_auto_publication_after_finalize.sql', import.meta.url),
  'utf8',
)).replaceAll('\r\n', '\n');

const finalize = migration.slice(migration.indexOf('create or replace function public.finalize_submission_media_upload'));

test('Admin auto-publication runs only after the current media is finalized', () => {
  assert.match(finalize, /v_submission\.creation_source='ADMIN'/i);
  assert.match(finalize, /v_submission\.status='APPROVED'/i);
  assert.match(finalize, /update public\.submission_media set status='FINALIZED',is_current=true/i);
  assert.match(finalize, /public_sm\.status='FINALIZED' and public_sm\.is_current/i);
});

test('Admin auto-publication requires another current public submission in the same Contest', () => {
  assert.match(finalize, /public_cc\.contest_id=\(select cc\.contest_id from public\.contest_categories cc where cc\.id=v_submission\.category_id\)/i);
  assert.match(finalize, /public_sp\.media_id=public_sm\.id and public_sp\.revoked_at is null/i);
  assert.match(finalize, /public_c\.archived_at is null/i);
  assert.match(finalize, /public_s\.id<>v_submission\.id/i);
});

test('Publication is idempotent and records the Admin actor without changing Player flow', () => {
  assert.match(finalize, /not exists\(\s*select 1 from public\.submission_publications sp[\s\S]*sp\.media_id=p_media_id[\s\S]*sp\.revoked_at is null/i);
  assert.match(finalize, /published_by_auth_user_id\s*\) values\(v_submission\.id,p_media_id,now\(\),v_auth_user_id\)/i);
  assert.doesNotMatch(finalize, /creation_source='PARTICIPANT'/i);
});

test('The migration leaves publication permissions authenticated-only', () => {
  assert.match(migration, /revoke execute on function public\.finalize_submission_media_upload\(uuid\) from public,anon,service_role/i);
  assert.match(migration, /grant execute on function public\.finalize_submission_media_upload\(uuid\) to authenticated/i);
});
