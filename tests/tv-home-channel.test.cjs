const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');

test('TV home deep links validate identity and start the selected series', () => {
  const start = app.indexOf('  function openHomeProgram(');
  const end = app.indexOf('\n  window.HongguoTV =', start);
  const context = vm.createContext({ startPlayer: item => { context.started = item; }, window: {} });
  vm.runInContext(app.slice(start, end), context);

  assert.equal(context.openHomeProgram({ series_id: '7690163276214176792', title: '测试剧' }), true);
  assert.equal(context.started.series_id, '7690163276214176792');
  assert.equal(context.started.title, '测试剧');
  assert.equal(context.openHomeProgram({ series_id: '0' }), false);
  assert.equal(context.openHomeProgram({ series_id: '123/456' }), false);
});

test('only the main recommendation feed is synced, with a bounded safe projection', () => {
  const start = app.indexOf('  function syncHomeChannel(');
  const end = app.indexOf('\n  function renderFeed(', start);
  const sent = [];
  const context = vm.createContext({
    window: { HongguoTVHome: { syncRecommendations: json => sent.push(JSON.parse(json)) } },
    recommendationChannel: () => context.channel
  });
  vm.runInContext(app.slice(start, end), context);

  context.channel = '16';
  context.syncHomeChannel(Array.from({ length: 24 }, (_, index) => ({
    series_id: String(index + 1), title: '剧' + index, intro: '简介', cover: 'https://img.test/a.jpg',
    cover_fallback: 'https://img.test/b.jpg', vid: 'must-not-cross-bridge', secret: 'must-not-cross-bridge'
  })));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 20);
  assert.deepEqual(Object.keys(sent[0][0]).sort(), ['cover', 'cover_fallback', 'intro', 'series_id', 'title']);
  context.channel = '45';
  context.syncHomeChannel([{ series_id: '25', title: '关注剧' }]);
  assert.equal(sent.length, 1);
});

test('cold-start deep link is consumed before default recommendations can autoplay', () => {
  const consume = app.lastIndexOf('var initialHomeProgram = null;');
  const defaultFeed = app.lastIndexOf("loadCatalog(uiText('nav.recommend', '推荐'));");
  assert.ok(consume >= 0 && defaultFeed > consume);
  assert.ok(app.slice(consume, defaultFeed).includes('window.HongguoTV.openHomeProgram(initialHomeProgram)'));
});
