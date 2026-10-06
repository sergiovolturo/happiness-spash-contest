import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tieRows = [
  { id: 'uuid-a', contestant_display_name: 'Nome Cognome' },
  { id: 'uuid-b', contestant_display_name: 'Secondo Candidato' },
  { id: 'uuid-c', contestant_display_name: '' },
];
const label = (submissionId, votes) => {
  const row = tieRows.find(item => item.id === submissionId);
  return `${String(row?.contestant_display_name || '').trim() || 'Candidato senza nome'} · ${votes} voti`;
};

test('tie rows show contestant_display_name for every candidate', () => {
  assert.equal(label('uuid-a', 0), 'Nome Cognome · 0 voti');
  assert.equal(label('uuid-b', 3), 'Secondo Candidato · 3 voti');
  assert.match(index, /contestant_display_name/);
  assert.match(index, /adminTieCandidateName/);
});

test('submission UUID stays internal and does not appear in visible tie text', () => {
  const submissionId = '709ed73b-e80d-42c1-af7b-856f46570ce3';
  const visible = label('uuid-a', 0);
  assert.doesNotMatch(visible, new RegExp(submissionId));
  assert.match(index, /input\.dataset\.submissionId=input\.value/);
  assert.match(index, /data-tie-selection/);
});

test('tie checkbox keeps submission_id as value and selected IDs are unchanged', () => {
  const submissionId = 'uuid-a';
  const checkbox = { value: submissionId, dataset: {} };
  checkbox.dataset.submissionId = checkbox.value;
  assert.equal(checkbox.value, submissionId);
  assert.equal(checkbox.dataset.submissionId, submissionId);
  assert.match(index, /map\(input=>input\.value\)/);
  assert.match(index, /p_selected_submission_ids:selected/);
});

test('multiple tied candidates render independently with readable fallback', () => {
  assert.deepEqual(['uuid-a', 'uuid-b', 'uuid-c'].map(id => label(id, 0)), [
    'Nome Cognome · 0 voti',
    'Secondo Candidato · 0 voti',
    'Candidato senza nome · 0 voti',
  ]);
  assert.match(index, /name\|\|'Candidato senza nome'/);
  const presentation = index.slice(index.indexOf('const adminTieCandidateName'), index.indexOf('const renderAdminWithPublicFinalistsFlow'));
  assert.doesNotMatch(presentation, /submission_id|UUID|submission \$/i);
});
