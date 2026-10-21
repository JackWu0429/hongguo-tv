const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/index.html'), 'utf8');

function block(start, end) {
  return source.slice(source.indexOf('  function ' + start + '('), source.indexOf('  function ' + end + '('));
}

test('search suggestions expose the listbox and route keyboard movement through the focus zone', () => {
  assert.match(html, /id="search-suggestions"[^>]*role="listbox"/);
  assert.match(source, /searchSuggestions: '\.search-suggestion'/);
  const movement = block('moveFrom', 'handleKey');
  assert.match(movement, /if \(zone === 'searchInput'\)[\s\S]*?searchSuggestionOpen \? firstVisible\('\.search-suggestion'\)/);
  assert.match(movement, /if \(zone === 'searchSuggestions'\)[\s\S]*?moveWithinZone\(zone, current, direction\) \|\| searchInput/);
});

test('Back closes suggestions and returns to the input; the same query stays dismissed until edited', () => {
  const schedule = block('scheduleSearchSuggestions', 'activateSearchSuggestion');
  const handleBack = block('handleBack', 'handleMediaCommand');
  assert.match(handleBack, /if \(searchSuggestionOpen\) \{ closeSearchSuggestions\(true\); return true; \}/);
  assert.match(source, /searchSuggestionDismissedQuery = searchInput\.value\.trim\(\);[\s\S]*?goFocus\(searchInput\)/);
  assert.match(schedule, /if \(query === searchSuggestionDismissedQuery\) \{ closeSearchSuggestions\(false\); return; \}/);
  assert.match(source, /searchInput\.addEventListener\('input', function \(\) \{\s*searchSuggestionDismissedQuery = '';/);
});

test('suggestion refresh preserves a focused item across DOM replacement', () => {
  const render = block('renderSearchSuggestions', 'restoreSearchSuggestionFocus');
  assert.match(render, /var activeElement = document\.activeElement/);
  assert.match(render, /restoreSuggestionFocus = !!\(previousKey && activeElement\.closest && activeElement\.closest\('#search-suggestions'\)\)/);
  assert.match(render, /if \(same && restoreSuggestionFocus\) goFocus\(same\)/);
  assert.match(render, /button\.addEventListener\('focus', function \(\) \{\s*try \{ button\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.css'), 'utf8'), /\.search-suggestions\s*\{[^}]*max-height:\s*60vh/);
});

test('suggestion list keeps focus rings clear of its scroll clipping edge', () => {
  const css = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.css'), 'utf8');
  assert.match(css, /\.search-suggestions\s*\{[^}]*padding:\s*10px 6px/);
  const wideLayout = css.match(/@media\s*\(min-width:\s*1500px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(wideLayout);
  assert.match(wideLayout[1], /\.search-input-wrap\s*\{\s*position:\s*static;/);
  assert.match(wideLayout[1], /\.search-suggestions\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\);[^}]*right:\s*auto;[^}]*left:\s*0;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box/);
});

test('reservation status tabs retain their previous compact pill appearance', () => {
  const css = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.css'), 'utf8');
  assert.match(css, /\.reservation-tabs\s*\{[^}]*gap:\s*12px/);
  assert.match(css, /\.reservation-tab\s*\{[^}]*min-width:\s*94px;[^}]*min-height:\s*42px;[^}]*background:\s*#20212a;[^}]*border-radius:\s*22px/);
  assert.match(css, /\.reservation-tab\.is-active\s*\{[^}]*background:\s*#f35d7b/);
});

test('search suggestion requests are debounced and stale responses are ignored', () => {
  const load = block('loadSearchSuggestions', 'scheduleSearchSuggestions');
  const schedule = block('scheduleSearchSuggestions', 'activateSearchSuggestion');
  assert.match(schedule, /setTimeout\(function \(\) \{ loadSearchSuggestions\(query\); \}, 240\)/);
  assert.match(load, /generation !== searchSuggestionGeneration/);
  assert.match(load, /searchInput\.value\.trim\(\) !== query/);
});

test('selecting drama and actor suggestions uses existing detail and actor-work flows', () => {
  const activate = block('activateSearchSuggestion', 'lastSearchFilter');
  assert.match(activate, /item\.kind === 'short_play_actor' && item\.actor_id[\s\S]*?openActorWorks/);
  assert.match(activate, /item\.drama && item\.drama\.series_id[\s\S]*?openDetail\(item\.drama, undefined, returnFocus\)/);
  assert.match(source, /function restoreSearchSuggestionFocus\(\)[\s\S]*?if \(target\) \{ goFocus\(target\); return true; \}/);
});
