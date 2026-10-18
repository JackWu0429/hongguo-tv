const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');

test('TV home deep links validate identity and start the selected series', () => {
  const start = app.indexOf('  function openHomeProgram(');
  const end = app.indexOf('\n  window.HongguoTV =', start);
  const context = vm.createContext({ accountStatusInitialized: true, pendingAccountHomeProgram: null,
    startPlayer: (item, focus, options) => { context.started = item; context.startOptions = options; }, pollAccount() {}, window: {} });
  vm.runInContext(app.slice(start, end), context);

  assert.equal(context.openHomeProgram({ series_id: '7690163276214176792', title: '测试剧' }), true);
  assert.equal(context.started.series_id, '7690163276214176792');
  assert.equal(context.started.title, '测试剧');
  assert.equal(context.startOptions.cardLaunch, true);
  assert.equal(context.openHomeProgram({ series_id: '0' }), false);
  assert.equal(context.openHomeProgram({ series_id: '123/456' }), false);
});

test('Channel deep link waits for first account state before starting playback', () => {
  const start = app.indexOf('  function openHomeProgram(');
  const end = app.indexOf('\n  window.HongguoTV =', start);
  const calls = [];
  const context = vm.createContext({
    accountStatusInitialized: false,
    pendingAccountHomeProgram: null,
    pollAccount() { calls.push('poll'); },
    startPlayer(item, focus, options) { calls.push({ item, options }); },
    window: {}
  });
  vm.runInContext(app.slice(start, end), context);

  assert.equal(context.openHomeProgram({ series_id: '123', title: 'Channel 剧集' }), true);
  assert.deepEqual(calls, ['poll']);
  assert.equal(context.pendingAccountHomeProgram.series_id, '123');
  assert.equal(context.pendingAccountHomeProgram.cardLaunch, true);

  context.accountStatusInitialized = true;
  context.startPendingAccountHomeProgram();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['poll', {
    item: { series_id: '123', title: 'Channel 剧集', intro: '', cover: '' }, options: { cardLaunch: true }
  }]);
  assert.equal(context.pendingAccountHomeProgram, null);
});

test('Channel card launches enter auto cinema while recommendation playback and episode changes do not', () => {
  const start = app.indexOf('  function shouldAutoCinemaForLaunch(');
  const end = app.indexOf('\n  function startPlayer(', start);
  const context = vm.createContext({
    isAutoCinemaCardLaunch: target => target === 'catalog-card'
  });
  vm.runInContext(app.slice(start, end), context);

  assert.equal(context.shouldAutoCinemaForLaunch('recommend', null, { cardLaunch: true }), true);
  assert.equal(context.shouldAutoCinemaForLaunch('recommend', 'catalog-card', null), false);
  assert.equal(context.shouldAutoCinemaForLaunch('player', null, { cardLaunch: true }), false);
  assert.equal(context.shouldAutoCinemaForLaunch('search', 'catalog-card', null), true);
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
