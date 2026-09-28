import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const index=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const migration=fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20260929000200_contest_workspace_archive_purge.sql'),'utf8');
const aclMigration=fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20260929000300_restrict_admin_contest_list_acl.sql'),'utf8');

test('Admin overview uses Contest cards and keeps the legacy selector hidden',()=>{
  assert.match(index,/data-admin-new-contest/);
  assert.match(index,/data-admin-overview-contest/);
  assert.match(index,/details class="adminArchive"/);
  assert.match(index,/id="adminContestSelect" class="input"/);
  assert.match(index,/<select hidden aria-hidden="true" id="adminContestSelect"/);
  assert.match(index,/adminContestRows\.filter\(c=>!c\.archived_at\)/);
  assert.match(index,/adminContestRows\.filter\(c=>!!c\.archived_at\)/);
});

test('Contest workspace keeps selected contest and fresh section routing',()=>{
  assert.match(index,/id="adminWorkspaceHeader"/);
  assert.match(index,/data-admin-back-overview/);
  assert.match(index,/adminSectionLabels=.*settings:'Impostazioni'/);
  assert.match(index,/adminSection=button\.dataset\.adminSection;currentTab='admin';render\(\)/);
  assert.doesNotMatch(index,/button\.onclick=async\(\)=>\{adminSection=button\.dataset\.adminSection;await adminView\(requestId\)/);
  assert.match(index,/admin_list_contest_categories/);
});

test('Archive and restore are separate, reversible Admin actions',()=>{
  assert.match(migration,/add column if not exists archived_at timestamptz/);
  assert.match(migration,/create or replace function public\.admin_archive_contest/);
  assert.match(migration,/create or replace function public\.admin_restore_contest/);
  assert.match(index,/Archiviare questo Contest\?/);
  assert.match(index,/data-admin-archive-contest/);
  assert.match(index,/data-admin-restore-contest/);
  assert.match(index,/NON cambia|archived_at/);
  assert.match(migration,/c\.archived_at is null and c\.deletion_locked_at is null/);
});

test('Video rejection and physical deletion remain distinct and two-phase',()=>{
  assert.match(index,/data-decision="REJECTED"/);
  assert.match(index,/Elimina definitivamente video/);
  assert.match(index,/const removed=await storage\.remove\(\[plan\.storage_path\]\)/);
  assert.match(index,/admin_prepare_media_deletion/);
  assert.match(index,/admin_finalize_media_deletion/);
  assert.match(index,/Scrivi ELIMINA/);
  assert.match(migration,/create table if not exists public\.contest_media_deletion_audit/);
  assert.match(migration,/storage_delete_required/);
  assert.match(migration,/update public\.submission_publications set revoked_at/);
});

test('Contest purge is explicit, Admin-only, ordered and blocked during voting',()=>{
  for(const name of ['contest_deletion_requests','contest_deletion_audit','admin_prepare_contest_deletion','admin_finalize_contest_deletion','admin_cancel_contest_deletion'])assert.match(migration,new RegExp(name));
  assert.match(migration,/v_contest\.status='VOTING_OPEN'/);
  assert.match(migration,/if exists\(select 1 from public\.submission_media[\s\S]*storage\.objects/);
  for(const table of ['contest_finalists','contest_tie_resolutions','contest_result_entries','contest_result_snapshots','contest_votes','submission_publications','submission_moderation_events','submission_media','submissions','contest_participations','contest_categories'])assert.match(migration,new RegExp('delete from public\\.'+table));
  assert.match(index,/Scrivi esattamente il nome del Contest/);
  assert.match(index,/admin_prepare_contest_deletion/);
  assert.match(index,/admin_finalize_contest_deletion/);
});

test('Public read surfaces exclude archived or locked contests',()=>{
  assert.match(migration,/where c\.archived_at is null and c\.deletion_locked_at is null/);
  assert.match(migration,/and c\.archived_at is null and c\.deletion_locked_at is null/);
  assert.match(migration,/join public\.contests c on c\.id=cc\.contest_id/);
  assert.match(migration,/drop view public\.published_submission_media/);
});

test('No service role or destructive production fixture is introduced in frontend',()=>{
  assert.doesNotMatch(index,/service_role/i);
  assert.doesNotMatch(index,/contest_deletion_audit.*insert/i);
  assert.doesNotMatch(index,/pkaadvqyrdxgymzzugvo.*delete/i);
});

test('Administrative Contest listing is not executable by anonymous callers',()=>{
  assert.match(aclMigration,/revoke execute on function public\.admin_list_contests\(\) from public, anon, service_role/);
  assert.match(aclMigration,/grant execute on function public\.admin_list_contests\(\) to authenticated/);
});
