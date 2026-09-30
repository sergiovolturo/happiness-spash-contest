import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('top-level navigation uses one delegated listener that survives view replacement', () => {
  assert.match(html, /let navBound=false;function bindNav\(\)\{if\(navBound\)return;document\.addEventListener\('click',event=>\{const b=event\.target\.closest\?\.\('\[data-tab\]'\)/);
  assert.match(html, /currentTab=b\.dataset\.tab;void render\(\)/);
  assert.doesNotMatch(html, /document\.querySelectorAll\('\[data-tab\]'\)\.forEach/);
});

test('public render hydrates published gallery content without replacing top-level navigation', () => {
  const shellStart = html.indexOf('const renderPublicHomeShell=');
  const shellEnd = html.indexOf('const loadAdminCategoryDefinitions=', shellStart);
  const shell = html.slice(shellStart, shellEnd);
  assert.match(shell, /data-home-category/);
  assert.match(shell, /publicGalleryArea/);
  assert.doesNotMatch(shell, /app\.innerHTML/);
  assert.match(shell, /loadPublicGallery\(requestId\)/);
  assert.match(shell, /galleryView\(requestId\)/);
});

test('published media path keeps public home before player navigation', () => {
  const renderStart = html.indexOf('async function render()');
  const renderEnd = html.indexOf('async function loadPublicContest', renderStart);
  const render = html.slice(renderStart, renderEnd);
  assert.match(render, /requestedTab==='home'\)await renderStep\(homeView\(requestId\)/);
  assert.match(render, /requestedTab==='upload'/);
  assert.match(render, /submissionView\(requestId\)/);
  assert.match(html, /published_submission_media/);
});

test('repeated public/player transitions retain request-scoped dispatch', () => {
  const nav = html.slice(html.indexOf('function nav()'), html.indexOf('let renderRequestSeq='));
  assert.match(nav, /data-tab=\"'\\+id\\+'\\\">/);
  assert.match(html, /activeRenderRequestId=requestId/);
  assert.match(html, /currentTab=b\.dataset\.tab;void render\(\)/);
});
