import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const helperStart = index.indexOf('const adminSubmissionPhaseAt=');
const helperEnd = index.indexOf('const adminVotingStatusSurface=', helperStart);
const actionSource = index.match(/^const adminOverviewAction=.*$/m)?.[0];
assert.ok(helperStart >= 0 && helperEnd > helperStart && actionSource, 'Admin lifecycle helpers must remain extractable');
const helpers = new Function(`${index.slice(helperStart, helperEnd)}\n${actionSource}\nreturn {adminSubmissionPhaseAt,adminVotingPhaseAt,adminReadableStatus,adminOverviewAction};`)();

const contest = {
  status: 'SUBMISSIONS_OPEN',
  submissions_open_at: '2026-10-01T12:00:00Z',
  submissions_close_at: '2026-10-02T12:00:00Z',
  voting_open_at: '2026-10-02T13:00:00Z',
  voting_close_at: '2026-10-05T12:00:00Z'
};

test('Admin overview derives readable status and lifecycle-aware CTA', () => {
  const before = Date.parse('2026-10-01T11:00:00Z');
  const open = Date.parse('2026-10-01T13:00:00Z');
  const closed = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(helpers.adminSubmissionPhaseAt(contest, before), 'BEFORE');
  assert.equal(helpers.adminSubmissionPhaseAt(contest, open), 'OPEN');
  assert.equal(helpers.adminSubmissionPhaseAt(contest, closed), 'CLOSED');
  assert.equal(helpers.adminReadableStatus(contest, before), 'Candidature programmate');
  assert.equal(helpers.adminReadableStatus(contest, open), 'Candidature aperte');
  assert.deepEqual(helpers.adminOverviewAction(contest, before), ['Apri Contest', 'contest']);
  assert.deepEqual(helpers.adminOverviewAction(contest, open), ['Gestisci candidature', 'submissions']);
  assert.deepEqual(helpers.adminOverviewAction(contest, closed), ['Apri Contest', 'contest']);
});

test('Admin overview does not render raw lifecycle codes or duplicate status copy', () => {
  const start = index.indexOf('const renderAdminOverview=');
  const end = index.indexOf('const renderAdminContestSection=', start);
  const overview = index.slice(start, end);
  assert.doesNotMatch(overview, /c\.status\}`/);
  assert.match(overview, /adminReadableStatus\(c\)/);
  assert.match(overview, /adminOverviewMessage\(c\)/);
  assert.doesNotMatch(overview, /adminReadableStatus\(c\)\s*\+\s*['"] · ['"]\s*\+\s*adminSubmissionWindowMessageAt/);
});

test('Public schedule and cards use mobile-first single-column layout', () => {
  assert.match(index, /\.publicScheduleGrid\{grid-template-columns:1fr\}/);
  assert.match(index, /\.publicScheduleSurface\{padding:16px\}/);
  assert.match(index, /\.publicCategoryGrid\{grid-template-columns:repeat\(auto-fit/);
  assert.match(index, /\.categoryVisualSlot\{aspect-ratio:3\/1/);
  assert.match(index, /\.publicCategoryCard\{width:100%;max-width:480px\}/);
});

test('Admin desktop surfaces use wide grids while category editing remains preserved', () => {
  assert.match(index, /\.adminOverviewGrid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(300px,1fr\)/);
  assert.match(index, /@media\(min-width:1100px\)/);
  assert.match(index, /\.adminSubmissionsWorkspace \.adminSubmissionGrid\{grid-template-columns:repeat\(2/);
  assert.match(index, /admin_update_category_definition/);
  assert.match(index, /categoryEditPreview/);
  assert.match(index, /category-images/);
});

test('final render sanitizes technical lifecycle labels from visible text', () => {
  assert.match(index, /adminHumanizeStatusLabels\(document\.querySelector\('#view'\)\)/);
  const sanitizerStart = index.indexOf('const adminHumanizeStatusLabels=');
  const sanitizerEnd = index.indexOf('\n // Public gallery flow starts here', sanitizerStart);
  const sanitizer = index.slice(sanitizerStart, sanitizerEnd);
  for (const technical of ['SUBMISSIONS_OPEN', 'VOTING_OPEN', 'READY_FOR_VOTING', 'DRAFT']) assert.match(sanitizer, new RegExp(technical));
  for (const readable of ['Candidature aperte', 'Votazione aperta', 'Pronto per la votazione', 'Bozza']) assert.match(sanitizer, new RegExp(readable));
});
