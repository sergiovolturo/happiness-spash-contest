import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Player hides submission controls after submissions close', () => {
  assert.match(index, /Candidature chiuse/);
  assert.match(index, /La fase di candidatura per questo Contest è terminata\./);
  assert.match(index, /Se hai già partecipato, accedi per controllare lo stato della tua candidatura\./);
  assert.match(index, /if\(!open\)\{if\(form\)form\.remove\(\)/);
});

test('Player open-submissions copy is human and anonymous entry preserves category', () => {
  assert.match(index, /Scegli la categoria e invia il tuo video\./);
  assert.match(index, /Continua con la tua email/);
  assert.match(index, /pendingSubmissionCategoryId/);
  assert.match(index, /authView\(\)/);
});

test('Player statuses and submitted-video copy avoid technical terminology', () => {
  assert.match(index, /PENDING:'In attesa di approvazione'/);
  assert.match(index, /FINALIZED:'Video caricato'/);
  assert.match(index, /Qui puoi controllare lo stato dei video che hai inviato\./);
  assert.match(index, /option\.textContent\.split\(' · cap '\)\[0\]/);
});

test('Voter confirmation states one definitive vote per category', () => {
  assert.match(index, /Puoi votare una sola volta in questa categoria\. Il voto è definitivo\./);
  assert.match(index, /Verifica la tua email per votare/);
});
