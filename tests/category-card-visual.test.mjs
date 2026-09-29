import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const styles=[...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match=>match[1]).join('\n');

test('admin category library uses bounded responsive cards with prominent 16:9 visuals',()=>{
  assert.match(styles,/\.categoryManagerList\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,320px\),420px\)\)/);
  assert.match(styles,/\.categoryDefinitionCard\{[^}]*max-width:420px/);
  assert.match(styles,/\.categoryDefinitionCard \.categoryVisualSlot\{[^}]*aspect-ratio:16\/9/);
  assert.match(styles,/\.categoryDefinitionCard \.categoryVisualSlot\{[^}]*object-fit:cover/);
  assert.match(index,/class="card categoryDefinitionCard"/);
});

test('public category cards and single-category presentation share a 16:9 visual treatment',()=>{
  assert.match(styles,/\.publicCategoryGrid,.categorySelector\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles,/\.publicCategoryCard \.categoryVisualSlot,.categoryCard \.categoryVisualSlot\{[^}]*aspect-ratio:16\/9/);
  assert.match(styles,/\.publicCategoryCard \.categoryVisualSlot,.categoryCard \.categoryVisualSlot\{[^}]*object-fit:cover/);
  assert.match(index,/class="card publicCategoryCard"/);
  assert.match(index,/class="card categoryCard active"/);
  assert.match(index,/Guarda i video/);
});

test('category card breakpoints provide 2 columns for tablet and 1 column for 430px/390px mobile widths',()=>{
  assert.match(styles,/@media\(max-width:900px\)\{[\s\S]*?\.publicCategoryGrid,.categorySelector\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles,/@media\(max-width:760px\)\{[\s\S]*?\.publicCategoryGrid,.categorySelector\{grid-template-columns:1fr\}/);
  assert.match(styles,/@media\(max-width:760px\)\{[\s\S]*?\.publicCategoryCard,.categoryCard,.categoryDefinitionCard\{width:100%;max-width:none\}/);
});

test('category cards keep a clean fallback when image_path is absent',()=>{
  assert.match(styles,/\.categoryVisualSlot\{[^}]*background:linear-gradient/);
  assert.ok(index.includes("const categoryImageUrl=category=>{if(!category?.image_path)return '';"));
  assert.match(index,/categoryVisualSlot/);
});
