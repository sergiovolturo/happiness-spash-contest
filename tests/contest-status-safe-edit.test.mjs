import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260930000200_safe_contest_editing.sql',import.meta.url),'utf8');

const phase=(status,open,close,now)=>{
  if(status==='DRAFT')return 'DRAFT';
  if(open!==null&&now<open)return 'BEFORE';
  if(close!==null&&now>=close)return 'CLOSED';
  return 'OPEN';
};
const validWindow=(submissionOpen,submissionClose,votingOpen,votingClose)=>submissionOpen<submissionClose&&submissionClose<=votingOpen&&votingOpen<votingClose;

test('temporal status labels distinguish scheduled/open/closed submission and voting windows',()=>{
  const now=Date.parse('2026-10-01T12:00:00Z');
  assert.equal(phase('DRAFT',null,null,now),'DRAFT');
  assert.equal(phase('SUBMISSIONS_OPEN',now+3600000,now+7200000,now),'BEFORE');
  assert.equal(phase('SUBMISSIONS_OPEN',now-3600000,now+3600000,now),'OPEN');
  assert.equal(phase('SUBMISSIONS_OPEN',now-7200000,now-3600000,now),'CLOSED');
  assert.equal(phase('VOTING_OPEN',now+3600000,now+7200000,now),'BEFORE');
  assert.equal(phase('VOTING_OPEN',now-3600000,now+3600000,now),'OPEN');
  assert.equal(phase('VOTING_OPEN',now-7200000,now-3600000,now),'CLOSED');
  assert.match(index,/adminReadableStatus=\(contest,nowMs=Date\.now\(\)\)=>/);
  assert.match(index,/Candidature programmate/);
  assert.match(index,/Votazione programmata/);
});

test('date validation preserves the complete Contest ordering',()=>{
  const base=Date.parse('2026-10-01T12:00:00Z');
  assert.equal(validWindow(base+1,base+2,base+2,base+3),true);
  assert.equal(validWindow(base+2,base+1,base+2,base+3),false);
  assert.equal(validWindow(base+1,base+3,base+2,base+4),false);
  assert.equal(validWindow(base+1,base+2,base+4,base+3),false);
  assert.match(migration,/p_submissions_open_at >= p_submissions_close_at/);
  assert.match(migration,/p_submissions_close_at > p_voting_open_at/);
  assert.match(migration,/p_voting_open_at >= p_voting_close_at/);
});

test('DRAFT and scheduled Contest editing is exposed through one server-side configuration RPC',()=>{
  assert.match(migration,/create or replace function public\.admin_update_contest_configuration\(/i);
  assert.match(migration,/v_contest\.status not in \('DRAFT','SUBMISSIONS_OPEN'\)/i);
  assert.match(migration,/p_submissions_open_at <= now\(\)/i);
  assert.match(index,/admin_update_contest_configuration/);
  assert.match(index,/Salva configurazione/);
});

test('open submissions preserve competitive structure while allowing safe future edits',()=>{
  assert.match(migration,/v_submissions_started/);
  assert.match(migration,/p_submissions_open_at is distinct from v_contest\.submissions_open_at/);
  assert.match(migration,/p_submissions_close_at <= now\(\)/);
  assert.match(index,/Categorie, cap, finalisti e ordine proteggono lo storico esistente/);
  assert.match(index,/safeEdit/);
});

test('category history, cap and post-voting structural protections remain backend enforced',async()=>{
  assert.match(migration,/create trigger contest_categories_configuration_guard/);
  assert.match(migration,/category_configuration_closed/);
  const categoryMigration=await readFile(new URL('../supabase/migrations/20260922000516_admin_category_management.sql',import.meta.url),'utf8');
  assert.match(categoryMigration,/category_cap_below_occupied/);
  assert.match(categoryMigration,/category_has_history/);
  assert.match(categoryMigration,/category_identity_has_history/);
});

test('least-privilege ACL is preserved for safe editing RPCs',()=>{
  assert.match(migration,/revoke all on function public\.admin_update_contest_configuration\([^;]+ from public,anon,service_role/i);
  assert.match(migration,/grant execute on function public\.admin_update_contest_configuration\([^;]+ to authenticated/i);
  assert.match(migration,/revoke all on function public\._guard_contest_category_configuration\(\) from public,anon,authenticated,service_role/i);
});
