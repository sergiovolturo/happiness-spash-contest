import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const active = index.slice(index.lastIndexOf('const submissionViewWithPublicWindow='));
const gate = index.slice(index.indexOf('const playerOtpError='), index.indexOf('const submissionViewWithPublicWindow='));
const activeGate = index.slice(index.lastIndexOf('playerOtpGateView=async function'));

test('anonymous Candidatura starts with email verification only', () => {
  assert.match(gate, /Presenta la tua candidatura/);
  assert.match(gate, /Per inviare e controllare la tua candidatura, verifica prima la tua email/);
  assert.match(gate, /id="playerOtpRequestForm"/);
  assert.doesNotMatch(gate, /contestantDisplayName|id="category"/);
});

test('closed candidature window renders only the existing informational message', () => {
  assert.match(activeGate, /if\(submissionWindowState\(\)==='OPEN'\)\{await playerOtpGateViewOpen\(requestId\);return\}/);
  assert.match(activeGate, /view\.innerHTML=`<section class="card playerOtpGate"><div class="notice">\$\{esc\(submissionWindowMessage\(\)\)\}<\/div><\/section>`/);
  const closedRender = activeGate.slice(activeGate.indexOf("view.innerHTML=`<section"), activeGate.indexOf('\nconst submissionViewWithPublicWindow='));
  assert.doesNotMatch(closedRender, /playerOtpRequestForm|playerOtpVerifyForm|playerOtpEmail|Invia codice/);
});

test('open candidature window keeps the anonymous OTP gate', () => {
  assert.match(index, /const playerOtpGateViewOpen=playerOtpGateView/);
  assert.match(gate, /id="playerOtpRequestForm"/);
  assert.match(gate, /id="playerOtpEmail"/);
  assert.match(gate, /Invia codice/);
});

test('Player candidature requests passwordless OTP', () => {
  assert.match(gate, /supabase\.auth\.signInWithOtp\(\{email,options:\{shouldCreateUser:true\}\}\)/);
});

test('Player OTP has isolated state and DOM ids', () => {
  assert.match(index, /playerOtpEmail=''/);
  assert.match(index, /playerOtpPending=false/);
  assert.match(gate, /playerOtpRequestForm/);
  assert.match(gate, /playerOtpVerifyForm/);
  assert.match(gate, /playerOtpCode/);
  assert.doesNotMatch(gate, /id="otpCode"/);
});

test('successful OTP request renders the verification input', () => {
  assert.match(gate, /playerOtpPending=true;render\(\)/);
  assert.match(gate, /Codice di verifica/);
  assert.match(gate, /Abbiamo inviato un codice a/);
});

test('Player OTP verification uses email mode and requires a session', () => {
  assert.match(gate, /supabase\.auth\.verifyOtp\(\{email:playerOtpEmail,token,type:'email'\}\)/);
  assert.match(gate, /error\|\|!data\?\.session/);
  assert.match(gate, /session=data\.session/);
});

test('invalid Player OTP remains retryable with readable copy', () => {
  assert.match(gate, /Il codice non è corretto o è scaduto/);
  assert.match(gate, /if\(button\)button\.disabled=false/);
});

test('anonymous Player does not show the candidature form before Auth', () => {
  assert.match(active, /if\(!session\)\{await playerOtpGateView\(requestId\);return\}/);
  assert.doesNotMatch(active, /authView\(\)/);
});

test('authenticated Player bypasses OTP and uses the existing submission flow', () => {
  assert.match(active, /if\(!session\)\{await playerOtpGateView\(requestId\);return\}/);
  assert.match(active, /submissionViewWithPublicWindow\(requestId\)/);
  assert.match(index, /ensure_contest_participation/);
});

test('final Player wrapper keeps the pending category state defined', () => {
  assert.match(index, /currentTab='home',pendingSubmissionCategoryId=null/);
  assert.match(index, /pendingSubmissionCategoryId=null/);
});

test('voter Auth session can enter Candidatura without another OTP', () => {
  assert.match(index, /if\(session&&!participantId\)await renderStep\(loadParticipantContext\(\),'participant'/);
  assert.doesNotMatch(active, /signInWithOtp/);
});

test('post-Auth form still requires candidate name and category', () => {
  const form = index.slice(index.indexOf('function submissionView('), index.indexOf('async function handleMediaUpload'));
  assert.match(form, /name="contestantDisplayName"/);
  assert.match(form, /id="category"/);
  assert.match(form, /submissionWindowState\(\)!=='OPEN'/);
});

test('submission still uses the existing create/upload/finalize pipeline', () => {
  assert.match(index, /supabase\.rpc\('create_submission'/);
  assert.match(index, /prepare_submission_media_upload/);
  assert.match(index, /finalize_submission_media_upload/);
});

test('capacity and closed-window guards remain in the Player flow', () => {
  assert.match(index, /available_submission_count/);
  assert.match(index, /category_full/);
  assert.match(index, /if\(submissionWindowState\(\)!=='OPEN'\)/);
});

test('Player candidature OTP does not collide with voting OTP', () => {
  assert.match(index, /id="otpCode"/);
  assert.match(index, /id="playerOtpCode"/);
  assert.match(index, /sendVoteOtp/);
  assert.match(index, /requestPlayerOtp/);
  assert.match(index, /verifyVoteOtp/);
  assert.match(index, /verifyPlayerOtp/);
});

test('voting OTP remains passwordless and unchanged', () => {
  const voting = index.slice(index.indexOf('// Public gallery flow starts here'), index.indexOf('// New participant domain flow'));
  assert.match(voting, /signInWithOtp\(\{email,options:\{shouldCreateUser:true\}\}\)/);
  assert.match(voting, /verifyOtp\(\{email:otpEmail,token,type:'email'\}\)/);
});

test('Player OTP errors do not expose technical details', () => {
  assert.match(gate, /Non è stato possibile verificare l’email/);
  assert.doesNotMatch(gate, /console\.error/);
});

test('private submissions remain scoped to the authenticated participation', () => {
  assert.match(index, /eq\('participation_id',participantId\)/);
  assert.match(index, /Le tue candidature/);
});

test('public and candidature navigation remains wired', () => {
  assert.match(index, /\['home','Contest'\],\['upload','Candidatura'\]/);
  assert.match(index, /data-tab=\"'\+id\+'/);
  assert.match(index, /currentTab==='upload'/);
});


