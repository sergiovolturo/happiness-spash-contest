import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const adminStart = index.lastIndexOf('async function adminView');
const adminEnd = index.indexOf('\nasync function updateSettings', adminStart);
const admin = index.slice(adminStart, adminEnd);

test('Admin moderation renders every category section, including empty and inactive categories', () => {
  assert.match(admin, /categories\.map\(async category/);
  assert.match(admin, /rows\.length} candidature/);
  assert.match(admin, /Nessuna candidatura in questa categoria/);
  assert.match(admin, /category\.is_active\?'':' · inattiva'/);
  assert.match(admin, /order\('display_order'\)/);
});

test('moderation cards include participant/source, state, media/publication state and existing actions', () => {
  assert.match(admin, /identityByParticipation/);
  assert.match(admin, /creation_source/);
  assert.match(admin, /Media: \$\{current\?/);
  assert.match(admin, /Publication: \$\{active\?/);
  assert.match(admin, /adminModerate/);
  assert.match(admin, /adminRevoke/);
  assert.match(index, /\.adminSubmission video\{width:100%;max-width:640px;aspect-ratio:16\/9/);
  assert.match(index, /\.adminSubmissionGrid\{grid-template-columns:repeat\(auto-fit,minmax\(420px,1fr\)/);
  assert.match(index, /\.adminSubmissionInfo \.actions\{margin-top:auto/);
  assert.match(index, /Apri player grande/);
});

test('moderation remains Admin-gated and keeps the existing readiness RPC', () => {
  assert.match(admin, /if\(!isAdmin\|\|!session\)/);
  assert.match(index, /rpc\('open_contest_voting'/);
  assert.match(index, /renderAdminResults\(view\)/);
});

test('Admin navigation hides the Player Candidatura tab and recovery upload stays Admin-side', () => {
  assert.match(index, /function nav\(\)\{const tabs=isAdmin\?\[\['home','Contest'\],\['admin','Amministra'\]\]/);
  assert.match(index, /adminPreparedUpload/);
});

test('Admin manual submission explains its operational use and remains desktop-first', () => {
  assert.match(index, /video ricevuti via WhatsApp o email/);
  assert.match(index, /adminManualIntro/);
  assert.match(index, /adminManualForm\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)/);
});
