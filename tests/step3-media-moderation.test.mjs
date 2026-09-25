import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000300_step3_media_moderation.sql', import.meta.url),
  'utf8',
);

test('Step 3 adds versioned private media and moderation history only', () => {
  assert.match(migration, /create table public\.submission_media/i);
  assert.match(migration, /create table public\.submission_moderation_events/i);
  assert.match(migration, /submission_id uuid not null[\s\S]*?references public\.submissions\(id\) on delete restrict/i);
  assert.match(migration, /storage_bucket text not null default 'contest-videos'/i);
  assert.match(migration, /storage_path text not null unique/i);
  assert.match(migration, /version_no integer not null/i);
  assert.match(migration, /status text not null default 'PREPARED'/i);
  assert.match(migration, /check \(status in \('PREPARED', 'FINALIZED'\)\)/i);
  assert.match(migration, /check \(not is_current or status = 'FINALIZED'\)/i);
  assert.match(migration, /create unique index submission_media_current_uidx[\s\S]*?where status = 'FINALIZED' and is_current/i);
  assert.doesNotMatch(migration, /'PUBLISHED'|create table public\.(votes|rankings|finalists|contest_results)/i);
});

test('media validation preserves the existing private bucket limits', () => {
  assert.match(migration, /mime_type in \('video\/mp4', 'video\/webm', 'video\/quicktime'\)/i);
  assert.match(migration, /file_size_bytes > 0 and file_size_bytes <= 10485760/i);
  assert.match(migration, /storage_path like 'submissions\/%\/%\/upload'/i);
  assert.match(migration, /bucket_id = 'contest-videos'/i);
  assert.doesNotMatch(migration, /update storage\.buckets[\s\S]*public/i);
});

test('candidate media preparation is ownership-bound, versioned and rejection-aware', () => {
  assert.match(migration, /create or replace function public\.prepare_submission_media_upload\(/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path to ''/i);
  assert.match(migration, /v_identity_auth_user_id is distinct from v_auth_user_id/i);
  assert.match(migration, /v_submission\.status not in \('PENDING', 'REJECTED'\)/i);
  assert.match(migration, /media_already_exists/i);
  assert.match(migration, /version_no, status, is_current/i);
  assert.match(migration, /'PREPARED',[\s\S]*false\n  \) returning \* into v_media/i);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.prepare_submission_media_upload'), migration.indexOf('create or replace function public.finalize_submission_media_upload')), /update public\.submission_media|update public\.submissions/i);
  assert.match(migration, /does not alter|PREPARED/i);
  assert.match(migration, /v_version_no integer/i);
  assert.match(migration, /status = 'PENDING', rejection_reason = null/i);
  assert.match(migration, /submissions\/'.*v_media_id::text.*\/upload/i);
});

test('finalize requires the real Storage object and performs the state transition atomically', () => {
  assert.match(migration, /create or replace function public\.finalize_submission_media_upload\(/i);
  assert.match(migration, /from storage\.objects so[\s\S]*?so\.bucket_id = v_media\.storage_bucket[\s\S]*?so\.name = v_media\.storage_path/i);
  assert.match(migration, /message = 'storage_object_missing'/i);
  assert.match(migration, /metadata ->> 'mimetype'/i);
  assert.match(migration, /message = 'storage_object_type_mismatch'/i);
  assert.match(migration, /message = 'storage_object_size_mismatch'/i);
  assert.match(migration, /set status = 'FINALIZED', is_current = false/i);
  assert.match(migration, /set status = 'FINALIZED', is_current = true/i);
  assert.match(migration, /status = 'PENDING', rejection_reason = null/i);
  assert.match(migration, /revoke execute on function public\.finalize_submission_media_upload\(uuid\) from public, anon/i);
});

test('moderation is Admin-only, records immutable events and separates approval from publication', () => {
  assert.match(migration, /create or replace function public\.moderate_submission\(/i);
  assert.match(migration, /message = 'admin_required'/i);
  assert.match(migration, /p_decision not in \('APPROVED', 'REJECTED'\)/i);
  assert.match(migration, /message = 'rejection_reason_required'/i);
  assert.match(migration, /v_submission\.status <> 'PENDING'/i);
  assert.match(migration, /current_media_required/i);
  assert.match(migration, /sm\.status = 'FINALIZED'[\s\S]*?sm\.is_current/i);
  assert.match(migration, /insert into public\.submission_moderation_events/i);
  assert.match(migration, /moderated_by_auth_user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.doesNotMatch(migration, /submission_status[\s\S]*'PUBLISHED'/i);
});

test('RLS and privileges prevent direct candidate writes and anonymous RPC access', () => {
  for (const table of ['submission_media', 'submission_moderation_events']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke insert, update, delete on table public\\.${table} from authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'));
  }
  assert.match(migration, /revoke execute on function public\.prepare_submission_media_upload\([^;]+from public, anon/i);
  assert.match(migration, /revoke execute on function public\.moderate_submission\([^;]+from public, anon/i);
  assert.match(migration, /grant execute on function public\.prepare_submission_media_upload\([^;]+to authenticated/i);
  assert.match(migration, /grant execute on function public\.finalize_submission_media_upload\(uuid\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.moderate_submission\([^;]+to authenticated/i);
});

test('Storage policies isolate the new path namespace without changing legacy policies', () => {
  assert.match(migration, /create policy submission_media_objects_insert_own/i);
  assert.match(migration, /create policy submission_media_objects_select_owner_or_admin/i);
  assert.match(migration, /name like 'submissions\/%\/%\/upload'/i);
  assert.match(migration, /sm\.storage_path = storage\.objects\.name/i);
  assert.match(migration, /sm\.status = 'PREPARED'[\s\S]*?sm\.is_current = false/i);
  assert.match(migration, /sm\.created_by_auth_user_id = auth\.uid\(\)/i);
  assert.match(migration, /pi\.auth_user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /drop policy|alter policy/i);
});

test('Step 3 does not alter legacy, Step 1 or Step 2 structures', () => {
  assert.doesNotMatch(migration, /alter table public\.(admin_users|profiles|videos|votes|contest_settings|platform_identities|contests|contest_categories|contest_participations|submissions)/i);
  assert.doesNotMatch(migration, /private\.handle_new_user|on_auth_user_created/i);
  assert.doesNotMatch(migration, /create bucket|update storage\.buckets|storage\.buckets/i);
});
