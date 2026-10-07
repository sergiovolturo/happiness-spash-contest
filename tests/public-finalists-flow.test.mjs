import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20261005170000_public_finalists_flow.sql', import.meta.url),
  'utf8',
);
const publicationHotfix = await readFile(
  new URL('../supabase/migrations/20261007112000_fix_direct_finalists_publication.sql', import.meta.url),
  'utf8',
);
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('publication promotes frozen finalists directly to published', () => {
  assert.match(migration, /status not in \('FROZEN', 'TIE_REQUIRES_DECISION', 'CONFIRMED'\)/i);
  assert.match(migration, /insert into public\.contest_finalists/i);
  assert.match(migration, /set status = 'PUBLISHED'/i);
  assert.doesNotMatch(migration, /confirm_contest_finalists/i);
});

test('direct publication remains compatible with legacy snapshot constraints', () => {
  assert.match(publicationHotfix, /set status = 'PUBLISHED'/i);
  assert.match(publicationHotfix, /tie_requires_decision = false/i);
  assert.match(publicationHotfix, /confirmed_at = coalesce\(confirmed_at, v_published_at\)/i);
  assert.match(publicationHotfix, /confirmed_by_auth_user_id = coalesce\(confirmed_by_auth_user_id, v_auth_user_id\)/i);
  assert.match(publicationHotfix, /published_at = v_published_at/i);
  assert.doesNotMatch(publicationHotfix, /confirm_contest_finalists\s*\(/i);
});

test('a cutoff tie remains a publication prerequisite', () => {
  assert.match(migration, /message = 'tie_requires_decision'/i);
  assert.match(migration, /from unnest\(v_resolution\.selected_submission_ids\)/i);
  assert.match(publicationHotfix, /message = 'tie_requires_decision'/i);
  assert.match(publicationHotfix, /from unnest\(v_resolution\.selected_submission_ids\)/i);
  const compact = index.slice(index.indexOf('const adminResultsFlowStep='), index.indexOf('const adminRenderCompactResults='));
  assert.match(compact, /PARITÀ PER L’ULTIMO POSTO DISPONIBILE/);
  assert.match(compact, /Pubblica finalisti/);
});

test('the admin flow presents three post-voting steps', () => {
  const compact = index.slice(index.indexOf('const adminResultsFlowStep='), index.indexOf('const adminRenderCompactResults='));
  assert.match(compact, /Votazione chiusa/);
  assert.match(compact, /Finalisti definiti/);
  assert.match(compact, /Pubblica/);
  assert.doesNotMatch(compact, /Congela|Conferma risultati|Finalisti confermati/);
  assert.match(index, /adminApplyPublicFinalistsFlow/);
});
