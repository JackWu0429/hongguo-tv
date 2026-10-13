const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/native-player.js'), 'utf8');
const mpvBridgeSource = fs.readFileSync(require.resolve('../android/app/src/mpv/java/rocks/aston/hongguotv/MpvPlayerBridge.java'), 'utf8');

function fixture(engine = 'webview_media3') {
  const listeners = {};
  const classNames = new Set();
  const rootClassNames = new Set();
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
    documentElement: { classList: {
      add(name) { rootClassNames.add(name); },
      remove(name) { rootClassNames.delete(name); },
      contains(name) { return rootClassNames.has(name); }
    } },
    getElementById(id) { return id === 'hero-video' ? domVideo : null; },
    querySelector() { return { getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; } }; }
  };
  const bridge = {
    isAvailable() { return true; },
    engine() { return engine; },
    bounds() {},
    begin() {},
    play(id, payload) { this.plays++; this.lastId = id; this.lastPayload = JSON.parse(payload); },
    plays: 0, resumes: 0, stops: 0,
    resume() { this.resumes++; },
    pause() {},
    stop() { this.stops++; },
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
  return { context, document, domVideo, listeners, bridge, rootClassNames };
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
  assert.equal(f.rootClassNames.has('native-playback'), false);
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
  assert.equal(f.rootClassNames.has('native-playback'), true);
  assert.equal(f.bridge.lastPayload.start_position, 12.5);
  assert.equal(proxy.currentTime, 12.5);
  const nativeId = f.bridge.lastId;
  f.listeners.error[0]({ type: 'error' });
  assert.equal(f.bridge.lastId, nativeId);
});

test('native playback failure restores the visible WebView video layer', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  const nativeId = activateNative(f);
  assert.equal(f.rootClassNames.has('native-playback'), true);
  f.context.window.HongguoNativePlayback.event(nativeId, 'error');
  assert.equal(f.rootClassNames.has('native-playback'), false);
  assert.equal(proxy.src, '/media/test.mp4');
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

test('MPV edition sends sources only to MPV and resumes without recreating before first frame', async () => {
  const f = fixture('mpv'), video = f.document.getElementById('hero-video');
  video.src = '/media/test.mp4'; video.load(); video.currentTime = 12.5;
  await video.play(); video.pause(); await video.play();
  assert.equal(f.domVideo.src, '');
  assert.equal(f.bridge.plays, 1);
  assert.equal(f.bridge.resumes, 1);
  assert.equal(f.bridge.lastPayload.start_position, 12.5);
  assert.equal(f.bridge.lastPayload.source, 'http://127.0.0.1/media/test.mp4');
});

test('MPV source replacement ignores old frame, progress and ended callbacks', async () => {
  const f = fixture('mpv'), video = f.document.getElementById('hero-video');
  const playback = f.context.window.HongguoNativePlayback;
  let ends = 0, frames = 0;
  video.addEventListener('ended', () => ends++);
  video.addEventListener('nativeframe', () => frames++);
  video.src = '/media/one.mp4'; await video.play(); const old = f.bridge.lastId;
  video.src = '/media/two.mp4'; await video.play(); const current = f.bridge.lastId;
  playback.event(old, 'frame', {width: 1080, height: 1920});
  playback.progress(old, 100000, 100000); playback.event(old, 'ended');
  assert.equal(ends, 0); assert.equal(frames, 0); assert.equal(video.currentTime, 0);
  playback.event(current, 'frame', {width: 720, height: 1280});
  playback.event(current, 'playing'); playback.progress(current, 5000, 90000);
  assert.equal(frames, 1); assert.equal(video.videoHeight, 1280); assert.equal(video.currentTime, 5);
});

test('MPV source replacement stops the old session before starting the new one', async () => {
  const f = fixture('mpv'), video = f.document.getElementById('hero-video');
  const order = [];
  const oldStop = f.bridge.stop;
  const oldPlay = f.bridge.play;
  f.bridge.stop = function () { order.push('stop'); oldStop.call(this); };
  f.bridge.play = function (id, payload) { order.push('play'); oldPlay.call(this, id, payload); };
  video.src = '/media/one.mp4'; await video.play();
  video.src = '/media/two.mp4'; await video.play();
  assert.deepEqual(order, ['stop', 'play', 'stop', 'play']);
  assert.equal(f.bridge.plays, 2);
  assert.equal(f.bridge.stops, 2);
});

test('MPV bridge keeps source replacement serialized and isolates delayed native events', () => {
  const release = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private void release()'), mpvBridgeSource.indexOf('@Override public void onPause()'));
  const start = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private void start(Session target)'), mpvBridgeSource.indexOf('/** Create/configure the one client'));
  assert.match(release, /setPropertyBoolean\("pause", true\)[\s\S]*command\(new String\[\]\{"stop"\}\)/);
  assert.match(start, /setPropertyBoolean\("pause", true\)[\s\S]*command\(new String\[\]\{"loadfile", target\.source, "replace"\}\)/);
  assert.match(mpvBridgeSource, /final Session observed = session/);
  assert.match(mpvBridgeSource, /if \(!target\.output\.loaded\) return;/);
});

test('MPV failure stays native, reports error and ignores late success until explicit retry', async () => {
  const f = fixture('mpv'), video = f.document.getElementById('hero-video');
  const playback = f.context.window.HongguoNativePlayback;
  let errors = 0;
  video.addEventListener('error', () => errors++);
  video.src = '/media/test.mp4'; await video.play(); const old = f.bridge.lastId;
  playback.event(old, 'error', {kind: 'first_frame_timeout'});
  playback.event(old, 'playing'); playback.progress(old, 5000, 90000);
  assert.equal(errors, 1); assert.equal(video.paused, true); assert.equal(video.currentTime, 0);
  assert.equal(f.rootClassNames.has('native-playback'), true); assert.equal(f.domVideo.src, '');
  await video.play(); assert.equal(f.bridge.plays, 2); assert.notEqual(f.bridge.lastId, old);
});

test('Media3 callback after returning to WebView cannot emit a stale ended or progress event', () => {
  const f = fixture(), video = f.document.getElementById('hero-video');
  const id = activateNative(f); let ends = 0, ticks = 0;
  video.addEventListener('ended', () => ends++); video.addEventListener('timeupdate', () => ticks++);
  f.context.window.HongguoNativePlayback.event(id, 'error');
  f.context.window.HongguoNativePlayback.event(id, 'ended');
  f.context.window.HongguoNativePlayback.progress(id, 30000, 90000);
  assert.equal(ends, 0); assert.equal(ticks, 0); video.pause();
});
