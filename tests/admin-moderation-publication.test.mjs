import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adminFlow = index.slice(index.indexOf('const adminErrorLabel'), index.indexOf('async function updateSettings'));

test('Admin flow reads new-domain submissions, media and publications explicitly', () => {
  assert.match(adminFlow, /from\('submissions'\)\.select\('id,participation_id,category_id,status,rejection_reason,created_at,updated_at'\)/);
  assert.match(adminFlow, /from\('submission_media'\)\.select\('id,submission_id,storage_bucket,storage_path/);
  assert.match(adminFlow, /from\('submission_publications'\)\.select\('id,submission_id,media_id/);
});

test('Admin moderation uses the Step 3 RPC and never updates submissions directly', () => {
  assert.match(adminFlow, /rpc\('moderate_submission'/);
  assert.match(adminFlow, /p_submission_id:id/);
  assert.match(adminFlow, /p_decision:decision/);
  assert.doesNotMatch(adminFlow, /from\(['"]submissions['"]\).*\.update/);
});

test('Admin rejection requires a reason and approval requires current finalized media', () => {
  assert.match(adminFlow, /decision==='REJECTED'/);
  assert.match(adminFlow, /!reason\|\|!reason\.trim\(\)/);
  assert.match(adminFlow, /s\.status==='PENDING'&&current/);
});

test('publication is backend-controlled by open_contest_voting readiness RPC', () => {
  assert.match(adminFlow, /rpc\('open_contest_voting'/);
  assert.match(adminFlow, /p_contest_id:publicContest\.id/);
  assert.match(adminFlow, /Verifica readiness e apri votazione/);
  assert.doesNotMatch(adminFlow, /submission_publications['"]\)\.insert/);
});

test('Admin revoke uses the Step 4 RPC and collects the required reason', () => {
  assert.match(adminFlow, /rpc\('revoke_published_submission'/);
  assert.match(adminFlow, /p_publication_id:id/);
  assert.match(adminFlow, /p_revoke_reason:reason/);
});

test('new Admin flow does not use legacy videos, votes or settings writes', () => {
  assert.doesNotMatch(adminFlow, /from\(['"]videos['"]\)/);
  assert.doesNotMatch(adminFlow, /from\(['"]votes['"]\)/);
  assert.doesNotMatch(adminFlow, /updateSettings\(/);
  assert.doesNotMatch(adminFlow, /\.from\(['"]contest_settings['"]\).*\.update/);
});

test('Admin flow stays behind the existing Admin gate and shows publication state', () => {
  assert.match(adminFlow, /if\(!isAdmin\|\|!session\)return/);
  assert.match(adminFlow, /Publication: \$\{activePublication\?'attiva':latestPublication\?'revocata':'non pubblicata'\}/);
  assert.match(adminFlow, /current\?await adminSignedMedia\(current\):''/);
  assert.match(adminFlow, /storage\.from\(media\.storage_bucket\)\.createSignedUrl\(media\.storage_path/);
});

test('logout clears Admin state and participant Admin actions require an active session', () => {
  assert.match(index, /isAdmin=false;settings=null;participantId=null;submissionRows=\[\];mediaRows=\[\];votedCategoryIds=new Set\(\);voteStateError=null;otpPending=false;otpVerified=false;adminResultsRequestSeq\+\+;galleryRequestSeq\+\+;clearGalleryObjectUrls\(\);galleryRows=\[\];galleryLoadedContestId=null;authView\(\)/);
  assert.match(adminFlow, /if\(!isAdmin\|\|!session\)return/);
});

test('Admin moderation, revoke and open-voting actions are serialized', () => {
  assert.match(adminFlow, /adminActionsInFlight\.has\(key\)/);
  assert.match(adminFlow, /adminActionsInFlight\.add\(key\)/);
  assert.match(adminFlow, /adminActionsInFlight\.delete\(key\)/);
  assert.match(adminFlow, /button\.disabled=true/);
});

test('Admin reads and actions handle network exceptions without false success', () => {
  assert.match(adminFlow, /Connessione interrotta\. Riprova\./);
  assert.match(adminFlow, /try\{results=await Promise\.all/);
  assert.match(adminFlow, /catch\(error\)\{const box=document\.querySelector\('#adminMsg'\)/);
});
