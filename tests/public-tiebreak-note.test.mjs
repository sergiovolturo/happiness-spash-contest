import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('public tiebreak finalist is derived only from a finalist sharing rank with a non-finalist peer', () => {
  assert.match(index, /const publicResultIsTiebreakFinalist=\(row,rows\)=>!!row\?\.is_finalist/);
  assert.match(index, /!peer\.is_finalist/);
  assert.match(index, /Number\(peer\.rank_position\)===Number\(row\.rank_position\)/);
});

test('public finalists retain the Instagram tiebreak note without exposing video results', () => {
  const matches = index.match(/Finalista dopo spareggio su Instagram/g) || [];
  assert.equal(matches.length, 1);
  assert.match(index, /publicOfficialFinalists\.compact li \.publicTiebreakNote\{grid-column:2\}/);
  assert.doesNotMatch(index, /publicResultSummary|resultSummary/);
});

test('public copy does not describe the tiebreak finalist as an Admin choice', () => {
  const compactStart = index.indexOf('const publicOfficialFinalistsCompactMarkup=');
  const compactEnd = index.indexOf('const loadPublicContestSelectionScoped=', compactStart);
  const compact = index.slice(compactStart, compactEnd);
  assert.doesNotMatch(compact, /Scelta dall.Admin|scelta dall.Admin/i);
});
