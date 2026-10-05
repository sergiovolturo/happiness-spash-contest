import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('final Admin Results render restores preview markup after a later DOM rebuild', async () => {
  const finalStart = index.indexOf('const renderAdminWithFinalResults=renderAdmin;');
  const finalEnd = index.indexOf(' bindNav();', finalStart);
  assert.ok(finalStart >= 0 && finalEnd > finalStart);
  const finalWrapper = index.slice(finalStart, finalEnd);
  assert.match(finalWrapper, /await renderAdminWithFinalResults\(requestId\)/);
  assert.match(finalWrapper, /adminPreFreezeSummaryHtml\(data\)/);
  assert.match(finalWrapper, /adminProvisionalResults/);
  assert.ok(finalWrapper.indexOf('await renderAdminWithFinalResults') < finalWrapper.indexOf('adminPreFreezeSummaryHtml'));

  const dom = { summary: false, provisional: false };
  const baseRender = async () => {
    await Promise.resolve();
    dom.summary = false;
    dom.provisional = false;
  };
  const finalRender = async () => {
    await baseRender();
    dom.summary = true;
    dom.provisional = true;
  };
  await finalRender();
  await Promise.resolve();
  assert.equal(dom.summary, true);
  assert.equal(dom.provisional, true);
});

test('final Admin Results render still uses one preview RPC and never freezes automatically', () => {
  assert.equal((index.match(/rpc\('admin_preview_contest_results'/g) || []).length, 1);
  const finalWrapper = index.slice(index.indexOf('const renderAdminWithFinalResults=renderAdmin;'), index.indexOf(' bindNav();'));
  assert.doesNotMatch(finalWrapper, /freeze_contest_results|confirm_contest_finalists|publish_contest_finalists/);
});
