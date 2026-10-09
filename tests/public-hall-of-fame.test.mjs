import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261009160000_hall_of_fame_selected_order.sql', import.meta.url), 'utf8');
const contract = migration.slice(migration.indexOf('returns table'), migration.indexOf('language sql'));

test('Hall of Fame is a public navigation surface with the fixed Instagram link', () => {
  assert.match(index, /\['hall-of-fame','Hall Of Fame'\]/);
  assert.match(index, /get_public_hall_of_fame/);
  assert.match(index, /Seguici su Instagram →/);
  assert.match(index, /https:\/\/www\.instagram\.com\/centro_sportivo_happiness\//g);
  assert.doesNotMatch(index, /Guarda il risultato su Instagram/);
});

test('public navigation orders Contest, Candidatura, then Hall Of Fame', () => {
  const nav = index.slice(index.indexOf('function nav()'), index.indexOf('let navBound='));
  assert.match(nav, /\[\['home','Contest'\],\['upload','Candidatura'\]\];tabs\.push\(\['hall-of-fame','Hall Of Fame'\]\)/);
  assert.ok(nav.indexOf("['home','Contest']") < nav.indexOf("['upload','Candidatura']"));
  assert.ok(nav.indexOf("['upload','Candidatura']") < nav.indexOf("['hall-of-fame','Hall Of Fame']"));
});

test('public footer uses the same Instagram profile link', () => {
  assert.match(index, /const publicFooter=.*PUBLIC_INSTAGRAM_URL/);
  assert.match(index, /<span class="muted">Centro Sportivo Happiness<\/span>/);
  assert.doesNotMatch(index.slice(index.indexOf('const publicFooter='), index.indexOf('let navBound=')), /HAPPINESS SPASH CONTEST/);
  assert.match(index, /aria-label="Instagram centro_sportivo_happiness"/);
  assert.match(index, /class="instagramIcon"/);
  assert.match(index, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(index, />@centro_sportivo_happiness<\/a>/);
});

test('Hall of Fame contract exposes only presentation data, never vote or Admin metadata', () => {
  for (const field of ['contest_name', 'category_name', 'winner_name', 'selected_at', 'media_bucket', 'media_path', 'thumbnail_bucket', 'thumbnail_path']) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
  }
  for (const forbidden of ['vote_count', 'rank_position', 'cutoff', 'tie', 'selected_by_auth_user_id', 'snapshot_id', 'submission_id', 'finalist_id']) {
    assert.doesNotMatch(contract, new RegExp(`\\b${forbidden}\\b`, 'i'));
  }
});

test('Hall of Fame is strictly winner, Contest, category, published snapshot and current finalized media scoped', () => {
  for (const fragment of [
    'from public.contest_winners cw',
    /c\.id\s*=\s*cw\.contest_id/i,
    /cc\.id\s*=\s*cw\.category_id/i,
    /cf\.id\s*=\s*cw\.finalist_id/i,
    /cf\.contest_id\s*=\s*cw\.contest_id/i,
    /cf\.category_id\s*=\s*cw\.category_id/i,
    /cf\.submission_id\s*=\s*cw\.submission_id/i,
    /c\.status\s*=\s*'CLOSED'/i,
    /c\.deletion_locked_at\s+is\s+null/i,
    /crs\.status\s*=\s*'PUBLISHED'/i,
    'crs.invalidated_at is null',
    /sm\.status\s*=\s*'FINALIZED'/i,
    'sm.is_current',
    'sm.storage_deleted_at is null'
  ]) assert.match(migration, fragment instanceof RegExp ? fragment : new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('Hall of Fame orders winners by selection time with a deterministic Contest/category tie-break', () => {
  assert.match(migration, /order by cw\.selected_at desc, cw\.contest_id asc, cw\.category_id asc/i);

  const rows = [
    { selected_at: '2026-10-09T10:00:00Z', contest_id: 'b', category_id: 'a' },
    { selected_at: '2026-10-10T10:00:00Z', contest_id: 'z', category_id: 'z' },
    { selected_at: '2026-10-09T10:00:00Z', contest_id: 'a', category_id: 'z' },
    { selected_at: '2026-10-09T10:00:00Z', contest_id: 'a', category_id: 'a' }
  ];
  const ordered = [...rows].sort((left, right) =>
    Date.parse(right.selected_at) - Date.parse(left.selected_at)
      || left.contest_id.localeCompare(right.contest_id)
      || left.category_id.localeCompare(right.category_id)
  );
  assert.deepEqual(ordered.map(row => `${row.contest_id}:${row.category_id}`), ['z:z', 'a:a', 'a:z', 'b:a']);
});

test('Hall of Fame keeps thumbnail optional and the UI identifies each entry as a winner', () => {
  assert.match(migration, /left join storage\.objects thumb_webp/i);
  assert.match(migration, /left join storage\.objects thumb_jpg/i);
  assert.match(index, /class="hallOfFameWinner">VINCITORE/);
  assert.match(index, /class="hallOfFameMedia"/);
});

test('Hall of Fame empty state remains public and points to the profile, not a post', () => {
  assert.match(index, /I vincitori ufficiali appariranno qui dopo la finale su Instagram/);
  assert.match(index, /<section class="card empty hallOfFame">/);
});
