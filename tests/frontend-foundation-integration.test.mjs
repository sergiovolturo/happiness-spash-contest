import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = index.indexOf('async function loadPublicContest');
const galleryStart = index.indexOf('// Public gallery flow starts here');
const participantEnd = index.indexOf('// Legacy media flow remains below');
const participantFlow = index.slice(start, galleryStart) + index.slice(index.indexOf('// New participant domain flow'), participantEnd);

test('frontend loads Contest and categories only through public RPCs', () => {
  assert.match(participantFlow, /rpc\('get_public_contest'\)/);
  assert.match(participantFlow, /rpc\('get_public_contest_categories'/);
  assert.doesNotMatch(participantFlow, /from\(['"]contests['"]\)|from\(['"]contest_categories['"]\)/);
  assert.match(index, /publicContest\.status/);
});

test('frontend renders unavailable Contest and RPC errors', () => {
  assert.match(participantFlow, /Non ci sono Contest disponibili/);
  assert.match(participantFlow, /Non riesco a caricare il Contest/);
  assert.match(participantFlow, /Non riesco a caricare le categorie/);
  assert.match(participantFlow, /publicContestError/);
  assert.match(participantFlow, /publicCategoryError/);
});

test('frontend uses backend category identity and ordering', () => {
  assert.match(participantFlow, /publicCategories\.map/);
  assert.match(participantFlow, /value="\$\{esc\(c\.id\)\}/);
  assert.match(participantFlow, /c\.name/);
  assert.match(participantFlow, /c\.submission_cap/);
});

test('frontend resolves identity and participation through the single RPC', () => {
  assert.match(participantFlow, /rpc\('ensure_contest_participation'/);
  assert.match(participantFlow, /p_contest_id:publicContest\.id/);
  assert.match(participantFlow, /contest_participation_id/);
  assert.doesNotMatch(participantFlow, /from\(['"]platform_identities['"]\)|from\(['"]contest_participations['"]\)/);
});

test('frontend creates submissions only through create_submission RPC', () => {
  assert.match(participantFlow, /rpc\('create_submission'/);
  assert.match(participantFlow, /p_participation_id:participantId/);
  assert.match(participantFlow, /p_category_id:categoryId/);
  assert.doesNotMatch(participantFlow, /from\(['"]videos['"]\)|from\(['"]votes['"]\)|from\(['"]contest_settings['"]\)/);
});

test('frontend reads new submission status with an explicit mapping', () => {
  assert.match(participantFlow, /from\(['"]submissions['"]\)/);
  assert.match(participantFlow, /submissionStatusLabel/);
  for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
    assert.match(participantFlow, new RegExp(status));
  }
});

test('frontend does not hide submission read errors as an empty list', () => {
  assert.match(participantFlow, /submissionError\?msg\('Non riesco a caricare le tue candidature/);
});

test('frontend maps domain errors without inventing lifecycle rules', () => {
  for (const error of ['contest_not_open', 'category_full', 'submission_already_exists', 'category_inactive', 'contest_category_mismatch', 'participation_not_active', 'contest_not_found', 'unauthorized']) {
    assert.match(participantFlow, new RegExp(error));
  }
  assert.doesNotMatch(participantFlow, /slot|correction_deadline|CORRECTION_EXPIRED/);
});

test('legacy login/signup remains present while new flow avoids hard-coded Contest UUIDs', () => {
  assert.match(index, /supabase\.auth\.signUp/);
  assert.match(index, /supabase\.auth\.signInWithPassword/);
  assert.doesNotMatch(participantFlow, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test('auth initialization does not race the initial session event', () => {
  assert.match(index, /let authReady=false/);
  assert.match(index, /authReady=true;syncAuthButtons\(\);if\(!session\)return render/);
  assert.match(index, /if\(!authReady\)return/);
});

test('public entrypoint exposes the existing email/password auth view without a login wall', () => {
  assert.match(index, /id="login"[^>]*>Accedi/);
  assert.match(index, /login\.onclick=\(\)=>authView\(\)/);
  assert.match(index, /id="loginForm"/);
  assert.match(index, /id="backToContest"/);
  assert.match(index, /currentTab='home';render\(\)/);
  assert.match(index, /async function render\(\)\{syncAuthButtons\(\)/);
});

test('auth buttons follow session state and stale authenticated responses are ignored', () => {
  assert.match(index, /function syncAuthButtons\(\)/);
  assert.match(index, /login\.classList\.toggle\('hidden',authenticated\)/);
  assert.match(index, /logout\.classList\.toggle\('hidden',!authenticated\)/);
  assert.match(index, /let authReady=false,authRequestSeq=0/);
  assert.match(index, /requestId!==authRequestSeq\|\|session!==s/);
  assert.match(index, /else\{isAdmin=false[\s\S]*?render\(\)\}\}\);/);
});

test('media flow uses Step 3 prepare, backend path/bucket and finalize RPCs', () => {
  assert.match(participantFlow, /rpc\('prepare_submission_media_upload'/);
  assert.match(participantFlow, /media\.storage_bucket/);
  assert.match(participantFlow, /media\.storage_path/);
  assert.match(participantFlow, /storage\.from\(media\.storage_bucket\)\.upload/);
  assert.match(participantFlow, /rpc\('finalize_submission_media_upload'/);
  assert.match(participantFlow, /p_media_id:media\.id/);
  assert.doesNotMatch(participantFlow, /session\.user\.id\+['"]\//);
});

test('media flow does not finalize when Storage upload fails', () => {
  const uploadPosition = participantFlow.indexOf('storage.from(media.storage_bucket).upload');
  const finalizePosition = participantFlow.indexOf("rpc('finalize_submission_media_upload'");
  assert.ok(uploadPosition >= 0 && finalizePosition > uploadPosition);
  assert.match(participantFlow.slice(uploadPosition, finalizePosition), /uploaded\.error/);
});

test('media flow validates backend-supported mime and size limits', () => {
  assert.match(participantFlow, /video\/mp4/);
  assert.match(participantFlow, /video\/webm/);
  assert.match(participantFlow, /video\/quicktime/);
  assert.match(participantFlow, /file\.size>10485760/);
});

test('media flow refreshes submission and media state after finalize', () => {
  assert.match(participantFlow, /await loadParticipantContext\(\);await submissionView\(\)/);
  assert.match(participantFlow, /from\(['"]submission_media['"]\)/);
  assert.match(participantFlow, /mediaStatusLabel/);
  assert.match(participantFlow, /is_current/);
});

test('media versioning reuses prepared media and never overwrites Storage objects', () => {
  assert.match(participantFlow, /status==='PREPARED'/);
  assert.match(participantFlow, /media\.original_filename!==file\.name/);
  assert.match(participantFlow, /upsert:false/);
  assert.doesNotMatch(participantFlow, /replace|overwrite/i);
});

test('media finalize retry does not re-upload an object already uploaded', () => {
  assert.match(participantFlow, /uploadedMediaIds\.has\(media\.id\)/);
  assert.match(participantFlow, /uploadedMediaIds\.add\(media\.id\)/);
  assert.match(participantFlow, /uploadedMediaIds\.delete\(media\.id\)/);
  assert.match(participantFlow, /Riprova finalize/);
});

test('media upload is serialized and recovers from network exceptions', () => {
  assert.match(participantFlow, /mediaUploadInFlight\.has\(submissionId\)/);
  assert.match(participantFlow, /mediaUploadInFlight\.add\(submissionId\)/);
  assert.match(participantFlow, /mediaUploadInFlight\.delete\(submissionId\)/);
  assert.match(participantFlow, /catch\(error\).*Connessione interrotta/s);
  assert.match(participantFlow, /button\.disabled=false/);
});

test('successful media completion rebuilds the form and clears the file input', () => {
  assert.match(participantFlow, /await loadParticipantContext\(\);await submissionView\(\)/);
  assert.doesNotMatch(participantFlow, /const\s+lastSelectedFile/);
});

test('new media flow remains isolated from legacy video/vote writes', () => {
  assert.doesNotMatch(participantFlow, /from\(['"]videos['"]\)|from\(['"]votes['"]\)|from\(['"]contest_settings['"]\)/);
  assert.doesNotMatch(participantFlow, /\.insert\(\{[^}]*video_path/);
});
