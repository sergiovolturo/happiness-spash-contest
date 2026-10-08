import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261008110947_public_hall_of_fame.sql', import.meta.url), 'utf8');
const contract = migration.slice(migration.indexOf('returns table'), migration.indexOf('language sql'));

test('Hall of Fame is a public navigation surface with the fixed Instagram link', () => {
  assert.match(index, /\['hall-of-fame','Hall Of Fame'\]/);
  assert.match(index, /get_public_hall_of_fame/);
  assert.match(index, /Seguici su Instagram →/);
  assert.match(index, /https:\/\/www\.instagram\.com\/centro_sportivo_happiness\//g);
  assert.doesNotMatch(index, /Guarda il risultato su Instagram/);
});

test('public footer uses the same Instagram profile link', () => {
  assert.match(index, /const publicFooter=.*PUBLIC_INSTAGRAM_URL/);
  assert.match(index, /@centro_sportivo_happiness\//);
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
    'c.id = cw.contest_id',
    'cc.id = cw.category_id',
    'cf.id = cw.finalist_id',
    'cf.contest_id = cw.contest_id',
    'cf.category_id = cw.category_id',
    'cf.submission_id = cw.submission_id',
    "c.status = 'CLOSED'",
    'c.archived_at is null',
    'c.deletion_locked_at is null',
    "crs.status = 'PUBLISHED'",
    'crs.invalidated_at is null',
    "sm.status = 'FINALIZED'",
    'sm.is_current',
    'sm.storage_deleted_at is null'
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('Hall of Fame orders newest Contests first and categories by Contest order', () => {
  assert.match(migration, /order by c\.created_at desc, cc\.display_order asc, cc\.id asc/i);
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
