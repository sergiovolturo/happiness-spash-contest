import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = index.indexOf('// Public gallery flow starts here');
const end = index.indexOf('// New participant domain flow');
const votingFlow = index.slice(start, end);

test('gallery remains available anonymously', () => {
  assert.match(index, /if\(!session\)return render\(\)/);
  assert.match(votingFlow, /get_public_contest|get_public_contest_categories|published_submission_media/);
});
test('vote CTA is restricted to VOTING_OPEN', () => assert.match(votingFlow, /publicContest\?\.status!==['"]VOTING_OPEN['"]/));
test('OTP request uses Supabase passwordless Auth', () => assert.match(votingFlow, /supabase\.auth\.signInWithOtp\(\{email,options:\{shouldCreateUser:true\}\}\)/));
test('OTP verification uses verifyOtp email mode', () => assert.match(votingFlow, /supabase\.auth\.verifyOtp\(\{email:otpEmail,token,type:'email'\}\)/));
test('verified OTP session is required before voting', () => assert.match(votingFlow, /data\?\.session/));
test('per-category state uses the dedicated RPC', () => assert.match(index, /get_my_voted_categories/));
test('no voted categories produces an empty Set', () => assert.match(index, /votedCategoryIds=new Set\(\)/));
test('already voted category removes its CTA', () => assert.match(votingFlow, /votedCategoryIds\.has\(category\.id\)/));
test('multiple categories retain independent state', () => assert.match(votingFlow, /category\.id===selected\.id.*Già votata|votedCategoryIds\.has\(category\.id\)/s));
test('cast uses the approved RPC only', () => assert.match(votingFlow, /supabase\.rpc\('cast_contest_vote'/));
test('cast passes submission and category identifiers', () => assert.match(votingFlow, /p_submission_id:voteTarget\.submission_id,p_category_id:voteTarget\.category_id/));
test('no direct contest vote inserts', () => assert.doesNotMatch(votingFlow, /insert\s*\([^)]*contest_votes/i));
test('no direct voter identity writes', () => assert.doesNotMatch(votingFlow, /verified_voter_identities.*insert/i));
test('legacy votes are not used by the new flow', () => assert.doesNotMatch(votingFlow, /public\.votes|from\(['"]votes['"]\)|\.from\(['"]votes['"]\)/i));
test('vote confirmation states uniqueness and permanence', () => assert.match(votingFlow, /Il voto è unico e definitivo per questa categoria e non potrà essere modificato/));
test('double vote click is guarded', () => assert.match(votingFlow, /voteInFlight\.has\(key\)/));
test('double OTP requests are guarded', () => assert.match(votingFlow, /otpRequestInFlight\.value/));
test('double OTP verification is guarded', () => assert.match(votingFlow, /otpVerifyInFlight\.value/));
test('invalid email is handled', () => assert.match(votingFlow, /Inserisci un indirizzo email valido/));
test('OTP/rate-limit errors are mapped', () => assert.match(votingFlow, /rate_limit/));
test('vote errors are mapped without raw SQL UI', () => assert.match(votingFlow, /vote_already_cast|submission_not_public|voting_not_open/));
test('closed contests expose no voting CTA', () => assert.match(votingFlow, /publicContest\?\.status!=='VOTING_OPEN'/));
test('published media remain the gallery source', () => assert.match(votingFlow, /published_submission_media/));
test('no results or counts are rendered', () => assert.doesNotMatch(votingFlow, /vote_count|percentuale|ranking|classifica|posizione/i));
test('participant participation is not created by voter flow', () => assert.doesNotMatch(votingFlow, /ensure_contest_participation|create_submission/));
test('OTP/session restore does not auto-create participation', () => {
  assert.doesNotMatch(index.slice(index.indexOf('async function boot'), index.indexOf('function authView')), /loadParticipantContext\(\)/);
  assert.match(index, /if\(requestedTab==='upload'\)\{[\s\S]*?if\(session\)await renderStep\(loadParticipantContext\(\),'participant',requestId,requestedTab\)/);
});
test('participant context is loaded only when entering Candidatura', () => assert.match(index, /currentTab==='upload'.*loadParticipantContext/s));
test('session restore reloads per-category state from backend', () => assert.match(index, /onAuthStateChange[\s\S]*loadVoteState\(\)[\s\S]*render\(\)/));
test('close/reopen clears stale OTP email and token state', () => assert.match(votingFlow, /otpEmail='';otpPending=false;otpVerified=false;dialog\.remove\(\)/));
test('voting close and publication revoke remain backend fail-closed', () => {
  assert.match(votingFlow, /voting_not_open/);
  assert.match(votingFlow, /submission_not_public/);
});
test('participant session may vote without creating participation from gallery', () => {
  assert.match(votingFlow, /voterSessionVerified/);
  assert.doesNotMatch(votingFlow, /ensure_contest_participation/);
});
test('verified voters use a server-validated Auth user before opening the vote gate', () => {
  assert.match(votingFlow, /supabase\.auth\.getSession\(\)/);
  assert.match(votingFlow, /supabase\.auth\.getUser\(\)/);
  assert.match(votingFlow, /async function openVoteDialog\(row\)/);
  assert.match(votingFlow, /getCurrentVoterSession\(\)/);
});
test('verified voters skip email OTP and already-voted categories stay blocked', () => {
  assert.match(votingFlow, /if\(voter\?\.verified\)\{session=voter\.session;await loadVoteState\(\);if\(votedCategoryIds\.has\(row\.category_id\)\)/);
  assert.match(votingFlow, /Hai già votato in questa categoria/);
  assert.match(votingFlow, /verifiedVoterSession=data\.session/);
});
test('verified voters in another category retain independent vote access', () => {
  assert.match(index, /p_contest_id:publicContest\.id/);
  assert.match(votingFlow, /votedCategoryIds\.has\(row\.category_id\)/);
  assert.match(votingFlow, /p_category_id:voteTarget\.category_id/);
});
test('anonymous voters retain the email OTP branch', () => {
  assert.match(votingFlow, /needsOtp=!session\|\|!voterSessionVerified\(\)/);
  assert.match(votingFlow, /id="otpRequestForm"/);
  assert.match(votingFlow, /id="otpVerifyForm"/);
});
test('vote submission remains server-authoritative for duplicate prevention', () => {
  assert.match(votingFlow, /supabase\.rpc\('cast_contest_vote'/);
  assert.match(votingFlow, /vote_already_cast/);
});
test('anonymous vote flow has no email-based vote-status lookup', () => {
  assert.doesNotMatch(votingFlow, /eq\(['"]email['"]|voter_email|has_voted_by_email|verified_voter_identities/);
});
test('voter state refreshes after successful cast', () => assert.match(votingFlow, /await loadVoteState\(\);voteTarget=null/));
test('vote confirmation uses an explicit confirm action', () => {
  assert.match(votingFlow, /id="confirmVote"/);
  assert.match(votingFlow, /confirm\.onclick=castVoteFromDialog/);
});
test('voter OTP exposes a resend cooldown', () => {
  assert.match(votingFlow, /OTP_RESEND_COOLDOWN_MS/);
  assert.match(votingFlow, /otpCooldownActive\(otpCooldownUntil\)/);
  assert.match(votingFlow, /Puoi richiedere un nuovo codice tra/);
});
