import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const runtime = index.slice(index.indexOf('<script>'));

test('Admin has no separate voting workspace or duplicate voting grid', () => {
  assert.doesNotMatch(runtime, /renderAdminVotingSection|adminVotingVideos|adminVotingVideoGrid|adminVotingFilters/);
  assert.match(index, /adminSectionLabels=\{overview:'Panoramica',contest:'Configurazione',submissions:'Candidature',results:'Risultati',settings:'Impostazioni'\}/);
});

test('Voting status is shown in Contest and candidature cards remain the video surface', () => {
  assert.match(index, /adminVotingStatusSurface/);
  assert.match(index, /adminSubmissionGrid/);
  assert.match(index, /adminContestSurfaceLegacyFinal/);
  assert.match(index, /adminManualToggle/);
  assert.match(index, /adminRemoveLegacyComposition/);
});

test('The ordinary Admin surface has no vote-verification UI', () => {
  assert.match(runtime, /removeAdminVoteVerificationSurface/);
  assert.doesNotMatch(runtime, /adminVotingSummary|adminVotingVideos/);
  assert.match(runtime, /Cancella voto fraudolento/);
});

