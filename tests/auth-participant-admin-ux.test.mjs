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

test('Admin recovery copy stays generic and does not enumerate accounts', () => {
  assert.match(index, /resetPasswordForEmail\(email,\{redirectTo:AUTH_REDIRECT_URL\}\)/);
  assert.match(index, /Se l’indirizzo è associato a un account Admin, riceverai le istruzioni\./);
});
