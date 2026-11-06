import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function pngDimensions(path) {
  const bytes = fs.readFileSync(new URL(path.replace(/^\.\.\//, './'), root));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('manifest is rooted, standalone and declares the required icons', () => {
  assert.equal(manifest.name, 'Happiness SPASH Contest');
  assert.equal(manifest.short_name, 'SPASH Contest');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#111111');
  assert.equal(manifest.background_color, '#111111');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512', '512x512']);
  assert.equal(manifest.icons.filter(icon => icon.purpose === 'maskable').length, 1);
  assert.ok(manifest.icons.every(icon => icon.src.startsWith('/assets/')));
});

test('generated PWA assets have their declared dimensions', () => {
  assert.deepEqual(pngDimensions('../assets/pwa-icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions('../assets/pwa-icon-512.png'), { width: 512, height: 512 });
  assert.deepEqual(pngDimensions('../assets/pwa-icon-512-maskable.png'), { width: 512, height: 512 });
  assert.deepEqual(pngDimensions('../assets/favicon-32.png'), { width: 32, height: 32 });
  assert.deepEqual(pngDimensions('../assets/apple-touch-icon.png'), { width: 180, height: 180 });
});

test('index links the manifest, app icons and registers the service worker', () => {
  assert.match(index, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
  assert.match(index, /name="theme-color" content="#111111"/);
  assert.match(index, /rel="icon"[^>]+href="\/assets\/favicon-32\.png"/);
  assert.match(index, /rel="apple-touch-icon"[^>]+href="\/assets\/apple-touch-icon\.png"/);
  assert.match(index, /navigator\.serviceWorker\.register\('\/sw\.js',\{scope:'\/'\}\)/);
});

test('service worker is pass-through and has no application or Supabase cache', () => {
  assert.match(worker, /skipWaiting/);
  assert.match(worker, /clients\.claim/);
  assert.doesNotMatch(worker, /caches\.|cacheName|addAll|fetch\s*\(/i);
  assert.doesNotMatch(worker, /supabase|rest\/v1|auth\/v1|storage\/v1|functions\/v1/i);
});

test('PWA tranche leaves application configuration and domain behavior out of the worker', () => {
  assert.doesNotMatch(worker, /contest|vote|submission|admin|hall/i);
  assert.match(index, /pkaadvqyrdxgymzzugvo\.supabase\.co/);
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /get_public_hall_of_fame/);
});
