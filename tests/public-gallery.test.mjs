import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const galleryFlow = index.slice(index.indexOf('function clearGalleryObjectUrls'), index.indexOf('// New participant domain flow'));

test('public gallery is available without session and loads public Contest/categories', () => {
  assert.match(index, /if\(!session\)return render\(\)/);
  assert.match(index, /rpc\('get_public_contest'\)/);
  assert.match(index, /rpc\('get_public_contest_categories'/);
  assert.match(galleryFlow, /publicCategories/);
  assert.match(galleryFlow, /published_submission_media/);
});

test('gallery supports one category without a multi-category selector', () => {
  assert.match(galleryFlow, /publicCategories\.length>1\?/);
  assert.match(galleryFlow, /categoryVisualSlot/);
  assert.match(galleryFlow, /Nessun video pubblicato in questa categoria/);
});

test('gallery supports multiple real categories in backend order', () => {
  assert.match(galleryFlow, /publicCategories\.map\(category/);
  assert.match(galleryFlow, /data-gallery-category/);
  assert.match(galleryFlow, /gallerySelectedCategoryId/);
  assert.doesNotMatch(galleryFlow, /slot 1|slot 2|Smash più bello|Scambio più divertente/);
});

test('gallery filters publications by category_id and Contest id', () => {
  assert.match(galleryFlow, /eq\('contest_id',contestId\)/);
  assert.match(galleryFlow, /row\.category_id===selected\.id/);
  assert.match(galleryFlow, /row\.category_id\)\);/);
});

test('gallery uses only backend Storage bucket/path and public download', () => {
  assert.match(galleryFlow, /storage\.from\(row\.storage_bucket\)\.download\(row\.storage_path\)/);
  assert.doesNotMatch(galleryFlow, /createSignedUrl/);
  assert.doesNotMatch(galleryFlow, /from\(['"]videos['"]\)|from\(['"]votes['"]\)|contest_settings/);
  assert.doesNotMatch(galleryFlow, /contest-videos/);
  assert.doesNotMatch(galleryFlow, /from\(['"]submissions['"]\)|from\(['"]submission_media['"]\)|from\(['"]submission_publications['"]\)|from\(['"]storage\.objects['"]\)/);
});

test('gallery handles empty, unavailable and network-error states', () => {
  assert.match(galleryFlow, /galleryError/);
  assert.match(galleryFlow, /Media non disponibile/);
  assert.match(galleryFlow, /Non riesco a caricare la gallery/);
  assert.match(galleryFlow, /Nessuna categoria disponibile/);
  assert.match(galleryFlow, /galleryRows=\(data\|\|\[\]\)/);
});

test('gallery does not expose ranking or vote counts', () => {
  assert.doesNotMatch(galleryFlow, /ranking|classifica|conteggio|percentuale|vote_count/i);
});

test('gallery object URLs are cleaned up and stale downloads cannot update state', () => {
  assert.match(galleryFlow, /function clearGalleryObjectUrls\(\)/);
  assert.match(galleryFlow, /URL\.revokeObjectURL\(url\)/);
  assert.match(galleryFlow, /\+\+galleryRequestSeq/);
  assert.match(galleryFlow, /requestId!==galleryRequestSeq/);
  assert.match(galleryFlow, /URL\.revokeObjectURL\(url\);return ''/);
  assert.match(index, /galleryRequestSeq\+\+;clearGalleryObjectUrls\(\)/);
});

test('gallery rejects rows outside the current Contest and unknown categories', () => {
  assert.match(galleryFlow, /row\.contest_id===contestId/);
  assert.match(galleryFlow, /publicCategories\.some\(category=>category\.id===row\.category_id\)/);
});
