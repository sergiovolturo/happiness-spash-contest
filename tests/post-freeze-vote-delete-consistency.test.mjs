import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260922000514_post_freeze_vote_delete_consistency.sql', import.meta.url), 'utf8');

test('post-freeze deletion preserves audit and invalidates only derived results', () => {
  assert.match(migration, /insert into public\.vote_deletion_audits/i);
  assert.match(migration, /invalidated_at = now\(\)/i);
  assert.match(migration, /invalidation_reason = 'vote_deleted'/i);
  assert.doesNotMatch(migration, /delete from public\.vote_deletion_audits/i);
});

test('confirmed or published results reject vote deletion', () => {
  assert.match(migration, /v_snapshot_status in \('CONFIRMED', 'PUBLISHED'\)/i);
  assert.match(migration, /message = 'result_already_finalized'/i);
});

test('freeze is idempotent for a valid snapshot and creates a new one after invalidation', () => {
  assert.match(migration, /invalidated_at is null/i);
  assert.match(migration, /create unique index contest_result_snapshots_active_contest_category_uidx/i);
  assert.match(migration, /insert into public\.contest_result_snapshots/i);
});

test('new freeze recomputes ranking and vote counts from contest_votes', () => {
  assert.match(migration, /left join public\.contest_votes cv/i);
  assert.match(migration, /count\(cv\.id\)::bigint as vote_count/i);
  assert.match(migration, /dense_rank\(\) over \(order by c\.vote_count desc\)/i);
  assert.doesNotMatch(migration, /update public\.contest_result_entries[\s\S]*set vote_count/i);
});

test('invalid snapshots cannot resolve ties or be confirmed', () => {
  assert.match(migration, /v_snapshot\.invalidated_at is not null[\s\S]*snapshot_invalidated/i);
  assert.match(migration, /create or replace function public\.resolve_contest_result_tie/i);
  assert.match(migration, /create or replace function public\.confirm_contest_finalists/i);
});

test('old tie resolutions remain historical and are not reused by a new snapshot', () => {
  assert.doesNotMatch(migration, /delete from public\.contest_tie_resolutions/i);
  assert.match(migration, /where snapshot_id = p_snapshot_id/i);
  assert.match(migration, /insert into public\.contest_result_snapshots/i);
});

test('all overridden functions retain secure execution and explicit ACLs', () => {
  for (const name of ['delete_contest_vote', 'freeze_contest_results', 'resolve_contest_result_tie', 'confirm_contest_finalists']) {
    const body = migration.slice(migration.indexOf(`create or replace function public.${name}`));
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path to ''/i);
  }
  assert.match(migration, /grant execute on function public\.delete_contest_vote\(uuid, text\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.freeze_contest_results\(uuid\) to authenticated/i);
});
