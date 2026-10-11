const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
test('reservation page keeps its existing tab behavior; success is reported in the current window', () => {
  assert.equal(source.includes('hongguo-tv-reservation-mode'), false);
  assert.match(source, /showNotice\('已预约' \+ label\)/);
  assert.match(source, /seriesMessage\(reserved \? '预约成功。'/);
});

function reservationConfirmationFixture({ fail = false } = {}) {
  const calls = [];
  const nodes = {};
  function node(id) {
    return nodes[id] || (nodes[id] = {
      id,
      textContent: '',
      disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}
    });
  }
  const playback = { item: { series_id: 'series-1' } };
  const item = { reservation_id: 'season-2', season_index: 2, label: '第2季', title: '测试剧' };
  const context = vm.createContext({
    Promise,
    document: { activeElement: node('confirm-cancel'), getElementById: node },
    confirmOpen: false,
    confirmationGeneration: 0,
    confirmReturnFocus: null,
    confirmOperation: null,
    accountEpoch: 7,
    activePlayback: playback,
    accountData: { logged_in: true },
    reservationPager: { loaded: true },
    calendarPager: { loaded: true },
    reservationCounts: { upcoming: 0 },
    canContinuePlayback: () => true,
    isPlaybackPage: () => true,
    updateReservationCounts() {},
    updateSeasonReservation() {},
    updateSeriesRows() {},
    showNotice(message) { calls.push(['notice', message]); },
    goFocus() {},
    fetchData: async (url, options) => {
      calls.push(['request', url, JSON.parse(options.body)]);
      if (fail) throw new Error('测试预约失败');
      return {};
    }
  });
  const start = source.indexOf('  function offerNextSeasonReservation(');
  const end = source.indexOf('  function refreshDetailAfterSeason(', start);
  vm.runInContext(source.slice(start, end), context);
  context.offerNextSeasonReservation(playback, item, 7);
  return { context, calls, item, playback, copy: node('confirm-copy') };
}

test('next-season reservation only reports success after the reservation endpoint confirms it', async () => {
  const f = reservationConfirmationFixture();
  assert.equal(await f.context.confirmOperation(), true);
  assert.deepEqual(f.calls[0], ['request', '/api/v1/reservation', { item_id: 'season-2', reserved: true }]);
  assert.equal(f.item.reserved, true);
  assert.deepEqual(f.calls.slice(1), [['notice', '已预约第2季']]);
});

test('a failed reservation keeps the season unreserved and leaves a retryable error', async () => {
  const f = reservationConfirmationFixture({ fail: true });
  assert.equal(await f.context.confirmOperation(), false);
  assert.equal(f.item.reserved, undefined);
  assert.match(f.copy.textContent, /预约未确认成功：测试预约失败/);
  assert.equal(f.calls.length, 1);
});

test('a stale playback context cannot close the reservation prompt as a false success', async () => {
  const f = reservationConfirmationFixture();
  f.context.activePlayback = null;
  assert.equal(await f.context.confirmOperation(), false);
  assert.match(f.copy.textContent, /播放状态已变化/);
  assert.equal(f.calls.length, 0);
});
