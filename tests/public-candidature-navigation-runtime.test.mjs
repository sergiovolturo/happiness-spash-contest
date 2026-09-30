import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const index=await readFile(new URL('../index.html',import.meta.url),'utf8');

function createRuntime(){
  let listener;
  const state={currentTab:'home',renderCount:0};
  const context={
    currentTab:state.currentTab,
    render:()=>{state.currentTab=context.currentTab;state.renderCount+=1},
    document:{addEventListener:(type,handler,capture)=>{assert.equal(type,'click');assert.equal(capture,true);listener=handler}},
  };
  const start=index.indexOf('let navBound=false;');
  const end=index.indexOf('\nlet renderRequestSeq',start);
  assert.ok(start>=0&&end>start,'navigation binding must remain in the runtime');
  vm.runInNewContext(`${index.slice(start,end)};bindNav();`,context);
  return {state,context,click(target){listener({target,preventDefault(){this.defaultPrevented=true}})}};
}

const button=tab=>({dataset:{tab},closest(selector){return selector==='[data-tab]'?this:null},parentElement:null});
const childOf=parent=>({closest(){return null},parentElement:{closest(selector){return selector==='[data-tab]'?parent:null}}});

test('delegated navigation survives public rerenders and reaches candidature',()=>{
  const runtime=createRuntime();
  runtime.click(button('upload'));
  assert.equal(runtime.state.currentTab,'upload');
  runtime.click(button('home'));
  runtime.click(button('upload'));
  assert.equal(runtime.state.currentTab,'upload');
  assert.equal(runtime.state.renderCount,3);
});

test('public to candidature loop remains stable for five cycles',()=>{
  const runtime=createRuntime();
  for(let cycle=0;cycle<5;cycle++){
    runtime.click(button('upload'));
    assert.equal(runtime.state.currentTab,'upload');
    runtime.click(button('home'));
    assert.equal(runtime.state.currentTab,'home');
  }
  assert.equal(runtime.state.renderCount,10);
});

test('nested navigation target uses the closest top-level control',()=>{
  const runtime=createRuntime();
  runtime.click(childOf(button('upload')));
  assert.equal(runtime.state.currentTab,'upload');
});

test('bootstrap binds navigation before boot and keeps Admin routing available',()=>{
  const boot=index.indexOf('boot();');
  assert.ok(boot>0);
  assert.ok(index.lastIndexOf('bindNav();',boot)<boot);
  assert.match(index,/if\(isAdmin&&currentTab==='upload'\)currentTab='admin'/);
});
