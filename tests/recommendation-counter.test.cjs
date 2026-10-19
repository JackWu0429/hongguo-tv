const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const start = source.indexOf('  function updateFeedCounter()');
const end = source.indexOf('  function recommendationChannel()', start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function counterSnapshot(index, count, hasMore) {
  const counter = { textContent: '', title: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const context = vm.createContext({
    document: { getElementById: id => id === 'hero-top-count' ? counter : null },
    feedItems: Array.from({ length: count }, (_, i) => ({ series_id: String(i + 1) })),
    feedIndex: index,
    feedPager: { hasMore: () => hasMore },
    uiText: (key, fallback, values) => fallback.replace('{current}', values.current).replace('{count}', values.count)
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('updateFeedCounter()', context);
  return counter;
}

test('recommendation counter marks a partial count as a lower bound', () => {
  const result = counterSnapshot(2, 10, true);
  assert.equal(result.textContent, '3 / 10+');
  assert.equal(result.attributes['aria-label'], '第3部，已加载至少10部');
});

test('recommendation counter shows the final total after pagination ends', () => {
  const result = counterSnapshot(2, 17, false);
  assert.equal(result.textContent, '3 / 17');
  assert.equal(result.attributes['aria-label'], '第3部，共17部');
});

test('recommendation counter stays neutral before any playable cards arrive', () => {
  const result = counterSnapshot(-1, 0, true);
  assert.equal(result.textContent, '0 / 0');
  assert.equal(result.attributes['aria-label'], '0 / 0');
});
