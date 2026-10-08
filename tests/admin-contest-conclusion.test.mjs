import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20261008130000_admin_contest_conclusion.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('conclusion RPC is Admin-only and returns the Contest row', () => {
  assert.match(migration, /create or replace function public\.admin_conclude_contest\(\s*p_contest_id uuid\s*\)/i);
  assert.match(migration, /returns public\.contests/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.admin_conclude_contest\(uuid\)\s+from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.admin_conclude_contest\(uuid\)\s+to authenticated/i);
});

test('conclusion rejects unauthorized, archived, locked and incompatible Contests', () => {
  assert.match(migration, /message = 'admin_required'/i);
  assert.match(migration, /message = 'contest_archived'/i);
  assert.match(migration, /message = 'contest_archive_locked'/i);
  assert.match(migration, /status not in \('VOTING_CLOSED', 'CLOSED'\)/i);
  assert.match(migration, /message = 'contest_not_ready_to_conclude'/i);
});

test('required active categories block conclusion without a winner', () => {
  assert.match(migration, /cc\.is_active[\s\S]*cc\.winner_required/i);
  assert.match(migration, /not exists \([\s\S]*from public\.contest_winners cw/i);
  assert.match(migration, /message = 'winner_required_missing'/i);
  assert.match(migration, /winner_required/);
});

test('winner validity is rechecked against the published finalist snapshot', () => {
  for (const fragment of ['contest_finalists', 'contest_result_snapshots', 'cf.published_at is not null', 'cf.published_by_auth_user_id is not null', "crs.status = 'PUBLISHED'", 'crs.invalidated_at is null', 's.category_id = cw.category_id']) {
    assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(migration, /message = 'winner_not_valid_published_finalist'/i);
});

test('valid completion transitions only VOTING_CLOSED to CLOSED and remains idempotent', () => {
  assert.match(migration, /if v_contest\.status = 'CLOSED' then[\s\S]*return v_contest/i);
  assert.match(migration, /set status = 'CLOSED', updated_at = now\(\)/i);
  assert.doesNotMatch(migration, /admin_select_contest_winner\(/i);
});

test('Admin results loads winners and exposes selection/conclusion UI', () => {
  assert.match(index, /from\('contest_winners'\)\.select\(/);
  assert.match(index, /admin_select_contest_winner/);
  assert.match(index, /admin_conclude_contest/);
  assert.match(index, /Vincitore finale/);
  assert.match(index, /Seleziona vincitore finale/);
  assert.match(index, /Cambia vincitore finale/);
  assert.match(index, /Concludi Contest/);
  assert.match(index, /Contest concluso/);
  assert.match(index, /winner_required/);
});

test('winner UI is limited to published official finalists and keeps submission id internal', () => {
  assert.match(index, /item\.published_at&&item\.published_by_auth_user_id/);
  assert.match(index, /item\.contest_id===adminSelectedContest\?\.id/);
  assert.match(index, /item\.category_id===category\.id/);
  assert.match(index, /data-winner-selection/);
  assert.doesNotMatch(index.slice(index.indexOf('const adminWinnerConclusionMarkup'), index.indexOf('const adminCompactResultsMarkupWithoutWinner')), /vote_count|rank_position/);
});

test('existing finalist and voting RPCs remain in the Admin surface', () => {
  for (const name of ['close_contest_voting', 'freeze_contest_results', 'resolve_contest_result_tie', 'publish_contest_finalists']) {
    assert.match(index, new RegExp(`rpc\\('${name}'`));
  }
});
