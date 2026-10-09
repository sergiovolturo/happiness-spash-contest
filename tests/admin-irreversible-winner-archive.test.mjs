import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261009120000_make_completed_archive_irreversible.sql', 'utf8');
const restoreSource = fs.readFileSync('supabase/migrations/20260929000200_contest_workspace_archive_purge.sql', 'utf8');

test('completed archive has no restore CTA and shows irreversible copy', () => {
  assert.match(index, /const archivedIds=adminContestRows\.filter\(contest=>contest\.archived_at\)/);
  assert.match(index, /select\('contest_id'\)\.in\('contest_id',archivedIds\)\.eq\('status','COMPLETED'\)/);
  assert.match(index, /Archiviazione completata\. I dati storici sono conservati; i media non vincitori sono stati eliminati definitivamente\./);
  assert.match(index, /data-admin-restore-contest/);
  assert.match(index, /data-admin-overview-action="restore"/);
});

test('overview scopes the restore CTA per archived Contest, not the selected Contest', () => {
  assert.match(index, /c\.archived_at&&!adminCompletedArchiveContestIds\.has\(c\.id\)\?/);
  assert.doesNotMatch(index, /adminCompletedArchivePresentation/);
});

test('overview preserves restore for legacy archived Contests without COMPLETED', () => {
  assert.match(index, /c\.archived_at&&!adminCompletedArchiveContestIds\.has\(c\.id\)\?.*Ripristina/s);
});

test('settings hides restore and shows irreversible copy for COMPLETED archives', () => {
  assert.match(index, /archiveCompleted=archived&&adminCompletedArchiveContestIds\.has\(contest\.id\)/);
  assert.match(index, /archived&&!archiveCompleted\?/);
  assert.match(index, /archiveCompleted\?'<div class="notice">Archiviazione completata/);
});

test('legacy archived contests can still use restore, while completed archives are filtered first', () => {
  assert.match(migration, /status = 'COMPLETED'/);
  assert.match(migration, /archive_restore_not_allowed/);
  const update = migration.slice(migration.indexOf('update public.contests'));
  assert.match(update, /archived_at = null/);
  assert.match(restoreSource, /deletion_locked_at is null/);
});

test('restore migration preserves security-definer shape and authenticated-only ACL', () => {
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path=''/);
  assert.match(migration, /revoke execute on function public\.admin_restore_contest\(uuid\) from public, anon, service_role/);
  assert.match(migration, /grant execute on function public\.admin_restore_contest\(uuid\) to authenticated/);
});

test('restore guard is server-side and archive flow is untouched', () => {
  assert.doesNotMatch(migration, /admin_prepare_contest_archive|admin_finalize_contest_archive|storage\.objects|delete from/);
  assert.match(migration, /select \* into v_result[\s\S]*for update/);
  assert.match(migration, /if exists \([\s\S]*contest_archive_requests[\s\S]*status = 'COMPLETED'/);
});

test('Hall of Fame/public winner surface is not changed by the archive guard', () => {
  assert.doesNotMatch(migration, /hall_of_fame|get_public_hall_of_fame|contest_winners/);
});

test('index remains valid JavaScript after the Admin archive UI change', () => {
  const script = index.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
});
