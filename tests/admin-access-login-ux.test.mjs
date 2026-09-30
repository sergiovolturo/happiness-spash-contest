import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authView = index.slice(index.indexOf('function authView()'), index.indexOf('async function loadContext()'));

test('Admin login surface uses explicit Admin copy', () => {
  assert.match(authView, /<div class="eyebrow">HAPPINESS SPASH CONTEST<\/div>/);
  assert.match(authView, /<h2 id="authTitle">Accesso Admin<\/h2>/);
  assert.match(authView, /<p id="authSub">Accedi per configurare e gestire i contest\.<\/p>/);
  assert.match(authView, /id="email" type="email"/);
  assert.match(authView, /id="password" type="password"/);
  assert.match(authView, /id="authSubmit">Accedi<\/button>/);
});

test('Admin login surface has recovery and discreet return link, without signup copy', () => {
  assert.match(authView, /id="forgotPassword">Password dimenticata\?<\/button>/);
  assert.match(authView, /class="link wide" id="backToContest">← Torna al contest<\/button>/);
  assert.doesNotMatch(authView, /Entra nel contest\.|Accedi per caricare i tuoi highlight e votare\.|Non hai un account\? Registrati/);
  assert.doesNotMatch(authView, /id="toggleAuth"/);
  assert.match(index, /supabase\.auth\.signUp/);
});

test('Player and voter OTP wiring remains unchanged', () => {
  assert.match(index, /playerOtpRequestForm/);
  assert.match(index, /supabase\.auth\.signInWithOtp\(\{email,options:\{shouldCreateUser:true\}\}\)/);
  assert.match(index, /supabase\.auth\.verifyOtp\(\{email:playerOtpEmail,token,type:'email'\}\)/);
  assert.match(index, /id="otpRequestForm"/);
  assert.match(index, /supabase\.auth\.verifyOtp\(\{email:otpEmail,token,type:'email'\}\)/);
});
