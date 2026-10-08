import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261006150908_contest_archive_media_cleanup.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('per-Contest finalist note is stored in existing configuration and blank means no note', () => {
  assert.match(migration, /admin_update_contest_finalist_note\(\s*p_contest_id uuid,\s*p_note text default ''/s);
  assert.match(migration, /jsonb_set\(\s*coalesce\(configuration, '\{\}'::jsonb\),\s*'\{admin_finalist_note\}'/s);
  assert.match(index, /Nota finalista scelto dall’Admin/);
  assert.match(index, /Scelta dall’Admin per risolvere la parità/);
  assert.match(index, /p_note:event\.currentTarget\.elements\.finalistNote\.value/);
  assert.match(index, /Lascia vuoto per non mostrare alcuna nota/);
  assert.match(index, /adminConfiguredFinalistNote=\(\)=>/);
  assert.match(index, /selectedIds\.has\(item\.submission_id\)&&finalistNote/);
  assert.match(index, /esc\(finalistNote\)/);
});

test('archive eligibility is scoped to one CLOSED Contest with published results for every category', () => {
  assert.match(migration, /v_contest\.status <> 'CLOSED'/);
  assert.match(migration, /cc\.contest_id = p_contest_id/);
  assert.match(migration, /rs\.category_id = cc\.id/);
  assert.match(migration, /rs\.status = 'PUBLISHED'/);
  assert.match(migration, /rs\.invalidated_at is null/);
  assert.match(migration, /not exists \(\s*select 1[\s\S]*_current_contest_result_snapshots\(p_contest_id\)/);
  assert.match(index, /admin_prepare_contest_archive/);
  assert.doesNotMatch(index, /admin_archive_contest/);
});

test('archive plan scopes original media and generated thumbnails by Contest category', () => {
  const prepare = migration.slice(migration.indexOf('create or replace function public.admin_prepare_contest_archive'));
  assert.match(prepare, /join public\.contest_categories cc on cc\.id = s\.category_id/);
  assert.match(prepare, /where cc\.contest_id = p_contest_id/);
  assert.match(prepare, /'contest-thumbnails'/);
  assert.match(prepare, /'contest-videos'/);
  assert.match(prepare, /submission-thumbnails\/' \|\| sm\.submission_id/);
  assert.match(prepare, /union/);
  assert.match(index, /for\(const object of Array\.isArray\(plan\?\.objects\)/);
  assert.match(index, /supabase\.storage\.from\(object\.bucket\)\.remove\(\[object\.path\]\)/);
});

test('finalize deletes only Storage objects, preserves historical rows, and is retry-safe', () => {
  const finalize = migration.slice(migration.indexOf('create or replace function public.admin_finalize_contest_archive'));
  assert.match(finalize, /if v_request\.status = 'COMPLETED' then/);
  assert.match(finalize, /storage_delete_required/);
  assert.match(finalize, /update public\.submission_media sm/);
  assert.match(finalize, /storage_deleted_at = coalesce/);
  assert.match(finalize, /is_current = false/);
  assert.match(finalize, /update public\.contests[\s\S]*archived_at = coalesce/);
  assert.doesNotMatch(finalize, /delete from public\.(contests|contest_categories|submissions|contest_participations|contest_votes|contest_finalists|contest_result_snapshots)/);
});

test('public surfaces keep archived and deletion-locked Contests out', () => {
  const publicMigrations = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(name => name.endsWith('.sql'))
    .map(name => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
    .join('\n');
  assert.match(publicMigrations, /c\.archived_at is null and c\.deletion_locked_at is null/);
  assert.match(publicMigrations, /published_submission_media[\s\S]*c\.archived_at is null/);
  assert.match(index, /adminSelectedContest\.archived_at/);
});

test('confirmation copy and archived Admin indication are explicit', () => {
  assert.match(index, /Archivia Contest\?/);
  assert.match(index, /Il Contest verrà archiviato\. I video e le anteprime dei non finalisti verranno eliminati definitivamente; i media dei finalisti ufficiali saranno conservati insieme a risultati e dati storici\./);
  assert.match(index, /Archivia ed elimina i media/);
  assert.match(index, /Annulla/);
  assert.match(index, /Media eliminati dall’app; dati storici conservati\./);
  assert.match(index, /data-admin-archive-contest/);
});
