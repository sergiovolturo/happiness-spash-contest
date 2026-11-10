import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('public Contest categories load concurrently with one request-scoped stale guard', () => {
  assert.match(html, /const categoryResults=await Promise\.all\(rows\.map\(contest=>supabase\.rpc\('get_public_contest_categories'/);
  assert.match(html, /if\(requestId&&!renderIsCurrent\(requestId\)\)return false;/);
  assert.match(html, /categoryResults\.forEach\(\(categories,index\)=>/);
  assert.doesNotMatch(html, /for\(const contest of rows\)\{const categories=await supabase\.rpc\('get_public_contest_categories'/);
});

test('public gallery cards stay poster-first and only resolve video on detail open', () => {
  const wrapperStart = html.indexOf('const galleryViewBeforeThumbnails=galleryView;');
  const galleryStart = html.lastIndexOf('galleryView=async function(requestId=activeRenderRequestId){', wrapperStart);
  const gallery = html.slice(galleryStart, html.indexOf('const handleMediaUploadBeforeThumbnail', wrapperStart));
  assert.ok(galleryStart >= 0 && gallery.length > 0);
  assert.match(gallery, /data-open-public-media/);
  assert.match(gallery, /resolveGalleryMedia\(row,request\)/);
  assert.doesNotMatch(gallery, /Promise\.all\(rows\.map\(async row=>\{const url=await resolveGalleryMedia/);
  assert.match(gallery, /resolveGalleryThumbnail\(row,galleryRequestSeq\)/);
});

test('public thumbnail and video URLs are cached and invalidated with gallery state', () => {
  assert.match(html, /galleryObjectUrls=new Map\(\)/);
  assert.match(html, /galleryThumbnailUrls=new Map\(\)/);
  assert.match(html, /galleryThumbnailRequests=new Map\(\)/);
  assert.match(html, /galleryThumbnailMisses=new Set\(\)/);
  assert.match(html, /galleryRequestSeq\+\+/);
  assert.match(html, /clearGalleryObjectUrls\(\)/);
});

test('public media reads the resolved thumbnail path and avoids speculative extension probes', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261110103000_public_thumbnail_paths.sql', import.meta.url), 'utf8');
  assert.match(html, /thumbnail_bucket,thumbnail_path/);
  assert.match(html, /Object\.prototype\.hasOwnProperty\.call\(row,'thumbnail_path'\)/);
  assert.match(migration, /left join storage\.objects tw/i);
  assert.match(migration, /left join storage\.objects tj/i);
  assert.match(migration, /coalesce\(tw\.name, tj\.name\) as thumbnail_path/i);
  assert.doesNotMatch(html, /thumbnailPathCandidates.*Promise\.all|storage\.from\(thumbnailStorageBucket\)\.download\([^)]*\.webp[^)]*\).*\.jpg/i);
});

test('thumbnail view replacement preserves dependencies, grants and historical column order', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261110103000_public_thumbnail_paths.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace view public\.published_submission_media as/i);
  assert.doesNotMatch(migration, /drop view|cascade/i);
  assert.doesNotMatch(migration, /published_contest_thumbnail_bucket_objects_select/i);
  assert.doesNotMatch(migration, /\b(?:revoke|grant)\s+(?:all|select|insert|update|delete|usage)/i);
  const selectList = migration.match(/select([\s\S]*?)from public\.submission_publications/i)?.[1] || '';
  const columns = ['sp.id as publication_id','sp.submission_id','sp.media_id','cc.contest_id','s.category_id','s.contestant_display_name','cc.name as category_name','sp.published_at','sm.storage_bucket','sm.storage_path','thumbnail_bucket','thumbnail_path'];
  let previous = -1;
  for (const column of columns) {
    const position = selectList.indexOf(column);
    assert.ok(position > previous, `column order missing or changed: ${column}`);
    previous = position;
  }
});
