import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const index=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
const migration=fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20260929000400_admin_candidature_vote_counts.sql'),'utf8');

test('workspace navigation has no separate voting tab',()=>{
  assert.match(index,/adminSectionLabels=\{overview:'Panoramica',contest:'Contest',submissions:'Candidature',results:'Risultati',settings:'Impostazioni'\}/);
  assert.doesNotMatch(index,/adminSectionLabels=\{[^}]*voting:/);
  assert.doesNotMatch(index,/adminSection==='voting'/);
});

test('Contest section owns voting schedule and status',()=>{
  assert.match(index,/VOTAZIONE/);
  assert.match(index,/voting_open_at/);
  assert.match(index,/voting_close_at/);
  assert.match(index,/Votazione aperta/);
  assert.match(index,/si aprirà automaticamente/);
});

test('Admin candidature cards show protagonist, uploader, publication and vote count',()=>{
  assert.match(index,/contestant_display_name/);
  assert.match(index,/Caricato da/);
  assert.match(index,/Voti ricevuti/);
  assert.match(migration,/PUBBLICATO/);
  assert.match(index,/admin_list_contest_submission_cards/);
});

test('vote counts are server-side, Admin-only and Contest-scoped',()=>{
  assert.match(migration,/create or replace function public\.admin_list_contest_submission_cards\(p_contest_id uuid\)/);
  assert.match(migration,/select count\(\*\) from public\.contest_votes cv where cv\.submission_id=s\.id and cv\.category_id=s\.category_id/);
  assert.match(migration,/cc\.contest_id=p_contest_id/);
  assert.match(migration,/revoke execute on function public\.admin_list_contest_submission_cards\(uuid\) from public,anon,service_role/);
  assert.match(migration,/grant execute on function public\.admin_list_contest_submission_cards\(uuid\) to authenticated/);
  assert.match(index,/contest_votes/);
  assert.match(migration,/count\(\*\)/);
});

test('public surface does not receive Admin vote counts or uploader identity',()=>{
  const publicStart=index.lastIndexOf('async function loadPublicGallery');
  const publicEnd=index.indexOf('async function homeView',publicStart);
  const publicSurface=index.slice(publicStart,publicEnd);
  assert.doesNotMatch(publicSurface,/vote_count|voteCount|uploader_email|created_by_auth_user_id/);
});
