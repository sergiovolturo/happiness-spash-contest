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

test('Candidatura can be completed before Auth and gates only at submit time', () => {
  assert.doesNotMatch(index, /if\(!session\)\{await renderStep\(playerOtpGateView\(requestId\),'participant-auth'/);
  assert.match(index, /async function createSubmission[\s\S]*?pendingSubmissionRequest=\{contestId:publicContest\?\.id,categoryId,contestantDisplayName\}/);
  assert.match(index, /playerOtpInlineMarkup\(\)/);
  assert.match(index, /permission:'La sessione non è valida\. Verifica di nuovo la tua email\.'/);
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

test('anonymous Player sees the candidature form and no automatic OTP request', () => {
  assert.match(active, /id=\"submissionForm\"/);
  assert.match(active, /if\(!session&&pendingSubmissionRequest\)/);
  assert.doesNotMatch(active, /signInWithOtp/);
});

test('authenticated Player bypasses OTP and uses the existing submission flow', () => {
  assert.match(index, /if\(session\)await renderStep\(loadParticipantContext\(\),'participant'/);
  assert.match(active, /submissionViewWithPublicWindow\(requestId\)/);
  assert.match(index, /ensure_contest_participation/);
});

test('final Player wrapper keeps the pending category state defined', () => {
  assert.match(index, /currentTab='home',pendingSubmissionCategoryId=null/);
  assert.match(index, /pendingSubmissionCategoryId=null/);
});

test('voter Auth session can enter Candidatura without another OTP', () => {
  assert.match(index, /if\(session\)await renderStep\(loadParticipantContext\(\),'participant'/);
  assert.doesNotMatch(active, /signInWithOtp/);
});

test('submission OTP starts only from the explicit send-code action and is serialized', () => {
  assert.match(index, /playerOtpRequestForm/);
  assert.match(index, /requestPlayerOtp/);
  assert.match(index, /if\(playerOtpRequestInFlight\)return/);
  assert.match(index, /playerOtpPending=true;render\(\)/);
  const renderSource=index.slice(index.indexOf('async function render'), index.indexOf('const adminHumanizeStatusLabels'));
  assert.doesNotMatch(renderSource, /signInWithOtp/);
});

test('pending candidature survives OTP and resumes automatically after verification', () => {
  assert.match(index, /pendingSubmissionRequest=null/);
  assert.match(index, /pendingSubmissionRequest=\{contestId:publicContest\?\.id,categoryId,contestantDisplayName\}/);
  assert.match(index, /const pending=pendingSubmissionRequest;[\s\S]*?submitSubmissionValues\(pending\)/);
  assert.match(index, /playerOtpInlineMarkup=\(\)=>/);
});

test('Candidatura reloads participation after switching Contest context', () => {
  assert.match(index, /ensureSubmissionContest\(requestId\)[\s\S]*?if\(session\)await renderStep\(loadParticipantContext\(\),'participant'/);
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

test('active PENDING or APPROVED candidature is blocked before OTP or create_submission', () => {
  assert.match(index, /activeSubmissionForCategory=categoryId=>categoryId&&submissionRows\.some\(row=>row\.category_id===categoryId&&\['PENDING','APPROVED'\]\.includes\(String\(row\.status\|\|''\)\.toUpperCase\(\)\)\)/);
  assert.match(index, /submitSubmissionValues\(request\)[\s\S]*?loadParticipantContext\(\)[\s\S]*?activeSubmissionForCategory\(categoryId\)[\s\S]*?submission_already_exists[\s\S]*?supabase\.rpc\('create_submission'/);
});

test('selected active category disables the candidature CTA and shows the approved copy', () => {
  const wrapper = index.slice(index.lastIndexOf('submissionView=async function(requestId=activeRenderRequestId){await submissionViewWithDeferredOtp'));
  assert.match(index, /id="submissionCategoryGuard"/);
  assert.match(index, /Hai già una candidatura attiva in questa categoria\./);
  assert.match(wrapper, /category\?\.addEventListener\('change',syncCategoryGuard\)/);
  assert.match(wrapper, /if\(button\)button\.disabled=blocked/);
});

test('rejected, withdrawn and cancelled submissions do not enter the active guard', () => {
  assert.match(index, /\['PENDING','APPROVED'\]\.includes\(String\(row\.status\|\|''\)\.toUpperCase\(\)\)/);
  assert.doesNotMatch(index, /\['PENDING','APPROVED','REJECTED','WITHDRAWN','CANCELLED'\]\.includes/);
});

test('anonymous OTP completion checks the participant context before resuming submission', () => {
  const otp = index.slice(index.indexOf('async function verifyPlayerOtp'), index.indexOf('const playerOtpGateView='));
  assert.match(otp, /await loadParticipantContext\(\);if\(activeSubmissionForCategory\(pending\.categoryId\)\)\{await render\(\);return\}/);
  assert.match(otp, /activeSubmissionForCategory\(pending\.categoryId\)[\s\S]*?submitSubmissionValues\(pending\)/);
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


