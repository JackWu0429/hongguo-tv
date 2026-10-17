const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const indexSource = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/index.html'), 'utf8');

test('player context is a real return button wired to the player action', () => {
  assert.match(indexSource, /<button[^>]+id="page-context"[^>]+data-action="return-player"/);
  assert.match(appSource, /item\.dataset\.action === 'return-player'[\s\S]*?handlePlayerContextClick\(\)/);
});

test('clicking the player context leaves single-drama playback immediately', () => {
  const start = appSource.indexOf('  function handlePlayerContextClick()');
  const end = appSource.indexOf('  function posterSeasonLabel(item)', start);
  const context = vm.createContext({});
  vm.runInContext("var mode = 'player'; var left = 0; function pageMode() { return mode; } function leavePlayer() { left += 1; }", context);
  vm.runInContext(appSource.slice(start, end), context);

  assert.equal(context.handlePlayerContextClick(), true);
  assert.equal(context.left, 1);
  vm.runInContext("mode = 'recommend'", context);
  assert.equal(context.handlePlayerContextClick(), false);
  assert.equal(context.left, 1);
});
