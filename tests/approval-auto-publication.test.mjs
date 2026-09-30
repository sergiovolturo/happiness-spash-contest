import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260930000500_approval_auto_publication.sql', import.meta.url),
  'utf8',
);

test('approval publishes finalized media and preserves the publication audit model', () => {
  assert.match(migration, /insert into public\.submission_publications/i);
  assert.match(migration, /v_decision = 'APPROVED'[\s\S]*?v_media\.id/i);
  assert.match(migration, /published_by_auth_user_id/i);
  assert.match(migration, /not exists \([\s\S]*submission_publications/i);
  assert.match(migration, /revoked_at is null/i);
});

test('approved records are backfilled idempotently and the public view exposes context', () => {
  assert.match(migration, /where s\.status = 'APPROVED'[\s\S]*?sm\.status = 'FINALIZED'[\s\S]*?sm\.is_current/i);
  assert.match(migration, /not exists \([\s\S]*submission_publications/i);
  assert.match(migration, /create view public\.published_submission_media/i);
  assert.match(migration, /s\.contestant_display_name/i);
  assert.match(migration, /cc\.name as category_name/i);
});

test('opening voting preserves existing publications and never creates ordinary publications', () => {
  const opening = migration.slice(migration.indexOf('create or replace function public._open_contest_voting_if_ready'));
  assert.doesNotMatch(opening, /insert into public\.submission_publications/i);
  assert.match(opening, /v_missing_publication_count/i);
  assert.match(opening, /set status = 'VOTING_OPEN'/i);
  assert.doesNotMatch(opening, /published_at\s*=\s*now\(\)/i);
});

test('approval rejection revokes before voting and blocks it during competition', () => {
  const moderation = migration.slice(migration.indexOf('create or replace function public.moderate_submission'));
  assert.match(moderation, /v_submission\.status not in \('PENDING', 'APPROVED'\)/i);
  assert.match(moderation, /v_submission\.status = 'APPROVED'[\s\S]*v_contest\.status in \([\s\S]*'VOTING_OPEN'/i);
  assert.match(moderation, /update public\.submission_publications[\s\S]*revoked_at = now\(\)/i);
  assert.doesNotMatch(moderation, /storage\.|delete from public\.submission_media|delete from storage/i);
});

test('security posture remains explicit', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path to ''/i);
  assert.match(migration, /revoke all on function public\.moderate_submission\(uuid,text,text\) from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.moderate_submission\(uuid,text,text\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.open_contest_voting\(uuid\) from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.open_contest_voting\(uuid\) to authenticated/i);
});
