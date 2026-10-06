import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = index.indexOf('const adminResultsFlowStep=');
const end = index.indexOf('const adminRenderCompactResults=', start);
assert.ok(start >= 0 && end > start);
const helpers = index.slice(start, end);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const render = data => Function('esc', 'adminSelectedContest', `${helpers};return adminCompactResultsMarkup`)(esc, { status: 'VOTING_CLOSED' })(data);

const baseData = (overrides = {}) => ({
  categories: [{ id: 'cat-a', name: 'TOP VOLÉE', finalists_count: 3 }],
  snapshots: [], entries: [], finalists: [], resolutions: [], votes: [], audits: [], reviewSubmissions: [], preview: [],
  ...overrides,
});

test('Admin post-voto uses Definisci finalisti and the three-step progress', () => {
  const markup = render(baseData());
  assert.match(markup, /Definisci finalisti/);
  assert.match(markup, /Votazione chiusa/);
  assert.match(markup, /Finalisti definiti/);
  assert.match(markup, /Pubblica/);
  assert.doesNotMatch(markup, /Congela risultati|Congela|Conferma/);
});

test('without a tie the main surface shows only effective finalists', () => {
  const markup = render(baseData({
    categories: [{ id: 'cat-a', name: 'TOP VOLÉE', finalists_count: 4 }],
    snapshots: [{ id: 'snap-a', category_id: 'cat-a', finalists_count: 4, status: 'FROZEN', tie_requires_decision: false }],
    entries: [
      { snapshot_id: 'snap-a', submission_id: 'a', rank_position: 1, vote_count: 3, is_cutoff_tie: false },
      { snapshot_id: 'snap-a', submission_id: 'b', rank_position: 2, vote_count: 2, is_cutoff_tie: false },
      { snapshot_id: 'snap-a', submission_id: 'c', rank_position: 3, vote_count: 1, is_cutoff_tie: false },
      { snapshot_id: 'snap-a', submission_id: 'd', rank_position: 4, vote_count: 0, is_cutoff_tie: false },
      { snapshot_id: 'snap-a', submission_id: 'e', rank_position: 5, vote_count: 0, is_cutoff_tie: false },
    ],
    reviewSubmissions: [
      { id: 'a', contestant_display_name: 'Anna' }, { id: 'b', contestant_display_name: 'Bruno' },
      { id: 'c', contestant_display_name: 'Carla' }, { id: 'd', contestant_display_name: 'Diego' },
      { id: 'e', contestant_display_name: 'Escluso' },
    ],
  }));
  assert.match(markup, /FINALISTI DEFINITI/);
  assert.match(markup, /Anna|Bruno|Carla|Diego/);
  assert.doesNotMatch(markup, /Escluso|#5|submission/);
  assert.match(markup, /Pubblica finalisti/);
});

test('an unresolved tie shows qualified finalists and only tied candidates', () => {
  const markup = render(baseData({
    snapshots: [{ id: 'snap-a', category_id: 'cat-a', finalists_count: 2, status: 'TIE_REQUIRES_DECISION', tie_requires_decision: true }],
    entries: [
      { snapshot_id: 'snap-a', submission_id: 'qualified', rank_position: 1, vote_count: 4, is_cutoff_tie: false },
      { snapshot_id: 'snap-a', submission_id: 'tie-a', rank_position: 2, vote_count: 1, is_cutoff_tie: true },
      { snapshot_id: 'snap-a', submission_id: 'tie-b', rank_position: 2, vote_count: 1, is_cutoff_tie: true },
      { snapshot_id: 'snap-a', submission_id: 'outside', rank_position: 3, vote_count: 0, is_cutoff_tie: false },
    ],
    reviewSubmissions: [
      { id: 'qualified', contestant_display_name: 'Qualificato' },
      { id: 'tie-a', contestant_display_name: 'Anna Test' },
      { id: 'tie-b', contestant_display_name: 'Gabriele' },
      { id: 'outside', contestant_display_name: 'Fuori parità' },
    ],
  }));
  assert.match(markup, /PARITÀ PER L’ULTIMO POSTO DISPONIBILE/);
  assert.match(markup, /Qualificato/);
  assert.match(markup, /Anna Test|Gabriele/);
  assert.doesNotMatch(markup, /Fuori parità/);
  assert.match(markup, /data-tie-selection/);
  assert.match(markup, /Conferma finalista/);
});

test('resolved tie collapses the picker and identifies the Admin-selected finalist', () => {
  const markup = render(baseData({
    snapshots: [{ id: 'snap-a', category_id: 'cat-a', finalists_count: 2, status: 'TIE_REQUIRES_DECISION', tie_requires_decision: true }],
    entries: [
      { snapshot_id: 'snap-a', submission_id: 'qualified', rank_position: 1, vote_count: 4, is_cutoff_tie: false },
      { snapshot_id: 'snap-a', submission_id: 'tie-a', rank_position: 2, vote_count: 1, is_cutoff_tie: true },
      { snapshot_id: 'snap-a', submission_id: 'tie-b', rank_position: 2, vote_count: 1, is_cutoff_tie: true },
    ],
    resolutions: [{ snapshot_id: 'snap-a', selected_submission_ids: ['tie-a'] }],
    reviewSubmissions: [
      { id: 'qualified', contestant_display_name: 'Qualificato' },
      { id: 'tie-a', contestant_display_name: 'Anna Test' },
      { id: 'tie-b', contestant_display_name: 'Gabriele' },
    ],
  }));
  const defined = markup.slice(markup.indexOf('<ol>'), markup.indexOf('</ol>') + 5);
  assert.match(defined, /Anna Test/);
  assert.doesNotMatch(defined, /Gabriele/);
  assert.match(markup, /Scelta dall’Admin per risolvere la parità/);
  assert.match(markup, /Cambia finalista selezionato/);
  assert.match(markup, /data-tie-picker="snap-a" hidden/);
});

test('effective finalist count limits the defined list', () => {
  const markup = render(baseData({
    snapshots: [{ id: 'snap-a', category_id: 'cat-a', finalists_count: 4, status: 'FROZEN', tie_requires_decision: false }],
    entries: [{ snapshot_id: 'snap-a', submission_id: 'only', rank_position: 1, vote_count: 1, is_cutoff_tie: false }],
    reviewSubmissions: [{ id: 'only', contestant_display_name: 'Unico candidato' }],
  }));
  assert.match(markup, /Unico candidato/);
  assert.equal((markup.match(/<li>/g) || []).length, 1);
});

test('results actions remain delegated to existing handlers', () => {
  const renderer = index.slice(index.indexOf('const adminBindCompactResults='), index.indexOf('const adminRenderCompactResults='));
  for (const handler of ['adminFreezeResults', 'adminResolveTie', 'adminPublishFinalists']) assert.match(renderer, new RegExp(handler));
  assert.match(renderer, /adminDeleteFraudVote/);
});
