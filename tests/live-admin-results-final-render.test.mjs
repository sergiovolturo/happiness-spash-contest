import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Admin Results uses one authoritative compact renderer', () => {
  const rendererStart = index.indexOf('const renderAdminResultsSectionAuthoritative=');
  const rendererEnd = index.indexOf('const adminRenderAuthoritativeShell=', rendererStart);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart);
  const renderer = index.slice(rendererStart, rendererEnd);
  assert.match(renderer, /adminRenderCompactResults\(view,requestId\)/);
  assert.doesNotMatch(renderer, /renderAdminResults\(view\)/);
  assert.doesNotMatch(renderer, /adminPreFreezeSummaryHtml|adminProvisionalResults/);
  assert.match(index, /adminResultsLoading/);
});

test('final Admin Results render still uses one preview RPC and never freezes automatically', () => {
  assert.equal((index.match(/rpc\('admin_preview_contest_results'/g) || []).length, 1);
  const finalWrapper = index.slice(index.indexOf('const adminRenderCompactResults='), index.indexOf(' bindNav();'));
  assert.doesNotMatch(finalWrapper, /supabase\.rpc\(['"](?:freeze_contest_results|confirm_contest_finalists|publish_contest_finalists)/);
  assert.match(finalWrapper, /adminResultsLoadedData=null/);
});
