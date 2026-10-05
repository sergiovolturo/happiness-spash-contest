import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261005090000_post_voting_results_flow.sql', import.meta.url), 'utf8');

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

test('public results require a current published snapshot and remain aggregate-only', () => {
  const publicResults = migration.slice(migration.indexOf('create or replace function public.get_public_contest_results'), migration.indexOf('create or replace function public.admin_preview_contest_results'));
  assert.match(publicResults, /status='PUBLISHED' and rs\.invalidated_at is null/);
  assert.match(publicResults, /contest_result_entries/);
  assert.doesNotMatch(publicResults, /dense_rank\(\) over\(partition by c\.category_id/);
  assert.match(migration, /grant execute on function public\.get_public_contest_results\(uuid\) to anon,authenticated/i);
});

test('public result RPC remains closed to direct table access', () => {
  assert.match(migration, /security definer set search_path=''/i);
  assert.match(migration, /revoke all on function public\.get_public_contest_results\(uuid\) from public,service_role/i);
});

test('Admin preview is read-only, Admin-only and does not create result state', () => {
  assert.match(migration, /create or replace function public\.admin_preview_contest_results\(p_contest_id uuid\)/);
  assert.match(migration, /admin_users au where au\.user_id=v_auth_user_id/);
  assert.match(migration, /grant execute on function public\.admin_preview_contest_results\(uuid\) to authenticated/);
  assert.match(migration, /revoke execute on function public\.admin_preview_contest_results\(uuid\) from public,anon,service_role/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.admin_preview_contest_results')), /insert into public\.(contest_result_snapshots|contest_finalists)/);
  assert.match(index, /admin_preview_contest_results/);
  assert.match(index, /Classifica provvisoria/);
  assert.equal((index.match(/admin_preview_contest_results/g) || []).length, 1, 'preview RPC must be fetched once per results load');
  assert.match(index, /adminResultsPreviewRows=data\?\.preview\|\|\[\]/);
});

test('cutoff tie semantics identify a group crossing the finalist threshold', () => {
  assert.match(migration, /row_number\(\) over\(partition by c\.category_id/);
  assert.match(migration, /min\(x\.ordinal_position\)[\s\S]*<=r\.finalists_count/);
  assert.match(migration, /max\(x\.ordinal_position\)[\s\S]*>r\.finalists_count/);
  const crosses = (votes, slots) => {
    const groups = new Map();
    [...votes].sort((a, b) => b - a).forEach((vote, index) => {
      const group = groups.get(vote) || [];
      group.push(index + 1);
      groups.set(vote, group);
    });
    return [...groups.values()].some(group => Math.min(...group) <= slots && Math.max(...group) > slots);
  };
  assert.equal(crosses([10, 8, 7, 5, 5], 4), true);
  assert.equal(crosses([10, 10, 8, 7, 5], 4), false);
  assert.equal(crosses([10, 8, 7, 5, 4, 4], 4), false);
  assert.equal(crosses([10, 8, 7, 5, 5], 5), false);
});

test('non-archived VOTING_CLOSED contests remain public without exposing provisional counts', () => {
  const publicList = migration.slice(migration.indexOf('create or replace function public.get_public_contests()'), migration.indexOf('create or replace function public.get_public_contest()'));
  assert.match(publicList, /c\.archived_at is null/);
  assert.match(publicList, /'VOTING_CLOSED'/);
  assert.match(publicList, /'FROZEN'.*'CONFIRMED'.*'PUBLISHED'/s);
  assert.match(index, /VOTING_CLOSED:'Votazioni concluse'/);
  assert.match(index, /Le votazioni sono terminate\. I risultati sono in fase di validazione\./);
  assert.match(index, /publicActiveStatuses=new Set\(\[[\s\S]*'VOTING_CLOSED'/);
});
