from pathlib import Path

path = Path('index.html')
with path.open('r', encoding='utf-8', newline='') as fh:
    text = fh.read()
nl = '\r\n' if '\r\n' in text else '\n'

marker = " const publicOfficialFinalistsCompactMarkup=(contestId,categoryId=null)=>{"
helper = " const publicResultIsTiebreakFinalist=(row,rows)=>!!row?.is_finalist&&Number.isFinite(Number(row?.rank_position))&&(rows||[]).some(peer=>peer.submission_id!==row.submission_id&&!peer.is_finalist&&peer.category_id===row.category_id&&Number(peer.rank_position)===Number(row.rank_position));" + nl
assert text.count(marker) == 1, text.count(marker)
text = text.replace(marker, helper + marker, 1)

old_items = "return items.map(item=>'<li><span>'+esc(category?.name||'Categoria')+'</span><b>'+esc(item.contestant_display_name||'Nome candidato non disponibile')+'</b></li>').join('');"
new_items = "return items.map(item=>'<li><span>'+esc(category?.name||'Categoria')+'</span><b>'+esc(item.contestant_display_name||'Nome candidato non disponibile')+'</b>'+(publicResultIsTiebreakFinalist(item,publicScopedResultRows(contestId,id))?'<small class=\"publicTiebreakNote\">Finalista dopo spareggio su Instagram</small>':'')+'</li>').join('');"
assert text.count(old_items) == 1, text.count(old_items)
text = text.replace(old_items, new_items, 1)

css_marker = ".publicOfficialFinalists.compact li span{color:var(--muted);font-size:13px}" + nl
css_add = (
    ".publicOfficialFinalists.compact li{display:grid;grid-template-columns:auto auto;column-gap:5px;align-items:baseline}" + nl
    + ".publicTiebreakNote{display:block;margin-top:3px;color:var(--muted);font-size:12px;line-height:1.35;font-weight:500}" + nl
    + ".publicOfficialFinalists.compact li .publicTiebreakNote{grid-column:2}" + nl
)
assert text.count(css_marker) == 1, text.count(css_marker)
text = text.replace(css_marker, css_marker + css_add, 1)

old_summary = "return result?'<div class=\"muted publicResultSummary\">Voti: '+Number(result.vote_count||0)+(result.is_finalist?' · Top 4 · Finalissima Instagram':'')+'</div>':''};"
new_summary = "return result?'<div class=\"muted publicResultSummary\">Voti: '+Number(result.vote_count||0)+(result.is_finalist?' · Top 4 · Finalissima Instagram':'')+(publicResultIsTiebreakFinalist(result,publicResultRows)?'<span class=\"publicTiebreakNote\">Finalista dopo spareggio su Instagram</span>':'')+'</div>':''};"
assert text.count(old_summary) == 1, text.count(old_summary)
text = text.replace(old_summary, new_summary, 1)

with path.open('w', encoding='utf-8', newline='') as fh:
    fh.write(text)

Path('tests/public-tiebreak-note.test.mjs').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('public tiebreak finalist is derived only from a finalist sharing rank with a non-finalist peer', () => {
  assert.match(index, /const publicResultIsTiebreakFinalist=\(row,rows\)=>!!row\?\.is_finalist/);
  assert.match(index, /!peer\.is_finalist/);
  assert.match(index, /Number\(peer\.rank_position\)===Number\(row\.rank_position\)/);
});

test('public finalists and video result expose the Instagram tiebreak note', () => {
  const matches = index.match(/Finalista dopo spareggio su Instagram/g) || [];
  assert.equal(matches.length, 2);
  assert.match(index, /publicOfficialFinalists\.compact li \.publicTiebreakNote\{grid-column:2\}/);
  assert.match(index, /publicResultSummary[^]*publicResultIsTiebreakFinalist\(result,publicResultRows\)/);
});

test('public copy does not describe the tiebreak finalist as an Admin choice', () => {
  const compactStart = index.indexOf('const publicOfficialFinalistsCompactMarkup=');
  const compactEnd = index.indexOf('const loadPublicContestSelectionScoped=', compactStart);
  const compact = index.slice(compactStart, compactEnd);
  assert.doesNotMatch(compact, /Scelta dall.Admin|scelta dall.Admin/i);
});
""", encoding='utf-8')
