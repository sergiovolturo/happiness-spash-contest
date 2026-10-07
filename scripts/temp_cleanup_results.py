from pathlib import Path

path = Path('index.html')
data = path.read_bytes()

old = "const adminReplaceResultIdentifiers=async view=>{const result=view.querySelector('.adminResults');if(!result||!adminSelectedContest?.id)return;const {data}=await supabase.from('submissions').select('id,contestant_display_name').eq('contest_id',adminSelectedContest.id);const labels=new Map((data||[]).map(row=>[row.id,row.contestant_display_name||'Nome candidato non disponibile']));const walker=document.createTreeWalker(result,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;for(const [id,name] of labels)node.nodeValue=node.nodeValue.split(`submission ${id}`).join(name)}};".encode('utf-8')
new = "const adminReplaceResultIdentifiers=async view=>{const result=view.querySelector('.adminResults');if(!result)return;const rows=adminTieCandidateRows.length?adminTieCandidateRows:(adminResultsLoadedData?.reviewSubmissions||[]),labels=new Map(rows.map(row=>[row.id,row.contestant_display_name||'Nome candidato non disponibile']));const walker=document.createTreeWalker(result,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;for(const [id,name] of labels)node.nodeValue=node.nodeValue.split(`submission ${id}`).join(name)}};".encode('utf-8')
if data.count(old) != 1:
    raise SystemExit(f'expected one legacy identifier lookup, found {data.count(old)}')
data = data.replace(old, new)

newline = b'\r\n' if b'\r\n' in data else b'\n'
anchor = b'</style>' + newline + b"<script>document.documentElement.dataset.theme='light';</script>"
css = b'.adminTieDecisionNote{display:block;margin-top:3px;font-size:12px;line-height:1.35}' + newline
if css not in data:
    if data.count(anchor) != 1:
        raise SystemExit(f'expected one style anchor, found {data.count(anchor)}')
    data = data.replace(anchor, css + anchor)
path.write_bytes(data)

Path('tests/admin-results-cleanup.test.mjs').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Admin results reuse already-loaded candidate names without invalid contest_id lookup', () => {
  const start = index.indexOf('const adminReplaceResultIdentifiers=');
  const end = index.indexOf('const adminTranslateParticipation=', start);
  const block = index.slice(start, end);
  assert.match(block, /adminTieCandidateRows/);
  assert.doesNotMatch(block, /\\.eq\\('contest_id',adminSelectedContest\\.id\\)/);
  assert.doesNotMatch(block, /supabase\\.from\\('submissions'\\)/);
});

test('Admin tie decision note is intentionally rendered on its own line', () => {
  assert.match(index, /\\.adminTieDecisionNote\\{display:block;margin-top:3px;font-size:12px;line-height:1\\.35\\}/);
});
""", encoding='utf-8')
