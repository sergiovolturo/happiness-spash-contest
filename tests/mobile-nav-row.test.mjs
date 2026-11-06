import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('mobile public navigation uses three non-wrapping equal columns', () => {
  const mobileNav = index.match(/@media\(max-width:760px\)\{\.nav\{([^}]+)\}\.nav \.btn\{([^}]+)\}\}/);
  assert.ok(mobileNav, 'mobile .nav rule must be present');
  assert.match(mobileNav[1], /display:grid/);
  assert.match(mobileNav[1], /grid-template-columns:repeat\(3,minmax\(0,1fr\)/);
  assert.match(mobileNav[1], /gap:4px/);
  assert.match(mobileNav[1], /flex-wrap:nowrap/);
  assert.match(mobileNav[2], /white-space:nowrap/);
  assert.match(mobileNav[2], /min-width:0/);
  assert.match(mobileNav[2], /padding:10px 4px/);
});

test('public navigation labels remain unchanged and ordered', () => {
  const nav = index.match(/function nav\(\)\{([\s\S]*?)\n?\}/)?.[1] || '';
  assert.match(nav, /\['home','Contest'\]/);
  assert.match(nav, /\['upload','Candidatura'\]/);
  assert.match(nav, /\['hall-of-fame','Hall Of Fame'\]/);
  assert.ok(nav.indexOf("['home','Contest']") < nav.indexOf("['upload','Candidatura']"));
  assert.ok(nav.indexOf("['upload','Candidatura']") < nav.indexOf("['hall-of-fame','Hall Of Fame']"));
});
