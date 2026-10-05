import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('compact Admin Results renders one aggregate summary and one category ranking per category', () => {
  const start = index.indexOf('const adminCompactResultsProgress=');
  const end = index.indexOf('const adminBindCompactResults=', start);
  assert.ok(start >= 0 && end > start);
  const helpers = index.slice(start, end);
  const markup = Function('esc', 'adminResultsFlowStep', 'adminSelectedContest', `${helpers};return adminCompactResultsMarkup`) (
    value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character])),
    () => 'Risultati da congelare',
    { status: 'VOTING_CLOSED' },
  )({
    categories: [
      { id: 'volée', name: 'TOP VOLÉE', finalists_count: 4 },
      { id: 'smash', name: 'TOP SMASH', finalists_count: 4 },
    ],
    preview: [
      { category_id: 'volée', contestant_display_name: 'Matteo Volturo', rank_position: 1, vote_count: 2, is_finalist_candidate: true },
      { category_id: 'smash', contestant_display_name: 'Matteo Volturo', rank_position: 1, vote_count: 4, is_finalist_candidate: true },
    ],
    snapshots: [], entries: [], resolutions: [], votes: [], audits: [], reviewSubmissions: [],
  });
  assert.equal((markup.match(/Riepilogo prima del congelamento/g) || []).length, 0);
  assert.match(markup, /2 categorie · 2 candidati · 6 voti/);
  assert.match(markup, /TOP VOLÉE/);
  assert.match(markup, /TOP SMASH/);
  assert.match(markup, /2 voti/);
  assert.match(markup, /4 voti/);
  assert.equal((markup.match(/meno candidati dei finalisti configurati/g) || []).length, 1);
  assert.match(markup, /✓/);
});

test('Results loading has one preview RPC and no legacy visible render before the compact surface', () => {
  assert.equal((index.match(/rpc\('admin_preview_contest_results'/g) || []).length, 1);
  const activeStart = index.indexOf('const renderAdminResultsSectionAuthoritative=');
  const activeEnd = index.indexOf('const adminRenderAuthoritativeShell=', activeStart);
  const active = index.slice(activeStart, activeEnd);
  assert.match(active, /adminRenderCompactResults/);
  assert.doesNotMatch(active, /insertAdjacentHTML\('beforeend'.*adminResults/);
  assert.match(index, /Caricamento risultati/);
});

test('freeze/tie/confirm/publish actions remain delegated to existing handlers', () => {
  const renderer = index.slice(index.indexOf('const adminBindCompactResults='), index.indexOf('const adminRenderCompactResults='));
  for (const handler of ['adminFreezeResults', 'adminResolveTie', 'adminConfirmFinalists', 'adminPublishFinalists']) assert.match(renderer, new RegExp(handler));
  assert.match(renderer, /adminDeleteFraudVote/);
});
