import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const galleryStart = index.lastIndexOf('async function galleryView');
const galleryEnd = index.indexOf('\nasync function updateSettings', galleryStart);
const gallery = index.slice(galleryStart, galleryEnd);

test('public mobile category cards use only real backend categories and published media counts', () => {
  assert.match(gallery, /publicCategories\.length>1/);
  assert.match(gallery, /galleryRows\.filter\(r=>r\.contest_id===publicContest\.id&&r\.category_id===c\.id\)\.length/);
  assert.match(gallery, /data-public-category/);
  assert.match(gallery, /Guarda i video/);
  assert.match(gallery, /display_order|publicCategories\.map/);
  assert.doesNotMatch(gallery, /vote_count|voter|ranking|classifica/i);
  assert.match(index, /categoryCount/);
  assert.match(index, /categoryCard:focus-visible/);
});

test('a single category opens its video list directly and player has a return action', () => {
  assert.match(gallery, /if\(publicCategories\.length===1\)gallerySelectedCategoryId=publicCategories\[0\]\.id/);
  assert.match(gallery, /galleryActiveMediaId/);
  assert.match(index, /backPublicVideos/);
});

test('video cards are placeholders with on-demand playback; opening the gallery does not download all videos', () => {
  assert.match(gallery, /publicVideoCard/);
  assert.match(gallery, /data-open-public-media/);
  assert.match(gallery, /resolveGalleryMedia\(row,requestId\)/);
  assert.match(index, /storage\.from\(row\.storage_bucket\)\.download\(row\.storage_path\)/);
  assert.doesNotMatch(gallery.slice(0, gallery.indexOf('if(galleryActiveMediaId){')), /resolveGalleryMedia/);
  assert.doesNotMatch(gallery, /createSignedUrl|from\(['"]submission_media['"]\)|from\(['"]submission_publications['"]\)|from\(['"]submissions['"]\)/);
  assert.doesNotMatch(gallery.slice(0, gallery.indexOf('if(galleryActiveMediaId){')), /<video/);
});

test('every public gallery visit refreshes publication view so revoked media disappear', () => {
  assert.match(index, /async function homeView\(\)\{await loadPublicGallery\(true\)/);
  assert.match(index, /published_submission_media/);
  assert.match(index, /clearGalleryObjectUrls\(\)/);
});

test('category visual slot remains extensible without adding unapproved assets', () => {
  assert.match(index, /categoryVisualSlot/);
  assert.doesNotMatch(gallery, /image_url|cover_url|icon_url|color_theme/);
});

test('public category and video surfaces are touch-sized and single-column on mobile', () => {
  assert.match(index, /\.categorySelector\{display:grid/);
  assert.match(index, /\.publicVideoGrid\{grid-template-columns:repeat\(auto-fit,minmax\(220px,1fr\)/);
  assert.match(index, /\.categorySelector,\.publicVideoGrid,\.galleryGrid\{grid-template-columns:1fr\}/);
  assert.match(index, /\.publicVideoCard\{min-height:190px/);
});
