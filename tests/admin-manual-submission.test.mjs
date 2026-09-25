import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260922000517_admin_manual_submissions.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('manual Admin flow adds provider-neutral origin and actor attribution', () => {
  assert.match(migration, /identity_origin text not null default 'AUTH'/i);
  assert.match(migration, /'ADMIN_MANAGED'/);
  assert.match(migration, /created_by_admin_auth_user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /creation_source text not null default 'PARTICIPANT'/i);
  assert.match(migration, /created_by_auth_user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /creation_source = 'ADMIN'/i);
  assert.match(migration, /values \(p_participation_id, p_category_id, 'PENDING', v_auth_user_id\)/i);
});

test('managed identities require no fabricated Auth user and reuse normal participation/submission constraints', () => {
  assert.match(migration, /insert into public\.platform_identities[\s\S]*?'ADMIN_MANAGED'/i);
  assert.match(migration, /insert into public\.contest_participations[\s\S]*?on conflict \(contest_id, identity_id\)/i);
  assert.match(migration, /public\.create_submission\(v_participation_id, p_category_id\)/i);
  assert.match(migration, /category_full/);
  assert.match(migration, /submission_already_exists/);
  assert.match(migration, /original_filename', v_media\.original_filename/);
  assert.match(migration, /mime_type', v_media\.mime_type/);
  assert.match(migration, /file_size_bytes', v_media\.file_size_bytes/);
});

test('Admin identity lookup and creation are fail-closed SECURITY DEFINER RPCs', () => {
  for (const name of ['admin_list_contest_identities', 'admin_create_submission_with_media']) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    const end = migration.indexOf('$function$;', start);
    const body = migration.slice(start, end);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path\s*=\s*''/i);
    assert.match(body, /public\.admin_users/);
    assert.match(body, /admin_required/);
  }
  assert.match(migration, /revoke execute on function public\.admin_create_submission_with_media\([^;]*from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.admin_create_submission_with_media\([^;]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.admin_create_submission_with_media\([^;]*to anon/i);
});

test('Admin Storage upload remains private and exact-path/PREPARED-only', () => {
  assert.match(migration, /drop policy submission_media_objects_insert_own on storage\.objects/i);
  assert.match(migration, /create policy submission_media_objects_insert_own[\s\S]*?bucket_id = 'contest-videos'/i);
  assert.match(migration, /sm\.storage_bucket = storage\.objects\.bucket_id/);
  assert.match(migration, /sm\.storage_path = storage\.objects\.name/);
  assert.match(migration, /sm\.status = 'PREPARED' and not sm\.is_current/);
  assert.match(migration, /s\.creation_source = 'ADMIN'/);
  assert.match(migration, /sm\.created_by_auth_user_id = auth\.uid\(\)/);
  assert.match(index, /upsert:false/);
  assert.match(index, /adminUploadAndFinalize/);
});

test('Admin manual submission UI retries prepared media and stays out of the Player tab', () => {
  assert.match(index, /adminManualSubmissionForm/);
  assert.match(index, /admin_create_submission_with_media/);
  assert.match(index, /adminPreparedUpload/);
  assert.match(index, /Riprova upload\/finalize/);
  assert.match(index, /Inserita dall’organizzazione/);
});

test('Admin manual upload retries transient finalize visibility errors and preserves failures after refresh', () => {
  assert.match(index, /adminFinalizeWithRetry/);
  assert.match(index, /attempt<12/);
  assert.match(index, /adminErrorDetails/);
  assert.match(index, /adminFileMetadata/);
  assert.match(index, /adminMimeAliases/);
  assert.match(index, /storage_object_missing\|storage_object_type_mismatch\|storage_object_size_mismatch/);
  assert.match(index, /await adminView\(\);const currentBox=document\.querySelector\('#adminMsg'\)/);
  assert.match(index, /finally\{adminActionsInFlight\.delete\(key\);if\(document\.body\.contains\(button\)\)button\.disabled=false\}/);
});

test('first Admin flow maps RPC media_id to finalize id; recovery flow reads the same id from staged media', () => {
  assert.match(index, /const media=\{\.\.\.prepared\.data,id:prepared\.data\.media_id/);
  assert.match(index, /data-media-id="\$\{esc\(prepared\.id\)\}"/);
  assert.match(index, /p_media_id:media\.id/);
});

test('Admin metadata validation keeps backend limits without requiring fragile filename equality', () => {
  assert.match(index, /mp4:'video\/mp4',webm:'video\/webm',mov:'video\/quicktime'/);
  assert.match(index, /file\.size>10485760/);
  assert.match(index, /p_mime_type:metadata\.mimeType/);
  assert.match(index, /p_file_size_bytes:file\.size/);
  assert.match(index, /media\.file_size_bytes!=null&&file\.size!==Number\(media\.file_size_bytes\)/);
  assert.doesNotMatch(index, /file\.name!==media\.original_filename/);
});

test('Admin first flow is instrumented, abortable and always releases the in-flight guard', () => {
  for (const phase of ['click handler entered', 'form/file validation passed', 'auth session resolved', 'create/stage RPC resolved', 'storage upload started', 'finalize', 'adminView refresh started', 'finally executed']) {
    assert.match(index, new RegExp(phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(index, /ADMIN_REQUEST_TIMEOUT_MS=30000/);
  assert.match(index, /new AbortController\(\)/);
  assert.match(index, /request\.abortSignal\(controller\.signal\)/);
  assert.match(index, /adminRpc\('admin_create_submission_with_media'[\s\S]*?'create\/stage RPC'/);
  assert.match(index, /adminActionsInFlight\.has\(key\)/);
  assert.match(index, /flowId===adminManualRequestSeq/);
  assert.match(index, /adminAwait\(supabase\.auth\.getSession\(\),'auth session'\)/);
  assert.match(index, /La richiesta non ha raggiunto il server entro il tempo previsto/);
  assert.match(index, /finally\{adminTrace\('finally executed'\);adminActionsInFlight\.delete\(key\)/);
});

test('Admin timeout covers auth, RPC and refresh without creating a client-side duplicate', () => {
  assert.match(index, /adminRpc\('admin_create_submission_with_media'/);
  assert.match(index, /await adminAwait\(adminView\(\),'adminView refresh'\)/);
  assert.match(index, /const flowId=\+\+adminManualRequestSeq/);
  assert.match(index, /if\(adminActionsInFlight\.has\(key\)\)return/);
  assert.match(index, /adminEnsureSession\(requestSession\.user\.id\)/);
});
