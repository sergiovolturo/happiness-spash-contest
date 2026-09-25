import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260922000519_admin_contest_lifecycle.sql', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('lifecycle RPCs are Admin-only, fail closed and use an empty search_path', () => {
  for (const name of ['admin_close_contest_submissions', 'admin_start_contest_moderation', 'admin_mark_contest_ready_for_voting', 'open_contest_voting']) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    const end = migration.indexOf('$function$;', start);
    const body = migration.slice(start, end);
    assert.notEqual(start, -1, `${name} exists`);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = ''/i);
    assert.match(body, /public\.admin_users/);
    assert.match(body, /admin_required/);
  }
  for (const name of ['admin_close_contest_submissions', 'admin_start_contest_moderation', 'admin_mark_contest_ready_for_voting']) {
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}\\(uuid\\) from public,anon,service_role`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to authenticated`, 'i'));
  }
  assert.match(migration, /revoke execute on function public\.open_contest_voting\(uuid\) from public,anon,service_role/i);
  assert.match(migration, /grant execute on function public\.open_contest_voting\(uuid\) to authenticated/i);
  assert.match(migration, /revoke execute on function public\._contest_voting_readiness\(uuid\) from public,anon,authenticated,service_role/i);
});

test('transitions are monotonic and only allow the immediately following state', () => {
  assert.match(migration, /v_contest\.status<>'SUBMISSIONS_OPEN'[\s\S]*?invalid_contest_transition/i);
  assert.match(migration, /v_contest\.status<>'SUBMISSIONS_CLOSED'[\s\S]*?invalid_contest_transition/i);
  assert.match(migration, /v_contest\.status not in \('MODERATION','READY_FOR_VOTING'\)[\s\S]*?invalid_contest_transition/i);
  assert.match(migration, /if v_contest\.status='SUBMISSIONS_CLOSED' then return v_contest/i);
  assert.match(migration, /if v_contest\.status='MODERATION' then return v_contest/i);
  assert.match(migration, /v_contest\.status<>'READY_FOR_VOTING'[\s\S]*?contest_not_ready_state/i);
  assert.doesNotMatch(migration, /update public\.contests[\s\S]*status\s*=\s*'SUBMISSIONS_OPEN'/i);
});

test('READY check matches Step 4 and does not bypass approval/media readiness', () => {
  assert.match(migration, /public\._contest_voting_readiness\(p_contest_id\)/i);
  assert.match(migration, /s\.status='APPROVED'/i);
  assert.match(migration, /s\.status='PENDING'/i);
  assert.match(migration, /s\.status in \('PENDING','APPROVED','REJECTED','WITHDRAWN','CANCELLED'\)/i);
  assert.match(migration, /sm\.status='FINALIZED'[\s\S]*?sm\.is_current/i);
  assert.match(migration, /message='contest_not_ready'/i);
  assert.match(migration, /for update of s/i);
});

test('opening voting publishes atomically and is limited to READY_FOR_VOTING', () => {
  const start = migration.indexOf('create or replace function public.open_contest_voting');
  const end = migration.indexOf('$function$;', start);
  const body = migration.slice(start, end);
  assert.match(body, /v_contest\.status<>'READY_FOR_VOTING'/i);
  assert.match(body, /public\._contest_voting_readiness\(p_contest_id\)/i);
  assert.match(body, /insert into public\.submission_publications/i);
  assert.match(body, /s\.status='APPROVED'/i);
  assert.match(body, /sm\.status='FINALIZED'[\s\S]*?sm\.is_current/i);
  assert.match(body, /set status='VOTING_OPEN'/i);
});

test('Admin UI offers only the transition appropriate to current Contest state', () => {
  const start = index.indexOf('function adminLifecycleActions');
  const end = index.indexOf('\n', start);
  const actions = index.slice(start, end);
  assert.match(actions, /SUBMISSIONS_OPEN:\['admin_close_contest_submissions','Chiudi candidature'\]/);
  assert.match(actions, /SUBMISSIONS_CLOSED:\['admin_start_contest_moderation','Avvia moderazione'\]/);
  assert.match(actions, /MODERATION:\['admin_mark_contest_ready_for_voting'/);
  assert.match(actions, /READY_FOR_VOTING:\['open_contest_voting','Apri votazione'\]/);
  assert.match(actions, /status==='VOTING_OPEN'/);
  assert.match(index, /current\.outerHTML=adminLifecycleActions\(\)/);
  assert.match(index, /querySelectorAll\('\[data-contest-transition\]'\)/);
  assert.match(index, /adminRunContestTransition\(button\.dataset\.contestTransition\)/);
  assert.match(index, /invalid_contest_transition:'Il Contest non può passare allo stato richiesto\.'/);
});
