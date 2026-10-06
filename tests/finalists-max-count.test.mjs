import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261005161135_finalists_max_count.sql', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('effective finalist count is the maximum capped by eligible candidates', () => {
  const effective = (maximum, candidates) => Math.min(maximum, candidates);
  for (const [maximum, candidates, expected] of [[4, 10, 4], [4, 4, 4], [4, 2, 2], [4, 1, 1], [4, 0, 0]]) {
    assert.equal(effective(maximum, candidates), expected);
  }
});

test('confirm_contest_finalists validates against the effective count', () => {
  assert.match(migration, /v_effective_finalists_count\s+integer/);
  assert.match(migration, /least\(v_snapshot\.finalists_count, v_candidate_count\)/i);
  assert.match(migration, /v_inserted\s+<>\s+v_effective_finalists_count/);
  assert.doesNotMatch(migration, /v_inserted\s+<>\s+v_snapshot\.finalists_count/);
  assert.match(migration, /grant execute on function public\.confirm_contest_finalists\(uuid\)\s+to authenticated/i);
  assert.doesNotMatch(migration, /freeze_contest_results|resolve_contest_result_tie|publish_contest_finalists/);
});

test('Admin copy describes finalists_count as a maximum and keeps insufficiency informational', () => {
  const compact = index.slice(index.indexOf('const adminResultsFlowStep='), index.indexOf('const adminRenderCompactResults='));
  assert.match(compact, /effectiveCount=Math\.min/);
  assert.match(compact, /slice\(0,effectiveCount\)/);
  assert.doesNotMatch(compact, /Fino a \$1 finalisti|meno candidati del massimo configurato/);
});

