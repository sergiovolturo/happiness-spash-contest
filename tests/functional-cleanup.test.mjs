import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260928000100_functional_cleanup.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('submission window is configured and enforced before, during and after the window', () => {
  assert.match(migration, /admin_set_submission_window/);
  assert.match(migration, /p_open_at timestamptz/);
  assert.match(migration, /p_close_at timestamptz/);
  assert.match(migration, /p_open_at >= p_close_at/);
  assert.match(migration, /now\(\) >= c\.submissions_open_at/);
  assert.match(migration, /now\(\) < c\.submissions_close_at/);
  assert.match(migration, /submission_window_required/);
  assert.match(index, /submissionWindowState/);
  assert.match(index, /Il periodo di candidatura non è ancora aperto/);
  assert.match(index, /Il periodo di candidatura è terminato/);
});

test('player and admin submissions require an explicit contestant display name', () => {
  assert.match(migration, /contestant_display_name text/);
  assert.match(migration, /contestant_display_name_required/);
  assert.match(migration, /create_submission[\s\S]*p_contestant_display_name text default null/);
  assert.match(migration, /admin_create_submission_with_media[\s\S]*p_contestant_display_name text default null/);
  assert.match(index, /name="contestantDisplayName"/);
  assert.match(index, /p_contestant_display_name:document\.querySelector\('#contestantDisplayName'\)\.value\.trim\(\)/);
  assert.match(index, /p_contestant_display_name:form\.elements\.contestantDisplayName\.value\.trim\(\)/);
});

test('public gallery displays candidate and real category context', () => {
  assert.match(migration, /s\.contestant_display_name/);
  assert.match(migration, /cc\.name as category_name/);
  assert.match(index, /row\.contestant_display_name/);
  assert.match(index, /row\.category_name/);
});

test('admin vote review keeps IDs internal and provides readable fraud deletion CTA', () => {
  assert.match(index, /Voti da verificare/);
  assert.match(index, /deleteFraudVote/);
  assert.match(index, /v\.contestant_display_name/);
  assert.doesNotMatch(index, /<b>\\$\\{esc\\(v\\.id\\)\\}/);
  assert.doesNotMatch(index, /submission \\$\\{esc\\(v\\.submission_id\\)\\}/);
});

test('voting and publication primitives remain wired', () => {
  assert.match(index, /cast_contest_vote/);
  assert.match(index, /published_submission_media/);
  assert.match(migration, /drop view public\.published_submission_media/);
});
