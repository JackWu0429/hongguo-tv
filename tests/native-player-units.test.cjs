const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/native-player.js'), 'utf8');

function fixture() {
  const listeners = {};
  const classNames = new Set();
  const domVideo = {
    classList: {
      toggle(name, on) { if (on) classNames.add(name); else classNames.delete(name); },
      contains(name) { return classNames.has(name); }
    },
    addEventListener(name, listener) { (listeners[name] ||= []).push(listener); },
    getAttribute() { return null; },
    setAttribute() {},
    removeAttribute() {}
  };
  const document = {
    documentElement: { classList: { add() {}, remove() {} } },
    getElementById(id) { return id === 'hero-video' ? domVideo : null; },
    querySelector() { return { getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; } }; }
  };
  const bridge = {
    isAvailable() { return true; },
    bounds() {},
    begin() {},
    play() {},
    setVolume() {},
    seekTo() {}
  };
  const context = vm.createContext({
    document,
    window: { HongguoNativePlayer: bridge, addEventListener() {}, location: { origin: 'http://127.0.0.1' } },
    isFinite,
    setTimeout,
    clearTimeout,
    Promise
  });
  vm.runInContext(source, context);
  return { context, document, domVideo, listeners };
}

test('native playback converts bridge millisecond position and duration to seconds', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  f.context.window.HongguoNativePlayback.progress('hongguo-1', 5000, 188000);
  assert.equal(proxy.currentTime, 5);
  assert.equal(proxy.duration, 188);
});

test('native playback clamps a position that exceeds the reported duration', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  f.context.window.HongguoNativePlayback.progress('hongguo-1', 250000, 188000);
  assert.equal(proxy.currentTime, 188);
  assert.equal(proxy.duration, 188);
});
