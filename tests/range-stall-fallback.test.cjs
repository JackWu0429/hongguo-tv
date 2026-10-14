const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const start = source.indexOf('  function scheduleRangeStallFallback(');
const end = source.indexOf('  function maybePrefetchNextEpisode(', start);
const schedule = source.slice(start, end).trim();

function fixture() {
  const timers = [];
  const video = { currentTime: 30, readyState: 4, paused: false, seeking: false };
  const playback = { mode: 'range', generation: 7, rangeFallbackAttempted: false };
  const context = vm.createContext({
    activePlayback: playback,
    applicationInBackground: false,
    applicationHidden: () => false,
    clearTimeout: () => {},
    document: { getElementById: () => video },
    feedGeneration: 7,
    fallbackCalls: 0,
    fallbackRangePlayback: () => { context.fallbackCalls += 1; },
    rangeStallTimer: null,
    setTimeout(callback, delay) { timers.push({callback, delay}); return timers.length; },
    video
  });
  vm.runInContext(schedule + '\nthis.scheduleRangeStallFallback = scheduleRangeStallFallback;', context);
  return {context, playback, timers, video};
}

test('a stalled Range stream falls back after 45 seconds even if readyState still says playable', () => {
  const f = fixture();
  f.context.scheduleRangeStallFallback(f.playback);
  assert.equal(f.timers[0].delay, 45000);
  f.timers[0].callback();
  assert.equal(f.context.fallbackCalls, 1);
});

test('actual playback progress renews the stall window instead of falling back', () => {
  const f = fixture();
  f.context.scheduleRangeStallFallback(f.playback);
  f.video.currentTime += 1;
  f.timers[0].callback();
  assert.equal(f.context.fallbackCalls, 0);
  assert.equal(f.timers.length, 2);
  f.timers[1].callback();
  assert.equal(f.context.fallbackCalls, 1);
});

test('stale playback generations cannot trigger standard-playback fallback', () => {
  const f = fixture();
  f.context.scheduleRangeStallFallback(f.playback);
  f.context.feedGeneration += 1;
  f.timers[0].callback();
  assert.equal(f.context.fallbackCalls, 0);
});
