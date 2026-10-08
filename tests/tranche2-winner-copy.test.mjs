import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const active = index.slice(index.indexOf('const adminCompactResultsCategoryWithoutWinner'), index.indexOf('const adminCompactResultsMarkupWithoutWinner'));

test('Admin tie replacement copy is clear and non-technical', () => {
  assert.match(active, /Cambia finalista scelto per la parità/);
  assert.doesNotMatch(active, /Cambia finalista selezionato/);
});

test('Admin winner guidance explains the Instagram final', () => {
  assert.match(active, /Dopo la finale su Instagram, seleziona il vincitore tra i finalisti ufficiali\./);
  assert.doesNotMatch(active, /Finalista ufficiale pubblicato dopo la finale Instagram\./);
});
