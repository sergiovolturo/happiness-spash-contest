import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260922000508_public_media_path_surface.sql', import.meta.url), 'utf8');
const aclHardening = fs.readFileSync(new URL('../supabase/migrations/20260922000509_public_media_acl_hardening.sql', import.meta.url), 'utf8');
const categoryContext = fs.readFileSync(new URL('../supabase/migrations/20260922000510_public_media_category_context.sql', import.meta.url), 'utf8');
const contextAcl = fs.readFileSync(new URL('../supabase/migrations/20260922000511_public_media_context_acl_hardening.sql', import.meta.url), 'utf8');
const step4 = fs.readFileSync(new URL('../supabase/migrations/20260922000400_step4_publication_readiness.sql', import.meta.url), 'utf8');
const acl = fs.readFileSync(new URL('../supabase/migrations/20260922000401_step4_acl_hardening.sql', import.meta.url), 'utf8');

test('public media surface exposes only active publication identifiers and Storage coordinates', () => {
  assert.match(migration, /sp\.id as publication_id/);
  assert.match(migration, /sp\.submission_id/);
  assert.match(migration, /sp\.media_id/);
  assert.match(migration, /sp\.published_at/);
  assert.match(migration, /sm\.storage_bucket/);
  assert.match(migration, /sm\.storage_path/);
  assert.match(migration, /sp\.revoked_at is null/);
  assert.match(migration, /sm\.status = 'FINALIZED'/);
  assert.match(migration, /sm\.is_current/);
  assert.doesNotMatch(migration, /revoke_reason|published_by_auth_user_id|revoked_by_auth_user_id|email|moderation/);
});

test('public media surface has explicit least-privilege ACLs', () => {
  assert.match(migration, /revoke all on public\.published_submission_media from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on public\.published_submission_media to anon, authenticated/);
  assert.match(step4, /revoke all on public\.published_submission_media from public, anon, authenticated/);
  assert.match(acl, /revoke all on public\.published_submission_media from public, anon, authenticated/);
});

test('underlying administrative tables remain without public direct SELECT', () => {
  assert.match(step4, /revoke all on table public\.submission_publications from anon/);
  assert.match(step4, /revoke all on table public\.submission_publications from authenticated/);
  assert.match(acl, /revoke all on public\.published_submission_media from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant select on (table )?public\.submission_(media|publications)/);
  assert.match(aclHardening, /revoke all on table public\.submissions from anon/);
  assert.match(aclHardening, /revoke all on table public\.submission_media from anon/);
  assert.match(aclHardening, /revoke all on table public\.submission_publications from anon/);
});

test('Storage remains private and publication helper remains the object gate', () => {
  assert.match(step4, /bucket_id = 'contest-videos'/);
  assert.match(step4, /public\.storage_object_is_published\(storage\.objects\.bucket_id, storage\.objects\.name\)/);
  assert.match(step4, /grant select on public\.published_submission_media to anon, authenticated/);
});

test('public media surface derives Contest and category context server-side', () => {
  assert.match(categoryContext, /cc\.contest_id/);
  assert.match(categoryContext, /s\.category_id/);
  assert.match(categoryContext, /join public\.contest_categories cc/);
  assert.match(categoryContext, /join public\.contest_participations cp/);
  assert.match(categoryContext, /cp\.contest_id = cc\.contest_id/);
  assert.match(categoryContext, /sp\.revoked_at is null/);
  assert.match(categoryContext, /sm\.status = 'FINALIZED'/);
  assert.match(categoryContext, /sm\.is_current/);
  assert.doesNotMatch(categoryContext, /identity|email|moderation|revoke_reason|vote|finalist/i);
});

test('category context preserves the minimal public column set and ACL', () => {
  for (const column of ['publication_id', 'submission_id', 'media_id', 'contest_id', 'category_id', 'published_at', 'storage_bucket', 'storage_path']) {
    assert.match(categoryContext, new RegExp(`as ${column}|${column}`));
  }
  assert.match(categoryContext, /revoke all on public\.published_submission_media from public, anon, authenticated, service_role/);
  assert.match(categoryContext, /grant select on public\.published_submission_media to anon, authenticated/);
  assert.doesNotMatch(categoryContext, /grant select on (table )?public\.(submissions|submission_media|submission_publications|contest_participations)/);
  assert.match(contextAcl, /revoke all on table public\.contest_participations from anon/);
});
