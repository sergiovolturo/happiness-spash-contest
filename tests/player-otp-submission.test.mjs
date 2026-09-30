Warning: truncated output (original token count: 1286)
Total output lines: 117

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
co…1186 tokens truncated…s wired', () => {
  assert.match(index, /\['home','Vista pubblica'\],\['upload','Candidatura'\]/);
  assert.match(index, /data-tab=\"'\+id\+'/);
  assert.match(index, /currentTab==='upload'/);
});


