import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260930000700_public_results_after_voting_close.sql', import.meta.url), 'utf8');

test('closed Player candidature removes the form and preserves Le tue candidature', () => {
  const wrapper = index.slice(index.indexOf('playerSubmissionViewBase=submissionView'), index.indexOf('const playerVoteDialogBase'));
  assert.match(wrapper, /available=publicCategories\.filter/);
  assert.match(wrapper, /if\(!windowOpen\|\|!available\.length\)/);
  assert.match(wrapper, /form\)form\.remove\(\)/);
  assert.match(wrapper, /Le tue candidature/);
});

test('Player submission categories exclude full categories', () => {
  assert.match(index, /!Number\.isFinite\(Number\(c\.available_submission_count\)\)\|\|Number\(c\.available_submission_count\)>0/);
});

test('submission status and vote CTA use the real temporal windows', () => {
  assert.match(index, /function publicVotingNotice\(\)\{const phase=votingWindowStateAt\(publicContest\)/);
  assert.match(index, /publicContest\?\.status!=='VOTING_OPEN'\|\|votingWindowStateAt\(publicContest\)!=='OPEN'/);
  assert.match(index, /openVoteDialog\(row\)\{if\(publicContest\?\.status!=='VOTING_OPEN'\|\|votingWindowStateAt\(publicContest\)!=='OPEN'/);
});

test('Admin candidature cards avoid duplicate participant/email presentation', () => {
  assert.match(index, /showParticipant=participantName&&participantName!==contactEmail&&participantName!==row\.contestant_display_name/);
  assert.doesNotMatch(index.slice(index.indexOf('const adminSubmissionCardHtml='), index.indexOf('const adminAddCategoryFieldLabels')), />FINALIZED<|>PREPARED<|>current</);
});

test('Admin shows a provisional per-category ranking while voting is open', () => {
  assert.match(index, /const renderAdminProvisionalResults=async/);
  assert.match(index, /Classifica provvisoria/);
  assert.match(index, /adminVotingPhaseAt\(adminSelectedContest\)!=='OPEN'/);
  assert.match(index, /row\.contestant_display_name/);
  assert.match(index, /row\.vote_count/);
});

test('Admin overview does not preload category associations', () => {
  const wrapperStart = index.indexOf('renderAdmin=async function(requestId=activeRenderRequestId){await renderAdminBaseForFunctionalBlock');
  const wrapperEnd = index.indexOf('};', wrapperStart);
  const wrapper = index.slice(wrapperStart, wrapperEnd);
  assert.doesNotMatch(wrapper, /loadAdminContests\(\)/);
  assert.doesNotMatch(wrapper, /admin_list_contest_categories/);
});

test('public results are loaded only after the voting window closes', () => {
  assert.match(index, /const votingClosed=nextContest\.voting_close_at&&Date\.now\(\)>=Date\.parse\(nextContest\.voting_close_at\)/);
  assert.match(index, /if\(votingClosed\|\|\['VOTING_CLOSED','FROZEN','CONFIRMED','PUBLISHED','CLOSED'\]\.includes\(nextContest\.status\)\)/);
});

test('public result rendering is post-vote only and exposes aggregate data', () => {
  assert.match(index, /Voti: '\+result\.vote_count/);
  assert.match(index, /Top 4 · Finalissima Instagram/);
  assert.match(index, /const votingClosed=publicContest\.voting_close_at&&Date\.now\(\)>=Date\.parse\(publicContest\.voting_close_at\)/);
  assert.doesNotMatch(index.slice(index.indexOf('const galleryViewBeforeFunctionalResults')), /voter|email|identity|UUID/i);
});

test('public results fallback ranks each category by vote count and marks Top 4', () => {
  assert.match(migration, /now\(\) < v_contest\.voting_close_at/);
  assert.match(migration, /dense_rank\(\) over\(partition by c\.category_id order by c\.vote_count desc\)/i);
  assert.match(migration, /r\.rank_position<=4/);
  assert.match(migration, /grant execute on function public\.get_public_contest_results\(uuid\) to anon,authenticated/i);
});

test('public result RPC remains closed to direct table access', () => {
  assert.match(migration, /security definer set search_path=''/i);
  assert.match(migration, /revoke execute on function public\.get_public_contest_results\(uuid\) from public,service_role/i);
});
