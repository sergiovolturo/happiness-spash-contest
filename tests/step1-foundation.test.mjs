import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CONTEST_STATUSES,
  validateCategoryFoundation,
  validateContestFoundation,
} from '../src/domain/foundation.mjs';

const migration = await readFile(
  new URL('../supabase/migrations/20260922000100_step1_domain_foundation.sql', import.meta.url),
  'utf8',
);

test('contest foundation exposes the complete lifecycle without correction expiry', () => {
  assert.deepEqual(CONTEST_STATUSES, [
    'DRAFT', 'SUBMISSIONS_OPEN', 'SUBMISSIONS_CLOSED', 'MODERATION',
    'READY_FOR_VOTING', 'VOTING_OPEN', 'VOTING_CLOSED',
    'CLOSED',
  ]);
  assert.doesNotMatch(migration, /correction_deadline|CORRECTION_EXPIRED/i);
  assert.doesNotMatch(migration, /FINALISTS_CONFIRMED|RETENTION|MEDIA_PURGED/i);
});

test('contest and category validation enforces foundation invariants', () => {
  assert.deepEqual(validateContestFoundation({ slug: 'winter', name: 'Winter Contest' }), []);
  assert.ok(validateContestFoundation({ slug: '', name: '' }).length >= 2);
  assert.ok(validateContestFoundation({
    slug: 'winter', name: 'Winter Contest',
    submissionsOpenAt: '2026-12-10T09:00:00Z',
    submissionsCloseAt: '2026-12-10T18:00:00Z',
    votingOpenAt: '2026-12-11T09:00:00Z',
    votingCloseAt: '2026-12-18T18:00:00Z',
  }).length === 0);
  assert.ok(validateContestFoundation({
    slug: 'winter', name: 'Winter Contest',
    submissionsCloseAt: '2026-12-12T09:00:00Z',
    votingOpenAt: '2026-12-11T09:00:00Z',
  }).some((error) => error.includes('submissionsCloseAt')));
  assert.ok(validateContestFoundation({
    slug: 'winter', name: 'Winter Contest', votingOpenAt: 'not-a-date',
  }).some((error) => error.includes('votingOpenAt')));
  assert.deepEqual(validateCategoryFoundation({
    contestId: 'contest-1', name: 'Open', slug: 'open', submissionCap: 10, finalistsCount: 4,
  }), []);
  assert.ok(validateCategoryFoundation({ contestId: 'x', name: 'Open', slug: 'open', submissionCap: 0, finalistsCount: 0 }).length >= 2);
});

test('migration models participation independently from category and preserves rejected cap', () => {
  assert.match(migration, /create table public\.contest_participations/i);
  assert.match(migration, /unique \(contest_id, identity_id\)/i);
  assert.doesNotMatch(migration, /contest_participations[\s\S]{0,1000}category_id/i);
  assert.match(migration, /submission_cap integer not null check \(submission_cap > 0\)/i);
  assert.match(migration, /finalists_count integer not null default 4/i);
});

test('migration contains foundation RLS for identity, contests, categories and participation', () => {
  for (const table of ['platform_identities', 'contests', 'contest_categories', 'contest_participations']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /contest_participations_insert_own/i);
  assert.match(migration, /contests_admin_all/i);
  assert.match(migration, /contest_categories_admin_all/i);
});

test('migration preserves identity ownership and delete semantics', () => {
  assert.match(migration, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(migration, /auth_user_id uuid unique references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /created_by uuid references public\.platform_identities\(id\) on delete set null/i);
  assert.match(migration, /contest_id uuid not null references public\.contests\(id\) on delete cascade/i);
  assert.match(migration, /identity_id uuid not null references public\.platform_identities\(id\) on delete restrict/i);
  assert.match(migration, /platform_identities_insert_self[\s\S]*?with check \(auth_user_id = auth\.uid\(\)\)/i);
  assert.match(migration, /contest_participations_insert_own[\s\S]*?pi\.auth_user_id = auth\.uid\(\)/i);
});

test('deleting an Auth user only detaches the mapping and cannot cascade history', () => {
  assert.doesNotMatch(migration, /references auth\.users\([^)]*\) on delete cascade/i);
  assert.match(migration, /auth_user_id uuid unique references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /identity_id uuid not null references public\.platform_identities\(id\) on delete restrict/i);
  assert.match(migration, /contest_participations[\s\S]*?identity_id uuid not null references public\.platform_identities/i);
});

test('migration does not introduce later-step tables or operations', () => {
  assert.doesNotMatch(migration, /create table public\.(submissions|media_assets|votes|moderation|finalists|contest_results)/i);
  assert.doesNotMatch(migration, /create (bucket|trigger|function)/i);
  assert.doesNotMatch(migration, /insert into|update public\.|delete from|alter table public\.admin_users/i);
});

test('public foundation reads expose contest metadata only, not participant data', () => {
  assert.doesNotMatch(migration, /create policy contests_select_published/i);
  assert.doesNotMatch(migration, /create policy contest_categories_select_published/i);
  assert.match(migration, /contest_participations_select_own_or_admin[\s\S]*?pi\.auth_user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /contest_participations_select_published/i);
});

test('foundation protects lifecycle ordering and keeps participation updates administrative', () => {
  assert.match(migration, /submissions_close_at <= voting_open_at/i);
  assert.doesNotMatch(migration, /contest_participations_update_own_or_admin/i);
  assert.match(migration, /contest_participations_admin_all/i);
});
