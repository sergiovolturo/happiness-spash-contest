import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261002175402_public_contest_archive_retention.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionSource = fs.readFileSync(new URL('../supabase/functions/retain-finalist-media/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

test('public ordering puts submissions open before voting open and sorts each phase newest first', () => {
  const ordering = migration.slice(migration.indexOf('create or replace function public.get_public_contests()'), migration.indexOf('create or replace function public.get_public_contest_archive()'));
  assert.match(ordering, /when 'SUBMISSIONS_OPEN'.*then 1[\s\S]*when 'VOTING_OPEN'.*then 2/);
  assert.match(ordering, /c\.updated_at desc nulls last,c\.created_at desc/);
  assert.doesNotMatch(ordering, /when 'VOTING_OPEN'.*then 1/);
});

test('archive is a separate public surface with newest-first ordering and result access', () => {
  assert.match(migration, /create or replace function public\.get_public_contest_archive\(\)/);
  assert.match(migration, /c\.archived_at is not null or c\.status in \(\s*'VOTING_CLOSED'.*'CLOSED'/s);
  assert.match(migration, /create or replace function public\.get_public_archive_contest_categories\(p_contest_id uuid\)/);
  assert.match(migration, /create or replace function public\.get_public_archive_contest_results\(p_contest_id uuid\)/);
  assert.match(index, /Archivio Contest/);
  assert.match(index, /get_public_archive_contest_categories/);
  assert.match(index, /get_public_archive_contest_results/);
});

test('retention requires CLOSED contests and published snapshots before preparing cleanup', () => {
  const prepare = migration.slice(migration.indexOf('create or replace function public.admin_prepare_finalist_media_retention'), migration.indexOf('create or replace function public.admin_finalize_finalist_media_retention'));
  assert.match(prepare, /v_contest\.status <> 'CLOSED'/);
  assert.match(prepare, /rs\.status='PUBLISHED'/);
  assert.match(prepare, /reason\)[\s\S]*'NON_FINALIST_CLEANUP'/);
  assert.match(prepare, /not exists\(select 1 from public\.contest_finalists/);
});

test('retention never deletes finalists and requires Storage deletion first', () => {
  const finalize = migration.slice(migration.indexOf('create or replace function public.admin_finalize_finalist_media_retention'));
  assert.match(finalize, /finalist_media_protected/);
  assert.match(finalize, /storage_delete_required/);
  assert.match(finalize, /insert into public\.contest_media_deletion_audit/);
  assert.match(finalize, /delete from public\.submission_media/);
  assert.match(finalize, /NON_FINALIST_CLEANUP/);
  assert.doesNotMatch(finalize, /delete from public\.(submissions|contest_votes|contest_result_snapshots|contest_finalists)/);
});

test('retention worker is authenticated, contest-scoped, and retry-safe through pending requests', () => {
  assert.match(functionSource, /callerIsAdmin/);
  assert.match(functionSource, /eq\('status', 'CLOSED'\)/);
  assert.match(functionSource, /admin_prepare_finalist_media_retention/);
  assert.match(functionSource, /admin_finalize_finalist_media_retention/);
  assert.match(functionSource, /storage_path/);
  assert.match(functionSource, /if \(!finalizeError\) completed \+= 1/);
  assert.match(config, /\[functions\.retain-finalist-media\]\s+verify_jwt = true/);
  assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(functionSource, /SUPABASE_SECRET_KEYS/);
});

test('retention preserves application history by using the existing deletion audit workflow', () => {
  assert.match(migration, /contest_media_deletion_requests/);
  assert.match(migration, /contest_media_deletion_audit/);
  assert.match(migration, /delete from public\.submission_publications/);
  assert.match(migration, /delete from public\.submission_media/);
  assert.doesNotMatch(migration, /delete from public\.submissions/);
  assert.doesNotMatch(migration, /delete from public\.contest_votes/);
});
