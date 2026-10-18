const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const helper = source.match(/  function revealSidebarFocus\(element\) \{[\s\S]*?\n  \}/);
assert.ok(helper, 'sidebar focus visibility helper exists');

function container(name, top, height, overflowY, parentElement) {
  return {
    name, parentElement, clientTop: 0, clientHeight: height, scrollTop: 0,
    classList: { contains: value => value === 'sidebar' && name === 'sidebar' },
    getBoundingClientRect: () => ({ top, bottom: top + height })
  };
}

function run({ itemTop, itemBottom, navContains = true, parentClips = false }) {
  const sidebar = container('sidebar', 0, 500, 'auto', null);
  const nav = container('side-nav', 80, 300, 'auto', sidebar);
  const item = {
    parentElement: navContains ? nav : sidebar,
    getBoundingClientRect: () => ({ top: itemTop, bottom: itemBottom })
  };
  if (!parentClips) sidebar.clientHeight = 700;
  const context = vm.createContext({ window: { getComputedStyle: node => ({ overflowY: node === nav || parentClips ? 'auto' : 'visible' }) } });
  vm.runInContext(helper[0], context);
  context.revealSidebarFocus(item);
  return { nav, sidebar };
}

test('top sidebar focus backs out the browser scroll that clips the focus ring', () => {
  const { nav } = run({ itemTop: 80, itemBottom: 118 });
  nav.scrollTop = 8;
  const context = vm.createContext({ window: { getComputedStyle: node => ({ overflowY: node === nav ? 'auto' : 'visible' }) } });
  vm.runInContext(helper[0], context);
  context.revealSidebarFocus({
    parentElement: nav,
    getBoundingClientRect: () => ({ top: 80 + (8 - nav.scrollTop), bottom: 118 + (8 - nav.scrollTop) })
  });
  assert.equal(nav.scrollTop, 2);
});

test('bottom sidebar focus leaves room for the focus ring inside the inner scroller', () => {
  const { nav, sidebar } = run({ itemTop: 370, itemBottom: 410 });
  assert.equal(nav.scrollTop, 36);
  assert.equal(sidebar.scrollTop, 0);
});

test('sidebar bottom actions use the outer scrollport safety margin', () => {
  const { sidebar } = run({ itemTop: 480, itemBottom: 510, navContains: false, parentClips: true });
  assert.equal(sidebar.scrollTop, 16);
});
