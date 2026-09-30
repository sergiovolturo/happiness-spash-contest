import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = index.indexOf('const publicVideoCardHtml=');
const helperEnd = index.indexOf('\nasync function galleryView', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'public video card helper must be present');
const helperSource = index.slice(helperStart, helperEnd);

function renderCard(row) {
  const context = {
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    fmt: value => `formatted:${value}`
  };
  vm.runInNewContext(`${helperSource}\nrender = publicVideoCardHtml;`, context);
  return context.render(row);
}

test('public video card uses candidate name, poster fallback and existing media click target', () => {
  const html = renderCard({ media_id: 'media-1', contestant_display_name: 'Matteo Volturo', published_at: '2026-09-29T11:19:55Z' });
  assert.match(html, /Matteo Volturo/);
  assert.match(html, /publicVideoPoster/);
  assert.match(html, /▶/);
  assert.match(html, /data-open-public-media="media-1"/);
  assert.match(html, /aria-label="Apri video di Matteo Volturo"/);
  assert.doesNotMatch(html, /Video pubblicato/);
  assert.doesNotMatch(html, /Guarda il video/);
});

test('public video card has a safe legacy fallback when candidate name is absent', () => {
  const html = renderCard({ media_id: 'media-2', contestant_display_name: '', published_at: '2026-09-29T11:19:59Z' });
  assert.match(html, /Nome candidato non disponibile/);
  assert.match(html, /publicVideoPoster/);
});

test('public card does not download media before the existing detail view is opened', () => {
  const galleryStart = index.indexOf('async function galleryView(renderRequestId=activeRenderRequestId)', helperStart);
  const gallery = index.slice(galleryStart, index.indexOf('\nasync function adminContestSurfaceLegacy', galleryStart));
  const beforeDetail = gallery.slice(0, gallery.indexOf('if(galleryActiveMediaId){'));
  assert.doesNotMatch(beforeDetail, /resolveGalleryMedia\(/);
  assert.match(gallery, /data-open-public-media/);
  assert.match(gallery, /resolveGalleryMedia\(row,requestId\)/);
});
