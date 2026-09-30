import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const cardStart = index.indexOf('const adminSubmissionCardHtml=');
const cardEnd = index.indexOf('const adminAddCategoryFieldLabels=', cardStart);
const card = index.slice(cardStart, cardEnd);

test('Admin candidature card keeps candidate and category as primary information', () => {
  assert.match(card, /row\.contestant_display_name/);
  assert.match(card, /row\.category_name/);
  assert.match(card, /Categoria:/);
});

test('Admin candidature card exposes human Player and Admin origin labels', () => {
  assert.match(index, /Inserita dall’Admin/);
  assert.match(index, /Inserita dal partecipante/);
  assert.match(card, /adminSubmissionOriginLabel/);
});

test('Admin candidature card includes participant identity and contact email when available', () => {
  assert.match(card, /Partecipante:/);
  assert.match(card, /Email:/);
  assert.match(card, /workspace\.identities/);
  assert.match(index, /select\('id,participation_id,creation_source'\)/);
});

test('ordinary Admin candidature card hides technical media and identifier copy', () => {
  assert.doesNotMatch(card, />FINALIZED</);
  assert.doesNotMatch(card, />PREPARED</);
  assert.doesNotMatch(card, /Apri player grande/);
  assert.doesNotMatch(card, /Video candidatura \$\{esc\(row\.submission_id\)\}/);
  assert.match(card, /Video caricato/);
  assert.match(card, /Pubblicato/);
});

test('Admin candidature card renders one consistent inline 16:9 player area', () => {
  assert.match(card, /class="adminSubmissionMedia"/);
  assert.match(card, /<video controls preload="metadata" playsinline/);
  assert.match(index, /\.adminSubmissionMedia video\{width:100%;max-width:none;aspect-ratio:16\/9/);
});

test('Elimina video is attached to the media area, not a separate UUID list', () => {
  assert.match(card, /class="adminMediaActions"/);
  assert.match(card, /data-media-delete data-media-id/);
  assert.match(card, /Elimina video/);
  assert.doesNotMatch(index, /adminMediaDeletionSurface/);
  assert.doesNotMatch(index, /Elimina definitivamente video/);
});

test('media deletion keeps reason, confirmation, prepare, Storage remove, cancel and finalize workflow', () => {
  assert.match(index, /adminMediaDeletionReason/);
  assert.match(index, /Scrivi ELIMINA/);
  assert.match(index, /admin_prepare_media_deletion/);
  assert.match(index, /storage\.remove\(\[plan\.storage_path\]\)/);
  assert.match(index, /admin_cancel_media_deletion/);
  assert.match(index, /admin_finalize_media_deletion/);
  assert.match(index, /render\(\)/);
});

test('Admin candidature cards use a two-column desktop composition', () => {
  assert.match(index, /\.adminSubmissionGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(index, /\.adminSubmission\{.*grid-template-columns:minmax\(235px,1\.05fr\) minmax\(230px,1fr\)/);
  assert.match(card, /adminSubmissionInfo/);
  assert.match(card, /adminSubmissionMedia/);
});

test('Admin candidature cards stack information before media on narrow screens', () => {
  assert.match(index, /\.adminSubmission\{grid-template-columns:1fr\}/);
  assert.match(index, /\.adminSubmission video\{height:auto;aspect-ratio:16\/9/);
});

test('moderation and publication actions remain attached to the card', () => {
  assert.match(card, /adminModerate/);
  assert.match(card, /data-decision="APPROVED"/);
  assert.match(card, /data-decision="REJECTED"/);
  assert.match(card, /adminRevoke/);
  assert.match(index, /querySelectorAll\('\[data-media-delete\]'\)/);
});

