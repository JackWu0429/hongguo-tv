const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/native-player.js'), 'utf8');

function fixture() {
  const listeners = {};
  const classNames = new Set();
  const domVideo = {
    src: '', currentSrc: '', currentTime: 0, duration: 0, paused: true, playbackRate: 1, volume: 1, muted: true,
    readyState: 0, videoWidth: 0, videoHeight: 0,
    classList: {
      toggle(name, on) { if (on) classNames.add(name); else classNames.delete(name); },
      contains(name) { return classNames.has(name); }
    },
    addEventListener(name, listener) { (listeners[name] ||= []).push(listener); },
    getAttribute() { return null; },
    setAttribute() {},
    removeAttribute() {},
    load() {},
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
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
    play(id, payload) { this.lastId = id; this.lastPayload = JSON.parse(payload); },
    lastId: null,
    lastPayload: null,
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
  return { context, document, domVideo, listeners, bridge };
}

function activateNative(f) {
  const proxy = f.document.getElementById('hero-video');
  proxy.src = '/media/test.mp4';
  proxy.play();
  assert.equal(f.context.window.HongguoNativePlaybackAdapter.enableNative(), true);
  return f.bridge.lastId;
}

test('WebView remains the default until native fallback is requested', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  proxy.src = '/media/test.mp4';
  proxy.play();
  assert.equal(proxy.src, '/media/test.mp4');
  assert.equal(f.bridge.lastId, null);
  proxy.pause();
});

test('WebView media error switches to Media3 once and keeps the playback position', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  proxy.src = '/media/test.mp4';
  proxy.play();
  f.domVideo.currentTime = 12.5;
  f.listeners.error[0]({ type: 'error' });
  assert.ok(f.bridge.lastId);
  assert.equal(f.bridge.lastPayload.start_position, 12.5);
  assert.equal(proxy.currentTime, 12.5);
  const nativeId = f.bridge.lastId;
  f.listeners.error[0]({ type: 'error' });
  assert.equal(f.bridge.lastId, nativeId);
});

test('a new source leaves a previous native fallback and starts with WebView again', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  activateNative(f);
  const nativeId = f.bridge.lastId;
  proxy.src = '/media/next.mp4';
  proxy.play();
  assert.equal(proxy.src, '/media/next.mp4');
  assert.equal(f.bridge.lastId, nativeId);
  proxy.pause();
});

test('native playback converts bridge millisecond position and duration to seconds', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  const id = activateNative(f);
  f.context.window.HongguoNativePlayback.progress(id, 5000, 188000);
  assert.equal(proxy.currentTime, 5);
  assert.equal(proxy.duration, 188);
});

test('native playback clamps a position that exceeds the reported duration', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  const id = activateNative(f);
  f.context.window.HongguoNativePlayback.progress(id, 250000, 188000);
  assert.equal(proxy.currentTime, 188);
  assert.equal(proxy.duration, 188);
});
