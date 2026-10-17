const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('./helpers/app-text.cjs');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const render = source.slice(source.indexOf('  function renderDetailSocial('), source.indexOf('  function loadSeriesSeasons('));

function fixture(related) {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      attributes: {},
      className: '',
      textContent: '',
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(type, handler) { this.handlers = this.handlers || {}; this.handlers[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      classList: { add() {}, remove() {}, contains() { return false; } }
    };
  }
  const list = element('div');
  Object.defineProperty(list, 'innerHTML', { set() { list.children = []; } });
  const tab = element('button'); tab.id = 'detail-tab-related';
  const message = element('div');
  const document = {
    createElement: element,
    getElementById(id) { return id === 'detail-related-list' ? list : id === 'detail-related-message' ? message : tab; }
  };
  const c = vm.createContext({
    document,
    currentDetail: { related },
    detailTab: 'related',
    setCover(image, item) { image.cover = item.cover; },
    dramaPoster(image) { const poster = element('span'); poster.appendChild(image); return poster; },
    firstVisible(selector) { return selector === '.related-card' ? list.children[0] || null : null; },
    goFocus(node) { c.focused = node; }
  });
  vm.runInContext(render, c);
  return { c, list, message, tab };
}

test('series detail recommendations render as selectable poster cards', () => {
  const related = [
    { series_id: '1001', title: '推荐短剧一', cover: 'https://example.test/one.jpg', episode_count: 12 },
    { series_id: '1002', title: '推荐短剧二', cover: 'https://example.test/two.jpg', episode_count: 24 }
  ];
  const f = fixture(related);

  f.c.renderDetailSocial('related');

  assert.equal(f.list.children.length, 2);
  assert.equal(f.list.children[0].className, 'related-card');
  assert.equal(f.list.children[0].children[1].textContent, '推荐短剧一');
  assert.equal(f.list.children[0].children[0].children[0].cover, 'https://example.test/one.jpg');
  assert.equal(typeof f.list.children[0].handlers.click, 'function');
  assert.equal(f.message.textContent, '');
  assert.equal(f.c.focused, f.list.children[0]);
});

test('empty recommendation response explains the empty state instead of leaving a blank panel', () => {
  const f = fixture([]);

  f.c.renderDetailSocial('related');

  assert.equal(f.list.children.length, 0);
  assert.equal(f.message.textContent, '暂无相关推荐。');
  assert.equal(f.c.focused, f.tab);
});
