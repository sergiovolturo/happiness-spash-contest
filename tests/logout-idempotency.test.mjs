import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const logoutHandler = index.slice(index.indexOf('logout.onclick='), index.indexOf('function forgotPasswordView'));
const authListener = index.slice(index.indexOf('supabase.auth.onAuthStateChange'), index.indexOf('login.onclick'));

test('AuthSessionMissingError is classified by stable Supabase error identity', () => {
  const expression = index.match(/const isAuthSessionMissingError=([^;]+);/)?.[1];
  assert.ok(expression);
  const classify = Function(`return ${expression}`)();
  assert.equal(classify({name: 'AuthSessionMissingError', message: 'Auth session missing!'}), true);
  assert.equal(classify({code: 'session_missing'}), true);
  assert.equal(classify({name: 'AuthError', message: 'network error'}), false);
});

test('session-missing logout completes the same local cleanup as normal logout', () => {
  assert.match(index, /const completeLocalLogout=\(\)=>\{clearClientAuthState\(\);currentTab='home';syncAuthButtons\(\);render\(\)\};/);
  assert.match(logoutHandler, /if\(error&&!isAuthSessionMissingError\(error\)\)/);
  assert.match(logoutHandler, /completeLocalLogout\(\);logout\.disabled=false/);
  assert.doesNotMatch(logoutHandler, /alert\(error\.message[^\n]*AuthSessionMissingError/);
});

test('generic signOut errors remain failures and do not claim success', () => {
  assert.match(logoutHandler, /if\(error&&!isAuthSessionMissingError\(error\)\)\{logout\.disabled=false;alert\(error\.message\|\|'Disconnessione non riuscita\. Riprova\.'\);return\}/);
  assert.match(logoutHandler, /catch\(error\)\{logout\.disabled=false;alert\(error\?\.message\|\|'Disconnessione non riuscita\. Riprova\.'\);return\}/);
});

test('local cleanup clears Admin and Player auth state', () => {
  assert.match(index, /function clearClientAuthState\(\)\{session=null;isAdmin=false;settings=null;participantId=null;submissionRows=\[\];mediaRows=\[\];votedCategoryIds=new Set\(\);voteStateError=null;otpPending=false;otpVerified=false;playerOtpEmail='';playerOtpPending=false;/);
  assert.match(index, /const completeLocalLogout=\(\)=>\{clearClientAuthState\(\);currentTab='home';/);
});

test('SIGNED_OUT listener continues to clear state and render anonymously', () => {
  assert.match(authListener, /event==='SIGNED_OUT'/);
  assert.match(authListener, /else\{clearClientAuthState\(\);render\(\)\}/);
});

test('logout remains shared by Admin and Player flows without changing OTP wiring', () => {
  assert.match(index, /logout\.onclick=/);
  assert.match(index, /playerOtpRequestInFlight/);
  assert.match(index, /supabase\.auth\.signInWithOtp\(\{email,options:\{shouldCreateUser:true\}\}\)/);
  assert.match(index, /supabase\.auth\.verifyOtp\(\{email:playerOtpEmail,token,type:'email'\}\)/);
});
