import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20261004073343_video_thumbnails.sql', import.meta.url),
  'utf8',
);
const bucketMigration = await readFile(
  new URL('../supabase/migrations/20261004080655_video_thumbnail_bucket.sql', import.meta.url),
  'utf8',
);
const cleanupMigration = await readFile(
  new URL('../supabase/migrations/20261004081011_video_thumbnail_legacy_cleanup.sql', import.meta.url),
  'utf8',
);

test('thumbnail storage is optional and scoped to finalized published media', () => {
  assert.match(migration, /deterministic media-id paths/i);
  assert.match(migration, /published_submission_media/);
  assert.match(migration, /submission_thumbnail_objects_insert[\s\S]+to authenticated/i);
  assert.match(migration, /published_submission_thumbnail_objects_select[\s\S]+to anon,authenticated/i);
  assert.match(migration, /sm\.status='FINALIZED'/i);
  assert.match(migration, /sm\.is_current/i);
  assert.doesNotMatch(migration, /drop table|delete from public\.submission_media|delete from storage\.objects/i);
});

test('thumbnails use an isolated private image bucket without broadening video storage', () => {
  assert.match(bucketMigration, /contest-thumbnails/);
  assert.match(bucketMigration, /public, allowed_mime_types/);
  assert.match(bucketMigration, /image\/webp/);
  assert.match(bucketMigration, /image\/jpeg/);
  assert.match(bucketMigration, /bucket_id='contest-thumbnails'/);
  assert.match(bucketMigration, /to authenticated/);
  assert.match(bucketMigration, /to anon,authenticated/);
  assert.doesNotMatch(bucketMigration, /bucket_id='contest-videos'/);
  assert.doesNotMatch(bucketMigration, /for update|for delete/i);
  assert.match(html, /const thumbnailStorageBucket='contest-thumbnails'/);
  assert.match(html, /from\(thumbnailStorageBucket\)\.upload/);
  assert.match(html, /from\(thumbnailStorageBucket\)\.download/);
});

test('legacy thumbnail cleanup removes only the two old contest-videos policies', () => {
  assert.match(cleanupMigration, /drop policy if exists submission_thumbnail_objects_insert on storage\.objects/i);
  assert.match(cleanupMigration, /drop policy if exists published_submission_thumbnail_objects_select on storage\.objects/i);
  assert.doesNotMatch(cleanupMigration, /drop bucket|delete from storage\.objects|alter table|drop policy(?! if exists)/i);
  assert.doesNotMatch(cleanupMigration, /contest_thumbnail_bucket_objects_insert|published_contest_thumbnail_bucket_objects_select/);
});

test('thumbnail generation uses a safe frame target and never becomes video upload validation', () => {
  assert.match(html, /Math\.min\(\.75,[\s\S]*video\.duration/);
  assert.match(html, /canvas\.toBlob\([\s\S]*image\/webp/);
  assert.match(html, /image\/jpeg/);
  assert.match(html, /async function uploadVideoThumbnail/);
  assert.match(html, /optional generation\/upload failed/);
  assert.match(html, /void uploadVideoThumbnail/);
});

test('public gallery uses a thumbnail when available and keeps the poster fallback', () => {
  assert.match(html, /thumbnailPathCandidates/);
  assert.match(html, /resolveGalleryThumbnail/);
  assert.match(html, /publicVideoPoster\.hasThumbnail/);
  assert.match(html, /classList\.add\('hasThumbnail'\)/);
  assert.match(html, /<span class="publicVideoPoster" aria-hidden="true">▶<\/span>/);
});

test('thumbnail failures do not alter the main upload/finalize flow', () => {
  assert.match(html, /handleMediaUploadBeforeThumbnail/);
  assert.match(html, /adminUploadAndFinalizeBeforeThumbnail/);
  assert.match(html, /await handleMediaUploadBeforeThumbnail\(event\)/);
  assert.match(html, /await adminUploadAndFinalizeBeforeThumbnail\(media,file,messageBox\)/);
  assert.doesNotMatch(html, /await uploadVideoThumbnail\(/);
});
