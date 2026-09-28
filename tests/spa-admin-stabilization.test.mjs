import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260929000100_spa_admin_stabilization.sql'), 'utf8');

test('Admin contest loader uses admin_list_contests and keeps temporal fields', () => {
  assert.match(html, /supabase\.rpc\('admin_list_contests'\)/);
  assert.doesNotMatch(html, /admin_list_contests'\);[^]*?supabase\.from\('contests'\)/);
  assert.match(html, /submissions_open_at/);
  assert.match(html, /submissions_close_at/);
});

test('admin_list_contests returns explicit contest fields including the submission window', () => {
  assert.match(migration, /returns table \(/i);
  assert.match(migration, /submissions_open_at timestamptz/);
  assert.match(migration, /submissions_close_at timestamptz/);
  assert.match(migration, /grant execute on function public\.admin_list_contests\(\) to authenticated/i);
});

test('date formatter never renders missing or invalid values as 1 January 1970', () => {
  assert.match(html, /if\(n===null\|\|n===undefined\|\|n===''\)return 'Data non disponibile'/);
  assert.match(html, /Number\.isNaN\(date\.getTime\(\)\)return 'Data non disponibile'/);
  assert.doesNotMatch(html, /fmt\(null\)/);
});

test('Admin lifecycle labels follow DRAFT, BEFORE, OPEN and CLOSED semantics', () => {
  assert.match(html, /contest\.status==='DRAFT'\?'DRAFT'/);
  assert.match(html, /state==='DRAFT'\?'Contest in bozza'/);
  assert.match(html, /state==='BEFORE'\?'Candidature programmate'/);
  assert.match(html, /state==='OPEN'\?'Candidature aperte'/);
  assert.match(html, /'Periodo candidature terminato'/);
  assert.match(html, /enabled:contest\.status==='SUBMISSIONS_OPEN'&&temporalState==='OPEN'/);
});

test('SPA render replaces spinner on failure or timeout and guards stale views', () => {
  assert.match(html, /SPA_RENDER_TIMEOUT_MS=20000/);
  assert.match(html, /render_timeout/);
  assert.match(html, /activeRenderRequestId=0/);
  assert.match(html, /if\(!renderIsCurrent\(\)\)return/);
});
