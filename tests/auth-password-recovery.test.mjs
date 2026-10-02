import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('login exposes the password recovery entry point and neutral email form', () => {
  assert.match(index, /id="forgotPassword">Password dimenticata\?</);
  assert.match(index, /function forgotPasswordView\(\)/);
  assert.match(index, /id="recoveryRequestForm"/);
  assert.match(index, /Invia link di recupero/);
  assert.match(index, /← Torna al login/);
  assert.match(index, /Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password\./);
});

test('password reset request uses the Production redirect and no obsolete runtime redirect remains', () => {
  assert.match(index, /const AUTH_REDIRECT_URL='https:\/\/sergiovolturo\.github\.io\/happiness-spash-contest\/'/);
  assert.match(index, /supabase\.auth\.resetPasswordForEmail\(email,\{redirectTo:AUTH_REDIRECT_URL\}\)/);
  assert.match(index, /emailRedirectTo:AUTH_REDIRECT_URL/);
  assert.doesNotMatch(index, /gabrieledellatti22\.github\.io/);
});

test('PASSWORD_RECOVERY opens a dedicated form with matching-password validation', () => {
  assert.match(index, /event==='PASSWORD_RECOVERY'/);
  assert.match(index, /function passwordRecoveryView\(\)/);
  assert.match(index, /id="newPassword"/);
  assert.match(index, /id="confirmPassword"/);
  assert.match(index, /if\(newPassword!==confirmPassword\)/);
  assert.match(index, /Le password non coincidono\./);
});

test('recovery updates the password and normalizes the session back to login', () => {
  assert.match(index, /supabase\.auth\.updateUser\(\{password:newPassword\}\)/);
  assert.match(index, /Password aggiornata correttamente\./);
  assert.match(index, /await supabase\.auth\.signOut\(\)/);
  assert.match(index, /authView\(\)/);
});

test('login, signup and logout remain wired to Supabase Auth', () => {
  assert.match(index, /supabase\.auth\.signInWithPassword/);
  assert.match(index, /supabase\.auth\.signUp/);
  assert.match(index, /supabase\.auth\.signOut/);
});
