import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SUBMISSION_STATUSES, validateSubmissionFoundation } from '../src/domain/foundation.mjs';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000200_step2_submissions.sql', import.meta.url),
  'utf8',
);

test('domain contract mirrors submission states and required ownership keys', () => {
  assert.deepEqual(SUBMISSION_STATUSES, ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']);
  assert.deepEqual(validateSubmissionFoundation({
    participationId: 'participation-1', categoryId: 'category-1',
  }), []);
  assert.ok(validateSubmissionFoundation({ participationId: '', categoryId: '' }).length >= 2);
  assert.ok(validateSubmissionFoundation({
    participationId: 'p', categoryId: 'c', status: 'PUBLISHED',
  }).some((error) => error.includes('status')));
});

test('step 2 follows step 1 and defines only submission states in scope', () => {
  assert.match(migration, /create type public\.submission_status as enum/i);
  assert.deepEqual(
    [...migration.matchAll(/'([A-Z_]+)'/g)].map(([_, value]) => value).filter((value) =>
      ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(value),
    ).slice(0, 5),
    ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'],
  );
  assert.doesNotMatch(migration, /'CORRECTION_EXPIRED'|'PUBLISHED'|'VOTING'|'RANKING'|'FINALISTS_CONFIRMED'|'RETENTION'|'MEDIA_PURGED'/i);
});

test('submission schema preserves category ownership and historical rows', () => {
  assert.match(migration, /create table public\.submissions/i);
  assert.match(migration, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(migration, /participation_id uuid not null[\s\S]*?references public\.contest_participations\(id\) on delete restrict/i);
  assert.match(migration, /category_id uuid not null[\s\S]*?references public\.contest_categories\(id\) on delete restrict/i);
  assert.match(migration, /status public\.submission_status not null default 'PENDING'/i);
  assert.match(migration, /created_at timestamptz not null default now\(\)/i);
  assert.match(migration, /updated_at timestamptz not null default now\(\)/i);
});

test('partial uniqueness keeps rejected submissions in the cap and frees withdrawn/cancelled', () => {
  assert.match(migration, /create unique index submissions_active_pair_uidx/i);
  assert.match(migration, /on public\.submissions \(participation_id, category_id\)[\s\S]*?where status in \('PENDING', 'APPROVED', 'REJECTED'\)/i);
  assert.match(migration, /status in \('PENDING', 'APPROVED', 'REJECTED'\)/i);
  assert.doesNotMatch(migration, /unique \(participation_id, category_id\)/i);
});

test('RLS allows reads only to owner/admin and blocks generic player writes', () => {
  assert.match(migration, /alter table public\.submissions enable row level security/i);
  assert.match(migration, /create policy submissions_select_own_or_admin[\s\S]*?pi\.auth_user_id = auth\.uid\(\)/i);
  assert.match(migration, /revoke insert, update, delete on table public\.submissions from authenticated/i);
  assert.doesNotMatch(migration, /create policy submissions_(insert|update|delete)_/i);
});

test('atomic RPC is hardened, authorized and category-serialized', () => {
  assert.match(migration, /create or replace function public\.create_submission\(/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path to ''/i);
  assert.match(migration, /from public\.contest_categories cc[\s\S]*?for update/i);
  assert.match(migration, /select cp\.\*[\s\S]*?into v_participation[\s\S]*?from public\.contest_participations/i);
  assert.match(migration, /select pi\.auth_user_id[\s\S]*?into v_identity_auth_user_id/i);
  assert.doesNotMatch(migration, /select cp\.\*, pi\.auth_user_id[\s\S]*?into v_participation, v_identity_auth_user_id/i);
  assert.match(migration, /auth_user_id is distinct from v_auth_user_id/i);
  assert.match(migration, /v_participation\.status <> 'ACTIVE'/i);
  assert.match(migration, /v_participation\.contest_id <> v_category\.contest_id/i);
  assert.match(migration, /c\.status = 'SUBMISSIONS_OPEN'/i);
  assert.match(migration, /v_occupied_count >= v_category\.submission_cap/i);
  assert.match(migration, /revoke execute on function public\.create_submission\(uuid, uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.create_submission\(uuid, uuid\) to authenticated/i);
});

test('RPC exposes distinguishable domain failures and no later-step objects', () => {
  for (const code of [
    'unauthorized',
    'category_inactive',
    'participation_not_active',
    'contest_category_mismatch',
    'contest_not_open',
    'submission_already_exists',
    'category_full',
  ]) assert.match(migration, new RegExp(`message = '${code}'`));
  assert.doesNotMatch(migration, /create table public\.(media_assets|votes|moderation|finalists|contest_results)/i);
  assert.doesNotMatch(migration, /create (bucket|trigger)/i);
});

test('Step 2 remains incremental and does not alter Step 1 or legacy objects', () => {
  assert.doesNotMatch(migration, /alter table public\.(admin_users|profiles|videos|votes|contest_settings)/i);
  assert.doesNotMatch(migration, /private\.handle_new_user|on_auth_user_created/i);
  assert.doesNotMatch(migration, /supabase\.storage|storage\.objects/i);
});
