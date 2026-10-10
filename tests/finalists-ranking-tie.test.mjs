import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261010100000_fix_finalists_ranking_tie.sql', import.meta.url), 'utf8');

function rankCandidates(votes, finalistsCount) {
  const sorted = [...votes]
    .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id))
    .map((candidate, index, all) => ({
      ...candidate,
      ordinal: index + 1,
      rank: 1 + all.slice(0, index).filter(previous => previous.votes > candidate.votes).length,
    }));
  const groups = new Map();
  for (const candidate of sorted) {
    const group = groups.get(candidate.votes) ?? [];
    group.push(candidate);
    groups.set(candidate.votes, group);
  }
  const cutoffTieVotes = [...groups.entries()]
    .filter(([, group]) => Math.min(...group.map(candidate => candidate.ordinal)) <= finalistsCount
      && Math.max(...group.map(candidate => candidate.ordinal)) > finalistsCount)
    .map(([voteCount]) => voteCount);
  return {
    sorted,
    cutoffTieVotes,
    selected: sorted.slice(0, Math.min(finalistsCount, sorted.length)),
  };
}

test('migration uses dense rank plus deterministic ordinal cutoff logic', () => {
  assert.match(migration, /dense_rank\(\) over \(order by c\.vote_count desc\)/);
  assert.match(migration, /row_number\(\) over \(order by c\.vote_count desc, c\.submission_id\)/);
  assert.match(migration, /min\(ordinal_position\) <= v_category\.finalists_count/);
  assert.match(migration, /max\(ordinal_position\) > v_category\.finalists_count/);
});

test('2,2,1,1,0,0,0,0 with four places is frozen without a cutoff tie and selects four', () => {
  const result = rankCandidates([2, 2, 1, 1, 0, 0, 0, 0].map((votes, i) => ({ id: `s${i}`, votes })), 4);
  assert.deepEqual(result.cutoffTieVotes, []);
  assert.equal(result.selected.length, 4);
});

test('5,4,3,2,2 with four places detects the cutoff tie and leaves one slot', () => {
  const result = rankCandidates([5, 4, 3, 2, 2].map((votes, i) => ({ id: `s${i}`, votes })), 4);
  assert.deepEqual(result.cutoffTieVotes, [2]);
  assert.equal(result.selected.length, 4);
  assert.equal(result.selected.filter(candidate => candidate.votes === 2).length, 1);
});

test('5,5,4,3 with four places has no cutoff tie and selects all four', () => {
  const result = rankCandidates([5, 5, 4, 3].map((votes, i) => ({ id: `s${i}`, votes })), 4);
  assert.deepEqual(result.cutoffTieVotes, []);
  assert.equal(result.selected.length, 4);
});

test('fewer candidates than places selects only the available candidates', () => {
  const result = rankCandidates([4, 2, 1].map((votes, i) => ({ id: `s${i}`, votes })), 4);
  assert.deepEqual(result.cutoffTieVotes, []);
  assert.equal(result.selected.length, 3);
});

test('a tie wholly inside or wholly outside the cutoff does not require a decision', () => {
  const inside = rankCandidates([5, 5, 4, 3, 2].map((votes, i) => ({ id: `s${i}`, votes })), 4);
  const outside = rankCandidates([5, 4, 3, 2, 2, 2].map((votes, i) => ({ id: `s${i}`, votes })), 3);
  assert.deepEqual(inside.cutoffTieVotes, []);
  assert.deepEqual(outside.cutoffTieVotes, []);
});

test('a tie crossing the final slot is the only tie marked for resolution', () => {
  const result = rankCandidates([8, 7, 6, 4, 4, 1, 1].map((votes, i) => ({ id: `s${i}`, votes })), 4);
  assert.deepEqual(result.cutoffTieVotes, [4]);
});

test('FROZEN confirmation and publication use deterministic top-N selection, not dense rank', () => {
  assert.match(migration, /where e\.snapshot_id = p_snapshot_id\s+order by e\.vote_count desc, e\.submission_id\s+limit v_effective_finalists_count/s);
  assert.match(migration, /where snapshot_id = p_snapshot_id\s+order by vote_count desc, submission_id\s+limit v_effective_finalists_count/s);
  assert.match(migration, /v_snapshot\.status not in \('FROZEN', 'TIE_REQUIRES_DECISION', 'CONFIRMED'\)/);
  assert.match(migration, /v_inserted <> v_effective_finalists_count/);
});

test('tie and confirmation branches retain selected finalist IDs and publication metadata', () => {
  assert.match(migration, /unnest\(v_resolution\.selected_submission_ids\)/);
  assert.match(migration, /set status = 'PUBLISHED'/);
  assert.match(migration, /tie_requires_decision = false/);
});
