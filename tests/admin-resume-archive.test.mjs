import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settings = index.slice(index.indexOf('const renderAdminSettingsSection='), index.indexOf('const renderAdminShell='));
const archiveFlow = index.slice(index.indexOf('const adminArchiveContestConfirmation='), index.indexOf('const adminMediaDeletionReason='));

test('normal CLOSED Contest keeps the standard archive action', () => {
  assert.match(settings, /archiveable=contest\.status==='CLOSED'&&!archived&&!contest\.deletion_locked_at&&hasPublishedResults/);
  assert.match(settings, /data-admin-archive-contest/);
  assert.match(settings, />Archivia Contest<\/button>/);
});

test('locked PENDING archive shows the resume action and clear copy', () => {
  assert.match(index, /contest\.deletion_locked_at/);
  assert.match(index, /contest_archive_requests'\)\.select\('id,status'\)/);
  assert.match(index, /\.eq\('status','PENDING'\)/);
  assert.match(index, /data-admin-resume-archive/);
  assert.match(index, /Riprendi archiviazione/);
  assert.match(index, /Archiviazione non completata\. Puoi riprendere l’operazione senza perdere i dati storici\./);
});

test('resume still uses the authoritative prepare, Storage delete, and finalize sequence', () => {
  assert.match(archiveFlow, /supabase\.rpc\('admin_prepare_contest_archive'/);
  assert.match(archiveFlow, /supabase\.storage\.from\(object\.bucket\)\.remove\(\[object\.path\]\)/);
  assert.match(archiveFlow, /supabase\.rpc\('admin_finalize_contest_archive'/);
  assert.doesNotMatch(archiveFlow, /deletion_locked_at\s*=\s*null/);
});

test('resume does not create a new archive request in the client', () => {
  assert.doesNotMatch(index, /contest_archive_requests[^\n]*\.insert/);
  assert.match(archiveFlow, /supabase\.rpc\('admin_prepare_contest_archive'/);
});

test('already archived Contests cannot enter the retry flow', () => {
  assert.match(archiveFlow, /adminSelectedContest\.archived_at/);
  assert.match(index, /contest\.archived_at\|\|!contest\.deletion_locked_at/);
});

test('archive resume observer binds to existing app root, never a missing view node', () => {
  assert.match(index, /adminResumeArchiveObserver\.observe\(document\.querySelector\('#app'\),\{childList:true,subtree:true\}\)/);
  assert.doesNotMatch(index, /adminResumeArchiveObserver\.observe\(document\.querySelector\('#view'\)/);
});

test('resume confirmation uses non-technical Admin copy', () => {
  assert.match(archiveFlow, /resume=!!adminSelectedContest\?\.deletion_locked_at&&!adminSelectedContest\?\.archived_at/);
  assert.match(archiveFlow, /Riprendi archiviazione\?/);
  assert.match(archiveFlow, /Archivia e conserva i vincitori/);
});
