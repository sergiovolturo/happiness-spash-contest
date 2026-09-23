import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000400_step4_publication_readiness.sql', import.meta.url),
  'utf8',
);

test('publication is version-specific, revocable and separate from submission status', () => {
  assert.match(migration, /create table public\.submission_publications/i);
  assert.match(migration, /submission_id uuid not null[\s\S]*?references public\.submissions\(id\) on delete restrict/i);
  assert.match(migration, /media_id uuid not null[\s\S]*?references public\.submission_media\(id\) on delete restrict/i);
  assert.match(migration, /published_by_auth_user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /revoked_by_auth_user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /create unique index submission_publications_active_uidx[\s\S]*?where revoked_at is null/i);
  assert.match(migration, /create unique index submission_publications_submission_media_uidx/i);
  assert.doesNotMatch(migration, /alter type public\.submission_status|add value.*PUBLISHED/i);
});

test('readiness is fail-closed and distinguishes valid rejection from unresolved approval', () => {
  assert.match(migration, /create or replace function public\.open_contest_voting\(/i);
  assert.match(migration, /v_contest\.status not in \('MODERATION', 'READY_FOR_VOTING'\)/i);
  assert.match(migration, /count\(\*\) filter \(where s\.status = 'APPROVED'\)/i);
  assert.match(migration, /count\(\*\) filter \([\s\S]*s\.status = 'PENDING'/i);
  assert.match(migration, /count\(\*\) filter \([\s\S]*s\.status in \('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'\)/i);
  assert.match(migration, /sm\.status = 'FINALIZED'[\s\S]*sm\.is_current/i);
  assert.match(migration, /v_approved_count = 0[\s\S]*v_pending_count > 0[\s\S]*v_inconsistent_count > 0[\s\S]*v_missing_media_count > 0/i);
  assert.match(migration, /message = 'contest_not_ready'/i);
});

test('opening voting publishes all and only approved current finalized media atomically', () => {
  assert.match(migration, /insert into public\.submission_publications/i);
  assert.match(migration, /where s\.status = 'APPROVED'/i);
  assert.match(migration, /join public\.submission_media sm[\s\S]*?sm\.status = 'FINALIZED'[\s\S]*?sm\.is_current/i);
  assert.match(migration, /set status = 'VOTING_OPEN'/i);
  assert.match(migration, /if v_contest\.status = 'VOTING_OPEN' then[\s\S]*return v_contest/i);
  assert.doesNotMatch(migration, /create table public\.(votes|rankings|finalists|contest_results)/i);
});

test('revoke is Admin-only, reasoned, historical and safely idempotent', () => {
  assert.match(migration, /create or replace function public\.revoke_published_submission\(/i);
  assert.match(migration, /message = 'admin_required'/i);
  assert.match(migration, /message = 'revoke_reason_required'/i);
  assert.match(migration, /if v_publication\.revoked_at is not null then[\s\S]*return v_publication/i);
  assert.match(migration, /set revoked_at = now\(\)/i);
  assert.match(migration, /revoked_by_auth_user_id = v_auth_user_id/i);
  assert.match(migration, /revoke_reason = btrim\(p_revoke_reason\)/i);
  assert.match(migration, /revoke execute on function public\.revoke_published_submission\(uuid, text\) from public, anon/i);
});

test('publication RLS and Storage exposure are limited to active non-revoked records', () => {
  assert.match(migration, /alter table public\.submission_publications enable row level security/i);
  assert.doesNotMatch(migration, /create policy submission_publications_select_active/i);
  assert.match(migration, /revoke all on table public\.submission_publications from anon/i);
  assert.match(migration, /revoke all on table public\.submission_publications from authenticated/i);
  assert.match(migration, /create policy submission_publications_select_admin[\s\S]*?to authenticated/i);
  assert.match(migration, /create view public\.published_submission_media[\s\S]*?sp\.id as publication_id[\s\S]*?sp\.submission_id[\s\S]*?sp\.media_id[\s\S]*?sp\.published_at/i);
  assert.match(migration, /where sp\.revoked_at is null[\s\S]*?sm\.status = 'FINALIZED'[\s\S]*?sm\.is_current/i);
  assert.match(migration, /grant select on public\.published_submission_media to anon, authenticated/i);
  assert.match(migration, /revoke all on public\.published_submission_media from public, anon, authenticated/i);
  const publicView = migration.slice(
    migration.indexOf('create view public.published_submission_media'),
    migration.indexOf('create or replace function public.open_contest_voting'),
  );
  assert.doesNotMatch(publicView, /published_by_auth_user_id|revoked_by_auth_user_id|revoke_reason/i);
  assert.match(migration, /create policy published_submission_media_objects_select[\s\S]*?to anon, authenticated/i);
  assert.match(migration, /create or replace function public\.storage_object_is_published\(/i);
  assert.match(migration, /grant execute on function public\.storage_object_is_published\(text, text\) to anon, authenticated/i);
  assert.match(migration, /storage_object_is_published\(storage\.objects\.bucket_id, storage\.objects\.name\)/i);
  assert.doesNotMatch(migration, /update storage\.buckets|public\s*=\s*true|drop policy|alter policy/i);
});

test('Admin RPC grants are explicit and no later voting domain is introduced', () => {
  assert.match(migration, /revoke execute on function public\.open_contest_voting\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.open_contest_voting\(uuid\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.revoke_published_submission\(uuid, text\) to authenticated/i);
  assert.doesNotMatch(migration, /create table public\.(votes|vote_counts|rankings|finalists|contest_results)/i);
});

test('Step 4 does not modify previous schemas or legacy objects', () => {
  assert.doesNotMatch(migration, /alter table public\.(admin_users|profiles|videos|votes|contest_settings|platform_identities|contests|contest_categories|contest_participations|submissions|submission_media)/i);
  assert.doesNotMatch(migration, /private\.handle_new_user|on_auth_user_created/i);
  assert.doesNotMatch(migration, /create bucket|storage\.buckets/i);
});
