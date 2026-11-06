import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import zlib from 'node:zlib';

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

function readRgbaPng(path) {
  const bytes = fs.readFileSync(new URL(path.replace(/^\.\.\//, './'), root));
  let offset = 8;
  let width;
  let height;
  let colorType;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      colorType = payload[9];
    }
    if (type === 'IDAT') idat.push(payload);
  }
  assert.equal(colorType, 6, 'maskable icon must retain an RGBA channel');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows = [];
  let rawOffset = 0;
  for (let row = 0; row < height; row += 1) {
    assert.equal(raw[rawOffset], 0, 'generated maskable PNG uses an unfiltered alpha-safe row');
    rawOffset += 1;
    rows.push(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
  }
  return { width, height, rows };
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

test('maskable icon has opaque black outer corners instead of a white canvas', () => {
  const icon = readRgbaPng('../assets/pwa-icon-512-maskable.png');
  const corners = [[0, 0], [icon.width - 1, 0], [0, icon.height - 1], [icon.width - 1, icon.height - 1]];
  const expected = [
    [17, 17, 17, 255],
    [17, 17, 17, 255],
    [17, 17, 17, 255],
    [17, 17, 17, 255],
  ];
  assert.deepEqual(corners.map(([x, y]) => [...icon.rows[y].subarray(x * 4, x * 4 + 4)]), expected);
  const perimeter = [];
  for (let x = 0; x < icon.width; x += 1) {
    perimeter.push([x, 0], [x, icon.height - 1]);
  }
  for (let y = 1; y < icon.height - 1; y += 1) perimeter.push([0, y], [icon.width - 1, y]);
  assert.ok(perimeter.every(([x, y]) => [...icon.rows[y].subarray(x * 4, x * 4 + 4)].every((value, index) => value === expected[0][index])));
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
