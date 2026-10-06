import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index=fs.readFileSync('index.html','utf8');
const sourceLine=name=>{
  const raw=index.split(/\r?\n/).find(candidate=>candidate.includes(`const ${name}=`));
  const line=raw?.slice(raw.indexOf(`const ${name}=`));
  assert.ok(line,`missing ${name}`);
  return line;
};
const compile=(name,deps={})=>new Function(...Object.keys(deps),`${sourceLine(name)};return ${name};`)(...Object.values(deps));
const count=(html,pattern)=>(html.match(pattern)||[]).length;

class FakeView{
  constructor(){this.html=''}
  insertAdjacentHTML(position,html){this.html=position==='afterbegin'?html+this.html:this.html+html}
  querySelector(selector){
    if(selector==='#adminOverviewSurface')return this;
    if(selector==='#adminNewContestForm'&&this.html.includes('id="adminNewContestForm"'))return {addEventListener(){},elements:{name:{focus(){}}},hidden:true};
    if(selector==='#adminNewContestToggle'&&this.html.includes('id="adminNewContestToggle"'))return {addEventListener(){}};
    if(selector==='.section-title')return {insertAdjacentHTML:(_position,html)=>{this.html+=html}};
    if(selector==='#adminDraftDeleteContest'&&this.html.includes('id="adminDraftDeleteContest"'))return {remove:()=>{this.html=this.html.replace(/<button[^>]*id="adminDraftDeleteContest"[^>]*>[\s\S]*?<\/button>/,'')}};
    return null;
  }
  querySelectorAll(){return []}
}

const esc=value=>String(value??'');
const fmt=value=>String(value??'');
const renderIsCurrent=()=>true;
const adminReadableStatus=status=>status;
const adminOverviewAction=contest=>contest.status==='DRAFT'?['Configura','contest']:['Gestisci candidature','submissions'];
const adminOverviewMessage=()=> 'Configurazione da completare';
const adminSectionEmpty=compile('adminSectionEmpty');

test('overview final composition has one create control and no archive action on cards',async()=>{
  const rows=[{id:'one',name:'Contest corrente',status:'DRAFT',archived_at:null},{id:'old',name:'Contest storico',status:'CLOSED',archived_at:'2026-09-20T10:00:00Z'}];
  const view=new FakeView();
  const renderOverview=compile('renderAdminOverview',{renderIsCurrent,adminContestRows:rows,adminSelectedContest:rows[0],adminSelectedCategories:[],esc,fmt,adminReadableStatus,adminOverviewAction,adminOverviewMessage});
  const bindCreate=compile('adminBindOverviewCreate',{supabase:{rpc(){throw new Error('submit was not requested')}},adminSlugify:value=>value,adminSelectedContestId:null,adminSection:'overview',currentTab:'admin',render:async()=>{},msg:()=>''});
  await renderOverview(view,1);
  bindCreate(view);
  assert.equal(count(view.html,/\+ Crea nuovo Contest/g),1);
  assert.equal(count(view.html,/data-admin-overview-action="archive"/g),0);
  assert.equal(count(view.html,/id="adminNewContestForm"/g),1);
  assert.match(view.html,/Archivio storico/);
});

test('Contest DRAFT final composition contains only the preparation workflow',async()=>{
  const contest={id:'contest',name:'Contest',description:'',slug:'contest',status:'DRAFT'};
  const view=new FakeView();
  const document={querySelector:()=>null};
  const draft=compile('adminDraftQuickLaunch',{adminSelectedContest:contest,renderIsCurrent,document,adminQuickLaunchValues:()=>({submissionOpenAt:'',submissionCloseAt:'',votingOpenAt:'',votingCloseAt:''}),adminOpeningPrerequisites:()=>({name:true,categories:true,submissionPeriod:true,votingPeriod:true,ordering:true,valid:true}),adminSelectedCategories:[],esc,adminQuickChecklist:()=>'<div>✓ Pronto</div>',msg:()=>'',adminActionsInFlight:new Set(),romeLocalToTimestamptz:value=>value,supabase:{rpc:async()=>({data:null,error:null})},adminQuickCategorySlug:value=>value,adminQuickRefresh:async()=>{},confirm:()=>false,loadAdminContests:async()=>{},adminContestRows:[],adminView:async()=>{}});
  const renderer=compile('renderAdminContestSectionAuthoritative',{renderIsCurrent,adminSelectedContest:contest,adminDraftQuickLaunch:draft,adminVotingStatusSurface:()=>'',adminCloseVoting:()=>{}});
  await renderer(view,1);
  assert.equal(count(view.html,/Prepara il Contest/g),1);
  for(const legacy of ['Moderazione Contest','Inserisci candidatura','Risultati e finalisti','Voti da verificare'])assert.equal(count(view.html,new RegExp(legacy,'g')),0,legacy);
});

test('DRAFT Candidature and Results render only their empty states',async()=>{
  const adminSelectedContest={status:'DRAFT'};
  const candidatureView=new FakeView();
  const candidature=compile('renderAdminSubmissionsSectionAuthoritative',{renderIsCurrent,adminSelectedContest,adminSectionEmpty});
  await candidature(candidatureView,1);
  assert.match(candidatureView.html,/Le candidature non sono ancora aperte/);
  assert.doesNotMatch(candidatureView.html,/adminSubmissionGrid|adminManualSubmission/);

  const resultsView=new FakeView();
  const results=compile('renderAdminResultsSectionAuthoritative',{renderIsCurrent,adminSelectedContest,adminSectionEmpty});
  await results(resultsView,1);
  assert.match(resultsView.html,/I risultati saranno disponibili dopo la chiusura/);
  assert.doesNotMatch(resultsView.html,/Risultati e finalisti|Voti da verificare/);
});

test('Settings final composition owns the configurable note and safe archive control',async()=>{
  const result={data:[],error:null};
  const chain={select(){return this},in(){return this},eq(){return this},then(resolve){resolve(result)}};
  const view=new FakeView();
  const settings=compile('renderAdminSettingsSection',{renderIsCurrent,adminSelectedContest:{id:'contest',name:'Contest',status:'DRAFT',archived_at:null,configuration:{}},document:{querySelector:()=>null},adminClearLegacyAdminSurfaces:()=>{},adminHideElement:()=>{},adminSelectedCategories:[{id:'category'}],supabase:{from:()=>Object.create(chain)},esc,fmt,adminReadableStatus,adminResultStatusLabel:()=>'',adminSettingsCategorySummary:()=>{},adminWorkspaceRefresh:async()=>{},adminArchiveContest:()=>{},adminRestoreContest:()=>{}});
  await settings(view,1);
  assert.equal(count(view.html,/data-admin-archive-contest/g),0);
  assert.doesNotMatch(view.html,/data-admin-delete-contest/);
  assert.match(view.html,/Nota finalista scelto dall’Admin/);
});

test('authoritative render dispatch never invokes the legacy global surface',()=>{
  const renderer=index.slice(index.indexOf('async function renderAdmin('),index.indexOf('adminView=renderAdmin;'));
  assert.doesNotMatch(renderer,/adminContestSurfaceLegacyFinal\(|adminRemoveLegacyComposition/);
  for(const direct of ['renderAdminOverview','renderAdminContestSectionAuthoritative','renderAdminSubmissionsSectionAuthoritative','renderAdminResultsSectionAuthoritative','renderAdminSettingsSection'])assert.match(renderer,new RegExp(direct));
  assert.match(index,/adminSection=button\.dataset\.adminSection;currentTab='admin';render\(\)/);
});
