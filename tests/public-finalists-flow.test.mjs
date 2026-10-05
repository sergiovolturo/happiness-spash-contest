import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20261005170000_public_finalists_flow.sql', import.meta.url),
  'utf8',
);
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('publication promotes frozen finalists directly to published', () => {
  assert.match(migration, /status not in \('FROZEN', 'TIE_REQUIRES_DECISION', 'CONFIRMED'\)/i);
  assert.match(migration, /insert into public\.contest_finalists/i);
  assert.match(migration, /set status = 'PUBLISHED'/i);
  assert.doesNotMatch(migration, /confirm_contest_finalists/i);
});

test('a cutoff tie remains a publication prerequisite', () => {
  assert.match(migration, /message = 'tie_requires_decision'/i);
  assert.match(migration, /from unnest\(v_resolution\.selected_submission_ids\)/i);
  assert.match(index, /Parità da risolvere/);
  assert.match(index, /Pubblica finalisti/);
});

test('the admin flow presents three post-voting steps', () => {
  assert.match(index, /Voto chiuso/);
  assert.match(index, /Congela/);
  assert.match(index, /Pubblica/);
  assert.match(index, /adminApplyPublicFinalistsFlow/);
});
