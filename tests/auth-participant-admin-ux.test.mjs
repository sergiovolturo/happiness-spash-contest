import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const syncAuthButtons = index.slice(index.indexOf('function syncAuthButtons()'), index.indexOf('function clearClientAuthState'));

test('participant sessions keep Admin access visible while showing logout', () => {
  assert.match(syncAuthButtons, /const authenticated=!!session,adminAuthenticated=authenticated&&isAdmin/);
  assert.match(syncAuthButtons, /login\.classList\.toggle\('hidden',adminAuthenticated\)/);
  assert.match(syncAuthButtons, /logout\.classList\.toggle\('hidden',!authenticated\)/);
});

test('Admin authorization remains server-backed by admin_users', () => {
  assert.match(index, /from\('admin_users'\)\.select\('user_id'\)\.maybeSingle\(\)/);
  assert.match(index, /function nav\(\)\{const tabs=isAdmin\?\[\['home','Contest'\],\['admin','Amministra'\]\]/);
  assert.match(index, /if\(!isAdmin\|\|!session\)\{view\.innerHTML=msg\('Accesso non autorizzato\.'/);
});

test('Admin contest RPCs revalidate the authenticated session before loading contests', () => {
  assert.match(index, /async function loadAdminContests\(\)\{const current=await supabase\.auth\.getSession\(\)/);
  assert.match(index, /await loadContext\(\);if\(!isAdmin\)throw Object\.assign\(new Error\('admin_session_required'\)/);
  assert.match(index, /if\(error\?\.code==='admin_session_required'\)\{currentTab='home';if\(session\)render\(\);else authView\(\);return\}/);
});

test('Participant and voter OTP refresh the Admin membership state without granting Admin implicitly', () => {
  assert.match(index, /session=data\.session;await loadContext\(\);playerOtpPending=false/);
  assert.match(index, /session=data\.session;await loadContext\(\);verifiedVoterSession=data\.session/);
  assert.match(index, /event==='SIGNED_IN'&&identityChanged/);
});

test('Recovery copy stays neutral and does not enumerate accounts', () => {
  assert.match(index, /resetPasswordForEmail\(email,\{redirectTo:AUTH_REDIRECT_URL\}\)/);
  assert.match(index, /Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password\./);
});
