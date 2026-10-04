import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260928000100_functional_cleanup.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('submission window is configured and enforced before, during and after the window', () => {
  assert.match(migration, /admin_set_submission_window/);
  assert.match(migration, /p_open_at timestamptz/);
  assert.match(migration, /p_close_at timestamptz/);
  assert.match(migration, /p_open_at >= p_close_at/);
  assert.match(migration, /now\(\) >= c\.submissions_open_at/);
  assert.match(migration, /now\(\) < c\.submissions_close_at/);
  assert.match(migration, /submission_window_required/);
  assert.match(index, /submissionWindowState/);
  assert.match(index, /Candidature programmate/);
  assert.match(index, /Candidature chiuse/);
});

test('player and admin submissions require an explicit contestant display name', () => {
  assert.match(migration, /contestant_display_name text/);
  assert.match(migration, /contestant_display_name_required/);
  assert.match(migration, /create_submission[\s\S]*p_contestant_display_name text default null/);
  assert.match(migration, /admin_create_submission_with_media[\s\S]*p_contestant_display_name text default null/);
  assert.match(index, /name="contestantDisplayName"/);
  assert.match(index, /contestantDisplayName=document\.querySelector\('#contestantDisplayName'\)\.value\.trim\(\)/);
  assert.match(index, /p_contestant_display_name:form\.elements\.contestantDisplayName\.value\.trim\(\)/);
});

test('public gallery displays candidate and real category context', () => {
  assert.match(migration, /s\.contestant_display_name/);
  assert.match(migration, /cc\.name as category_name/);
  assert.match(index, /row\.contestant_display_name/);
  assert.match(index, /row\.category_name/);
});

test('admin vote review keeps IDs internal and provides readable fraud deletion CTA', () => {
  assert.match(index, /Voti da verificare/);
  assert.match(index, /deleteFraudVote/);
  assert.match(index, /contestant_display_name/);
  assert.doesNotMatch(index, /<b>\\$\\{esc\\(v\\.id\\)\\}/);
  assert.doesNotMatch(index, /submission \\$\\{esc\\(v\\.submission_id\\)\\}/);
});

test('voting and publication primitives remain wired', () => {
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /published_submission_media/);
  assert.match(migration, /drop view public\.published_submission_media/);
});


test('the active Admin manual submission handler passes the contestant name', () => {
  const activeStart = index.lastIndexOf('function bindAdminManualSubmission');
  assert.ok(activeStart > 0);
  const active = index.slice(activeStart);
  assert.match(active, /admin_create_submission_with_media/);
  assert.match(active, /p_contestant_display_name:form\.elements\.contestantDisplayName\.value\.trim\(\)/);
});

test('Europe/Rome helpers render UTC timestamps and submit local values with DST-aware offsets', () => {
  const start = index.indexOf("const ROME_TIME_ZONE='Europe/Rome'");
  const end = index.indexOf('const submissionWindowState=()=>', start);
  const helperSource = index.slice(start, end);
  const helpers = new Function(helperSource + '; return {romeTimestamptzToLocal,romeLocalToTimestamptz};')();
  assert.equal(helpers.romeTimestamptzToLocal('2026-01-15T12:00:00Z'), '2026-01-15T13:00');
  assert.equal(helpers.romeTimestamptzToLocal('2026-07-15T12:00:00Z'), '2026-07-15T14:00');
  assert.equal(helpers.romeLocalToTimestamptz('2026-01-15T13:00'), '2026-01-15T12:00:00.000Z');
  assert.equal(helpers.romeLocalToTimestamptz('2026-07-15T14:00'), '2026-07-15T12:00:00.000Z');
  assert.match(index, /timeZone:ROME_TIME_ZONE/);
  assert.doesNotMatch(index, /new Date\(selected\.submissions_(open|close)_at\)\.toISOString\(\)\.slice\(0,16\)/);
});

test('submission window state transitions are deterministic before, during and after the window', () => {
  const start = index.indexOf('const submissionWindowStateAt=');
  const end = index.indexOf('const submissionWindowState=()=>', start);
  const helpers = new Function(index.slice(start, end) + '; return {submissionWindowStateAt};')();
  const contest = {submissions_open_at:'2026-01-01T10:00:00Z', submissions_close_at:'2026-01-01T12:00:00Z'};
  assert.equal(helpers.submissionWindowStateAt(contest, Date.parse('2026-01-01T09:59:59Z')), 'BEFORE');
  assert.equal(helpers.submissionWindowStateAt(contest, Date.parse('2026-01-01T11:00:00Z')), 'OPEN');
  assert.equal(helpers.submissionWindowStateAt(contest, Date.parse('2026-01-01T12:00:00Z')), 'CLOSED');
});

test('final wrapper audit preserves the new behavior', () => {
  assert.match(index.slice(index.lastIndexOf('submissionView=')), /playerOtpInlineMarkup/);
  assert.match(index.slice(index.lastIndexOf('submissionView=')), /pendingSubmissionRequest/);
  assert.match(index, /openSubmissionContests/);
  assert.match(index, /submissionContestSelect/);
  assert.match(index, /async function renderAdmin\(/);
  assert.match(index, /adminView=renderAdmin/);
  assert.doesNotMatch(index, /adminView=async function/);
  const thumbnailWrapper=index.indexOf('const galleryViewBeforeThumbnails=');
  const finalGallery=index.slice(index.lastIndexOf('galleryView=async function(requestId=activeRenderRequestId){',thumbnailWrapper),index.lastIndexOf('submissionView='));
  assert.match(finalGallery, /const view=document\.querySelector\('#view'\)/);
  assert.match(finalGallery, /id="backToPublicContests"/);
  assert.match(finalGallery, /homeView\(activeRenderRequestId\)/);
  assert.doesNotMatch(finalGallery, /publicGalleryArea/);
  assert.match(index.slice(index.lastIndexOf('bindAdminContestManager=')), /bindAdminContestManagerBase/);
});


test('Rome spring-forward rejects nonexistent local time and preserves valid transition times', () => {
  const start = index.indexOf("const ROME_TIME_ZONE='Europe/Rome'");
  const end = index.indexOf('const submissionWindowState=()=>', start);
  const helpers = new Function(index.slice(start, end) + '; return {romeTimestamptzToLocal,romeLocalToTimestamptz};')();
  assert.equal(helpers.romeLocalToTimestamptz('2026-03-29T01:30'), '2026-03-29T00:30:00.000Z');
  assert.equal(helpers.romeLocalToTimestamptz('2026-03-29T02:30'), '');
  assert.equal(helpers.romeLocalToTimestamptz('2026-03-29T03:30'), '2026-03-29T01:30:00.000Z');
  assert.equal(helpers.romeTimestamptzToLocal('2026-03-29T00:30:00Z'), '2026-03-29T01:30');
  assert.equal(helpers.romeTimestamptzToLocal('2026-03-29T01:30:00Z'), '2026-03-29T03:30');
});

test('Rome fall-back chooses the second occurrence deterministically', () => {
  const start = index.indexOf("const ROME_TIME_ZONE='Europe/Rome'");
  const end = index.indexOf('const submissionWindowState=()=>', start);
  const helpers = new Function(index.slice(start, end) + '; return {romeTimestamptzToLocal,romeLocalToTimestamptz};')();
  assert.equal(helpers.romeLocalToTimestamptz('2026-10-25T02:30'), '2026-10-25T01:30:00.000Z');
  assert.equal(helpers.romeTimestamptzToLocal('2026-10-25T00:30:00Z'), '2026-10-25T02:30');
  assert.match(index, /fall-back|second occurrence|seconda occorrenza/i);
});

test('Admin manual submission follows lifecycle window state', () => {
  const stateStart = index.indexOf('const submissionWindowStateAt=');
  const stateEnd = index.indexOf('\r\n', stateStart) + 2;
  const adminStart = index.indexOf('const adminSubmissionWindowStateAt=');
  const adminEnd = index.indexOf('const submissionWindowMessage=', adminStart);
  const helpers = new Function('const fmt=()=>"chiusura";' + index.slice(stateStart, stateEnd) + index.slice(adminStart, adminEnd) + '; return {adminSubmissionWindowStateAt,adminSubmissionWindowLabelAt,adminSubmissionWindowMessageAt};')();
  const contest = {status:'SUBMISSIONS_OPEN',submissions_open_at:'2026-01-01T10:00:00Z',submissions_close_at:'2026-01-01T12:00:00Z'};
  const before = helpers.adminSubmissionWindowStateAt(contest, Date.parse('2026-01-01T09:00:00Z'));
  const open = helpers.adminSubmissionWindowStateAt(contest, Date.parse('2026-01-01T11:00:00Z'));
  const closed = helpers.adminSubmissionWindowStateAt(contest, Date.parse('2026-01-01T13:00:00Z'));
  assert.equal(before.enabled, false);
  assert.equal(open.enabled, true);
  assert.equal(closed.enabled, false);
  assert.equal(helpers.adminSubmissionWindowLabelAt(contest, Date.parse('2026-01-01T09:00:00Z')), 'Candidature programmate');
  assert.equal(helpers.adminSubmissionWindowLabelAt(contest, Date.parse('2026-01-01T11:00:00Z')), 'Candidature aperte');
  assert.equal(helpers.adminSubmissionWindowLabelAt(contest, Date.parse('2026-01-01T13:00:00Z')), 'Periodo candidature terminato');
  assert.match(helpers.adminSubmissionWindowMessageAt(contest, Date.parse('2026-01-01T09:00:00Z')), /Apertura/);
  assert.match(helpers.adminSubmissionWindowMessageAt(contest, Date.parse('2026-01-01T11:00:00Z')), /chiusura/);
  assert.match(helpers.adminSubmissionWindowMessageAt(contest, Date.parse('2026-01-01T13:00:00Z')), /terminato/);
  assert.match(index, /Le candidature non sono ancora aperte/);
});

test('Player window message remains phase-specific', () => {
  assert.match(index, /Candidature programmate\. Candidature aprono il/);
  assert.match(index, /Candidature aperte fino al/);
  assert.match(index, /Candidature chiuse\. Il periodo è terminato/);
});


test('final Player submission wrapper respects guest window state', () => {
  const start = index.lastIndexOf('const playerSubmissionViewBase=submissionView');
  const wrapper = index.slice(start);
  assert.match(wrapper, /windowOpen=submissionWindowState\(\)==='OPEN'/);
  assert.match(wrapper, /if\(!windowOpen\|\|!available\.length\)/);
  assert.match(wrapper, /form\)form\.remove\(\)/);
  assert.match(wrapper, /button\.disabled=false;button\.textContent='Continua con la tua email'/);
  assert.match(wrapper, /if\(form\)form\.remove\(\)/);
  const stateStart = index.indexOf('const submissionWindowStateAt=');
  const stateEnd = index.indexOf('const submissionWindowMessage=()=>', stateStart);
  const state = new Function(index.slice(stateStart, stateEnd) + '; return {submissionWindowStateAt};')();
  const contest = {status:'SUBMISSIONS_OPEN',submissions_open_at:'2026-01-01T10:00:00Z',submissions_close_at:'2026-01-01T12:00:00Z'};
  assert.equal(state.submissionWindowStateAt(contest, Date.parse('2026-01-01T09:00:00Z')), 'BEFORE');
  assert.equal(state.submissionWindowStateAt(contest, Date.parse('2026-01-01T11:00:00Z')), 'OPEN');
  assert.equal(state.submissionWindowStateAt(contest, Date.parse('2026-01-01T13:00:00Z')), 'CLOSED');
});

