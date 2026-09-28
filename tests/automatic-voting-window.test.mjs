import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260928150822_automatic_voting_window.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('migration adds close provenance and a server-side processor', () => {
  assert.match(migration, /add column if not exists voting_closed_at timestamptz/i);
  assert.match(migration, /add column if not exists voting_close_reason text/i);
  assert.match(migration, /function public\.process_contest_voting_windows\(\)/i);
  assert.match(migration, /status = 'VOTING_CLOSED'/i);
  assert.match(migration, /voting_close_reason = coalesce\(voting_close_reason, 'DEADLINE'\)/i);
  assert.match(migration, /voting_close_reason = coalesce\(voting_close_reason, 'MANUAL'\)/i);
});

test('automatic opening is readiness and time guarded', () => {
  const start = migration.indexOf('create or replace function public._open_contest_voting_if_ready');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /v_contest\.status <> 'READY_FOR_VOTING'/i);
  assert.match(body, /voting_open_at is null or v_contest\.voting_close_at is null/i);
  assert.match(body, /now\(\) < v_contest\.voting_open_at or now\(\) >= v_contest\.voting_close_at/i);
  assert.match(body, /public\._contest_voting_readiness\(p_contest_id\)/i);
  assert.match(body, /set status = 'VOTING_OPEN'/i);
});

test('vote RPC rejects before and after the configured voting window', () => {
  const start = migration.indexOf('create or replace function public.cast_contest_vote');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /c\.status = 'VOTING_OPEN'/i);
  assert.match(body, /now\(\) >= c\.voting_open_at and now\(\) < c\.voting_close_at/i);
  assert.match(body, /message = 'voting_not_open'/i);
});

test('Admin configures both windows with Europe/Rome datetime-local helpers', () => {
  assert.match(index, /id="adminSubmissionWindow"/);
  assert.match(index, /id="adminVotingWindow"/);
  assert.match(index, /name="openAt" type="datetime-local"/);
  assert.match(index, /admin_set_voting_window/);
  assert.match(index, /romeLocalToTimestamptz\(f\.openAt\.value\)/);
  assert.match(index, /selected\?\.voting_open_at\?romeTimestamptzToLocal/);
});

test('READY_FOR_VOTING is automatic and exposes the configured schedule', () => {
  const start = index.indexOf('function adminLifecycleActions');
  const end = index.indexOf('\n', start);
  const actions = index.slice(start, end);
  assert.match(actions, /status==='READY_FOR_VOTING'/);
  assert.match(actions, /Pronto per la votazione/);
  assert.match(actions, /Apertura automatica/);
  assert.doesNotMatch(actions, /open_contest_voting.*Apri votazione/);
});

test('manual early close keeps the explicit confirmation and RPC', () => {
  assert.match(index, /Chiudere anticipatamente la votazione\? Dopo la chiusura non saranno accettati altri voti\./);
  assert.match(index, /rpc\('close_contest_voting'/);
});
