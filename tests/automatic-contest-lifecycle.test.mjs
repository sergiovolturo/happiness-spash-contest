import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260930114856_automatic_contest_lifecycle.sql'),
  'utf8'
);
const scheduler = migration.slice(migration.indexOf('create or replace function public.process_contest_voting_windows'));
const vote = migration.slice(migration.indexOf('create or replace function public.cast_contest_vote'));

test('scheduler closes submissions after submissions_close_at', () => {
  assert.match(scheduler, /status = 'SUBMISSIONS_CLOSED'/i);
  assert.match(scheduler, /status = 'SUBMISSIONS_OPEN'[\s\S]*submissions_close_at is not null[\s\S]*submissions_close_at <= now\(\)/i);
});

test('scheduler opens voting from every legacy pre-voting state', () => {
  assert.match(scheduler, /status in \([\s\S]*'SUBMISSIONS_OPEN'[\s\S]*'SUBMISSIONS_CLOSED'[\s\S]*'MODERATION'[\s\S]*'READY_FOR_VOTING'[\s\S]*\)/i);
  assert.match(scheduler, /set status = 'VOTING_OPEN'[\s\S]*voting_open_at <= now\(\)/i);
  assert.doesNotMatch(scheduler, /_open_contest_voting_if_ready/);
});

test('PENDING rows do not block scheduled voting', () => {
  assert.doesNotMatch(scheduler, /(?:count|where|and)[^;\n]*PENDING/i);
  assert.match(scheduler, /PENDING rows remain PENDING/i);
});

test('approved eligibility remains enforced by the authoritative vote RPC', () => {
  assert.match(vote, /s\.status = 'APPROVED'/i);
  assert.match(vote, /c\.status = 'VOTING_OPEN'/i);
  assert.match(vote, /now\(\) >= c\.voting_open_at[\s\S]*now\(\) < c\.voting_close_at/i);
  assert.match(vote, /sp\.revoked_at is null[\s\S]*sm\.status = 'FINALIZED'[\s\S]*sm\.is_current/i);
});

test('scheduler closes voting even when an intermediate lifecycle state was missed', () => {
  assert.match(scheduler, /status = 'VOTING_CLOSED'[\s\S]*status in \([\s\S]*'SUBMISSIONS_OPEN'[\s\S]*'SUBMISSIONS_CLOSED'[\s\S]*'MODERATION'[\s\S]*'READY_FOR_VOTING'[\s\S]*'VOTING_OPEN'/i);
  assert.match(scheduler, /voting_close_at <= now\(\)/i);
});

test('scheduler updates are guarded and repeatable', () => {
  const updates = [...scheduler.matchAll(/update public\.contests[\s\S]*?;/gi)].map(match => match[0]);
  assert.equal(updates.length, 3);
  for (const update of updates) assert.match(update, /where status/i);
  assert.match(scheduler, /voting_closed_at = coalesce\(voting_closed_at, now\(\)\)/i);
});

test('late approval remains separate from scheduler and does not create approval logic', () => {
  assert.doesNotMatch(scheduler, /moderate_submission|submission_publications|status = 'APPROVED'/i);
});

