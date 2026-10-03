import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const declarations = ['votingWindowStateAt', 'adminSubmissionPhaseAt', 'adminVotingPhaseAt', 'adminReadableStatus', 'adminVotingLabelAt', 'adminOverviewAction'].map(name => index.match(new RegExp(`^const ${name}=.*$`, 'm'))?.[0]);
assert.ok(declarations.every(Boolean), 'Admin lifecycle helpers must remain extractable');
const helpers = new Function(`${declarations.join('\n')}\nreturn {adminSubmissionPhaseAt,adminVotingPhaseAt,adminVotingLabelAt,adminReadableStatus,adminOverviewAction};`)();

const contest = {
  status: 'SUBMISSIONS_OPEN',
  submissions_open_at: '2026-10-01T12:00:00Z',
  submissions_close_at: '2026-10-02T12:00:00Z',
  voting_open_at: '2026-10-02T13:00:00Z',
  voting_close_at: '2026-10-05T12:00:00Z'
};

test('Admin overview uses one standard workspace CTA for every lifecycle state', () => {
  const before = Date.parse('2026-10-01T11:00:00Z');
  const open = Date.parse('2026-10-01T13:00:00Z');
  const closed = Date.parse('2026-10-02T12:00:00Z');
  assert.equal(helpers.adminSubmissionPhaseAt(contest, before), 'BEFORE');
  assert.equal(helpers.adminSubmissionPhaseAt(contest, open), 'OPEN');
  assert.equal(helpers.adminSubmissionPhaseAt(contest, closed), 'CLOSED');
  assert.equal(helpers.adminReadableStatus(contest, before), 'Candidature programmate');
  assert.equal(helpers.adminReadableStatus(contest, open), 'Candidature aperte');
  for (const status of ['DRAFT','SUBMISSIONS_OPEN','SUBMISSIONS_CLOSED','MODERATION','READY_FOR_VOTING','VOTING_OPEN','VOTING_CLOSED','FROZEN','CONFIRMED','PUBLISHED','CLOSED']) {
    assert.deepEqual(helpers.adminOverviewAction({...contest,status}, before), ['Apri Contest', 'contest']);
  }
});

test('Admin overview does not render raw lifecycle codes or duplicate status copy', () => {
  const start = index.indexOf('const renderAdminOverview=');
  const end = index.indexOf('const renderAdminContestSection=', start);
  const overview = index.slice(start, end);
  assert.doesNotMatch(overview, /c\.status\}`/);
  assert.match(overview, /adminReadableStatus\(c\)/);
  assert.match(overview, /adminOverviewMessage\(c\)/);
  assert.doesNotMatch(overview, /adminReadableStatus\(c\)\s*\+\s*['"] · ['"]\s*\+\s*adminSubmissionWindowMessageAt/);
  assert.doesNotMatch(overview, /Gestisci candidature|Gestisci risultati|Configura Contest|Gestisci votazione/);
  assert.match(overview, /data-admin-overview-section="\$\{section\}"[\s\S]*\$\{label\}/);
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

test('Admin configuration categories use compact four-column desktop rows with responsive fallback', () => {
  assert.match(index, /\.adminEditableCategory\{display:grid;grid-template-columns:minmax\(220px,2fr\) repeat\(3,minmax\(110px,1fr\)/);
  assert.match(index, /\.adminEditableCategoryField/);
  assert.match(index, /@media\(max-width:900px\)\{\.adminEditableCategory\{grid-template-columns:repeat\(2/);
  assert.match(index, /@media\(max-width:560px\)\{\.adminEditableCategory\{grid-template-columns:1fr\}/);
  const configuration = index.slice(index.indexOf('const adminContestConfigurationSurface='), index.indexOf('const renderAdminContestSectionAuthoritative=', index.indexOf('const adminContestConfigurationSurface=')));
  for (const field of ['categoryName', 'categoryCap', 'categoryFinalists', 'categoryOrder']) assert.match(configuration, new RegExp(`adminEditableCategoryField.*${field}`));
  assert.match(configuration, /admin_update_contest_category/);
  assert.match(configuration, /admin_reorder_contest_categories/);
});

test('Voting status surface uses voting lifecycle labels, not submissions labels', () => {
  const before = Date.parse('2026-10-01T11:00:00Z');
  const open = Date.parse('2026-10-02T14:00:00Z');
  const closed = Date.parse('2026-10-05T13:00:00Z');
  assert.equal(helpers.adminVotingLabelAt(contest, before), 'Votazione programmata');
  assert.equal(helpers.adminVotingLabelAt({...contest, status: 'VOTING_OPEN'}, open), 'Votazione aperta');
  assert.equal(helpers.adminVotingLabelAt({...contest, status: 'VOTING_OPEN'}, closed), 'Votazione conclusa');
  const surface = index.slice(index.indexOf('const adminVotingStatusSurface='), index.indexOf('const adminContestConfigurationSurface='));
  assert.match(surface, /adminVotingLabelAt\(contest\)/);
  assert.doesNotMatch(surface, /adminReadableStatus\(contest\)/);
  assert.doesNotMatch(surface, /Candidature programmate/);
});

test('Safe edit RPC wiring remains unchanged', () => {
  const configuration = index.slice(index.indexOf('const adminContestConfigurationSurface='), index.indexOf('const renderAdminContestSectionAuthoritative=', index.indexOf('const adminContestConfigurationSurface=')));
  assert.match(configuration, /admin_update_contest_configuration/);
  assert.match(configuration, /safeEdit/);
  assert.match(configuration, /Categorie, cap, finalisti e ordine proteggono lo storico esistente/);
});

test('final render sanitizes technical lifecycle labels from visible text', () => {
  assert.match(index, /adminHumanizeStatusLabels\(document\.querySelector\('#view'\)\)/);
  const sanitizerStart = index.indexOf('const adminHumanizeStatusLabels=');
  const sanitizerEnd = index.indexOf('\n // Public gallery flow starts here', sanitizerStart);
  const sanitizer = index.slice(sanitizerStart, sanitizerEnd);
  for (const technical of ['SUBMISSIONS_OPEN', 'VOTING_OPEN', 'READY_FOR_VOTING', 'DRAFT']) assert.match(sanitizer, new RegExp(technical));
  for (const readable of ['Candidature aperte', 'Votazione aperta', 'Pronto per la votazione', 'Bozza']) assert.match(sanitizer, new RegExp(readable));
});
