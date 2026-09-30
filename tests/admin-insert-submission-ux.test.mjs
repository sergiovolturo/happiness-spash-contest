import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const formStart = index.indexOf('function adminManualSubmissionForm');
const formEnd = index.indexOf('const adminMimeByExtension', formStart);
const form = index.slice(formStart, formEnd);
const bindStart = index.indexOf('function bindAdminManualSubmission');
const bindEnd = index.indexOf('async function adminContestSurfaceLegacy', bindStart);
const bind = index.slice(bindStart, bindEnd);

test('Admin insert route reaches the authoritative candidature renderer', () => {
  assert.match(index, /else if\(adminSection==='submissions'\)await renderAdminSubmissionsSectionAuthoritative\(view,requestId\)/);
  assert.match(index, /windowOpen\?adminManualSubmissionForm\(adminSelectedCategories,workspace\.identities\)/);
  assert.match(index, /if\(windowOpen\).*bindAdminManualSubmission\(\)/);
});

test('Admin form distinguishes participant from public candidate name', () => {
  assert.match(form, />Partecipante<\/label>/);
  assert.match(form, /La persona che presenta o gestisce questa candidatura/);
  assert.match(form, />Nome candidato\/protagonista<\/label>/);
  assert.match(form, /È il nome che verrà mostrato pubblicamente nella candidatura/);
  assert.match(form, /data-admin-new-participant-fields/);
});

test('contact email is explicitly non-authentication contact data', () => {
  assert.match(form, /Email di contatto \(facoltativa\)/);
  assert.match(form, /Non crea un account e non invia codici di accesso/);
  assert.doesNotMatch(bind, /signInWithOtp|verifyOtp|admin_create_identity/);
});

test('existing participant is reused and new participant fields are not sent for it', () => {
  assert.match(form, /value=\"\$\{i\.participation_id\?'participation:'\+i\.participation_id:'identity:'\+i\.identity_id\}\"/);
  assert.match(bind, /adminManualParticipantKind\(selection\)/);
  assert.match(bind, /p_display_name:participantKind==='new'\?/);
  assert.match(bind, /p_contact_email:participantKind==='new'\?/);
  assert.match(bind, /p_participation_id:participationId/);
  assert.match(bind, /p_identity_id:identityId/);
});

test('manual submission lifecycle remains staged for moderation', () => {
  assert.match(form, /in attesa di moderazione prima della pubblicazione/);
  assert.match(bind, /admin_create_submission_with_media/);
  assert.match(bind, /adminUploadAndFinalize/);
  assert.match(bind, /await render\(\)/);
});
