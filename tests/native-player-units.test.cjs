const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/native-player.js'), 'utf8');
const appSource = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
const mpvBridgeSource = fs.readFileSync(require.resolve('../android/app/src/mpv/java/rocks/aston/hongguotv/MpvPlayerBridge.java'), 'utf8');
const mpvTransitionSource = fs.readFileSync(require.resolve('../android/app/src/mpv/java/rocks/aston/hongguotv/MpvTransitionState.java'), 'utf8');

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
    seekTo() {},
    enqueue(id, payload) { this.enqueues = (this.enqueues || 0) + 1; this.enqueueId = id; this.enqueuePayload = JSON.parse(payload); }
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

test('Media3 bridge plays directly and does not start the HTML video', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  proxy.src = '/media/test.mp4';
  proxy.play();
  assert.equal(proxy.src, '/media/test.mp4');
  assert.equal(f.domVideo.src, '');
  assert.equal(f.bridge.plays, 1);
  assert.equal(f.bridge.lastPayload.source, 'http://127.0.0.1/media/test.mp4');
  assert.equal(f.rootClassNames.has('native-playback'), true);
  proxy.pause();
});

test('Media3 uses the staged resume position', () => {
  const f = fixture(), video = f.document.getElementById('hero-video');
  video.src = '/media/history.mp4';
  f.context.window.HongguoNativePlaybackAdapter.setStartPosition(42.5);
  video.load();
  video.play();
  assert.equal(f.bridge.lastPayload.start_position, 42.5);
  assert.equal(f.domVideo.src, '');
});

test('Media3 failure stays on the bridge and ignores the failed session', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  const nativeId = activateNative(f);
  let errors = 0;
  proxy.addEventListener('error', () => errors++);
  f.context.window.HongguoNativePlayback.event(nativeId, 'error', {kind: 'first_frame_timeout'});
  f.context.window.HongguoNativePlayback.event(nativeId, 'ended');
  f.context.window.HongguoNativePlayback.progress(nativeId, 30000, 90000);
  assert.equal(errors, 1);
  assert.equal(f.rootClassNames.has('native-playback'), true);
  assert.equal(f.domVideo.src, '');
  assert.equal(proxy.paused, true);
  assert.equal(proxy.currentTime, 0);
});

test('enqueue keeps the current Media3 session and does not touch the HTML video', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  const id = activateNative(f);
  const stops = f.bridge.stops;
  assert.equal(f.context.window.HongguoNativePlaybackAdapter.enqueue('/minireel-proxy/media/abcdefabcdefabcdefabcdef.mp4'), true);
  assert.equal(f.bridge.enqueues, 1);
  assert.equal(f.bridge.enqueueId, id);
  assert.equal(f.bridge.stops, stops);
  assert.equal(f.domVideo.src, '');
  assert.equal(proxy.src, '/media/test.mp4');
  f.context.window.HongguoNativePlaybackAdapter.adoptSource('/media/next.mp4');
  assert.equal(proxy.src, '/media/next.mp4');
  assert.equal(f.bridge.stops, stops);
  assert.equal(f.domVideo.src, '');
  let advanced = 0, ended = 0;
  proxy.addEventListener('advanced', () => advanced++);
  proxy.addEventListener('ended', () => ended++);
  proxy.currentTime = 40;
  f.context.window.HongguoNativePlayback.event(id, 'advanced');
  assert.equal(advanced, 1);
  assert.equal(ended, 0);
  assert.equal(proxy.ended, false);
  assert.equal(proxy.currentTime, 0);
});

test('cutTo keeps the current Media3 session and reports a failed cut', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  const id = activateNative(f);
  const stops = f.bridge.stops;
  const plays = f.bridge.plays;
  f.bridge.cutTo = (cutId, payload) => {
    f.bridge.cuts = (f.bridge.cuts || 0) + 1;
    f.bridge.cutId = cutId;
    f.bridge.cutPayload = JSON.parse(payload);
  };
  assert.equal(f.context.window.HongguoNativePlaybackAdapter.cutTo('/minireel-proxy/media/abcdefabcdefabcdefabcdef.mp4'), true);
  assert.equal(f.bridge.cuts, 1);
  assert.equal(f.bridge.cutId, id);
  assert.equal(f.bridge.cutPayload.source, 'http://127.0.0.1/minireel-proxy/media/abcdefabcdefabcdefabcdef.mp4');
  assert.equal(f.bridge.stops, stops);
  assert.equal(f.bridge.plays, plays);
  assert.equal(f.domVideo.src, '');
  assert.equal(proxy.src, '/media/test.mp4');
  let failed = 0;
  proxy.addEventListener('cutfail', () => failed++);
  f.context.window.HongguoNativePlayback.event(id, 'cutfail');
  assert.equal(failed, 1);
  assert.equal(f.bridge.stops, stops);
});

test('MPV does not cut inside the Media3 playlist', () => {
  const f = fixture('mpv');
  const video = f.document.getElementById('hero-video');
  video.src = '/media/test.mp4';
  video.play();
  f.bridge.cutTo = () => { f.bridge.cuts = 1; };
  assert.equal(f.context.window.HongguoNativePlaybackAdapter.cutTo('/media/next.mp4'), false);
  assert.equal(f.bridge.cuts, undefined);
});

test('the next episode stays on Media3 instead of returning to the HTML video', () => {
  const f = fixture();
  const proxy = f.document.getElementById('hero-video');
  activateNative(f);
  const nativeId = f.bridge.lastId;
  proxy.src = '/media/next.mp4';
  proxy.play();
  assert.equal(proxy.src, '/media/next.mp4');
  assert.equal(f.domVideo.src, '');
  assert.equal(f.bridge.plays, 2);
  assert.notEqual(f.bridge.lastId, nativeId);
  assert.equal(f.bridge.lastPayload.source, 'http://127.0.0.1/media/next.mp4');
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

test('native playback preserves a staged history position across source load', async () => {
  const f = fixture('mpv'), video = f.document.getElementById('hero-video');
  video.src = '/media/history.mp4';
  f.context.window.HongguoNativePlaybackAdapter.setStartPosition(12.5);
  video.load();
  await video.play();
  assert.equal(f.bridge.lastPayload.start_position, 12.5);
});

test('explicit zero position clears a previously staged native resume position', async () => {
  const f = fixture('mpv'), video = f.document.getElementById('hero-video');
  video.src = '/media/history.mp4';
  f.context.window.HongguoNativePlaybackAdapter.setStartPosition(12.5);
  video.load();
  video.src = '/media/selected.mp4';
  f.context.window.HongguoNativePlaybackAdapter.setStartPosition(0);
  video.load();
  await video.play();
  assert.equal(f.bridge.lastPayload.start_position, 0);
});

test('app stages playback position on source changes and leaves native initial seek to the bridge', () => {
  assert.equal((appSource.match(/stageNativePlaybackStartPosition\(/g) || []).length - 1, 4);
  assert.match(appSource, /nativeStartPosition[\s\S]*!nativeStartPosition && position > 0/);
  assert.match(appSource, /function stageNativePlaybackStartPosition\(position\)[\s\S]*adapter\.setStartPosition\(position\)/);
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
  const transition = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private void requestStop('), mpvBridgeSource.indexOf('private void retire('));
  const start = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private void start(Session target)'), mpvBridgeSource.indexOf('/** Create/configure the player client'));
  assert.match(transition, /stopFence\.begin\(requestId, expectEndFile\)[\s\S]*player\.commandAsync\(new String\[\]\{"stop"\}, requestId\)/);
  assert.match(mpvBridgeSource, /stopFence\.onCommandReply\(requestId, error\)/);
  assert.match(mpvBridgeSource, /stopFence\.onEndFile\(\)/);
  assert.match(mpvBridgeSource, /stopFence\.onEventsDrained\(\)/);
  assert.match(mpvBridgeSource, /handler\.postDelayed\(stopTimeout, 3000\)/);
  assert.match(start, /setPropertyBoolean\("pause", true\)[\s\S]*command\(new String\[\]\{"loadfile", target\.source, "replace"\}\)/);
  assert.match(mpvBridgeSource, /final Session observed = session/);
  assert.match(mpvBridgeSource, /final long observedGeneration = generation/);
  assert.match(mpvBridgeSource, /observed\.generation != observedGeneration/);
  assert.match(mpvBridgeSource, /session != observed/);
  assert.match(mpvBridgeSource, /observed\.player != active/);
  assert.match(mpvBridgeSource, /if \(!target\.output\.loaded\) return;/);
});

test('MPV bridge keeps the last rapid source request and carries pause intent across the fence', () => {
  const play = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private void requestPlay('), mpvBridgeSource.indexOf('private void installSession('));
  const finish = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private void finishStopBoundary('), mpvBridgeSource.indexOf('@Override public void onPause()'));
  assert.match(play, /if \(stopFence\.isActive\(\)\)[\s\S]*transition\.queue\(new Session/);
  assert.match(mpvBridgeSource, /if \(stopFence\.isActive\(\)\) \{ transition\.setPlayIntent\(false\); return; \}/);
  assert.match(mpvBridgeSource, /if \(stopFence\.isActive\(\)\) \{ transition\.setPlayIntent\(true\); return; \}/);
  assert.match(finish, /installPendingSessionIfReady\(\);/);
  assert.match(mpvTransitionSource, /T takePendingSessionWhenReady\(boolean ready\)[\s\S]*return ready \? takePendingSession\(\) : null;/);
  assert.match(mpvBridgeSource, /Boolean playIntent = transition\.takePlayIntent\(\);/);
});

test('MPV bridge waits for the stop fence before retiring a player whose Surface was lost', () => {
  const bridge = mpvBridgeSource;
  const surface = bridge.slice(bridge.indexOf('@Override public void surfaceDestroyed'), bridge.indexOf('private void dispose('));
  const stop = bridge.slice(bridge.indexOf('private void requestStop('), bridge.indexOf('private void retire('));
  const finish = bridge.slice(bridge.indexOf('private void finishStopBoundary('), bridge.indexOf('@Override public void onPause()'));
  assert.match(stop, /stopTimeout = \(\) -> \{[\s\S]*stopFence\.onTimeout\(\)[\s\S]*finishStopBoundary\(false\);/);
  assert.match(surface, /surfaceReady = false;\s*surfaceEpoch\+\+;[\s\S]*if \(action == MpvSurfaceLifecyclePolicy\.Action\.DEFER_STOPPING_SESSION\) \{[\s\S]*return;/);
  assert.doesNotMatch(surface, /DEFER_STOPPING_SESSION\) \{\s*finishStopBoundary/);
  assert.doesNotMatch(surface, /retire\(stoppingPlayer\)/);
  assert.match(surface, /MpvSurfaceLifecyclePolicy\.Action\.RECREATE_ACTIVE_SESSION\) guarded\(s/);
  assert.match(surface, /MpvSurfaceLifecyclePolicy\.Action\.RETIRE_ORPHAN/);
  assert.match(stop, /stopSurfaceEpoch = surfaceEpoch;[\s\S]*stopFence\.begin\(/);
  assert.match(finish, /boolean sameSurface = !hadFence \|\| stopSurfaceEpoch == surfaceEpoch;[\s\S]*canReuseStoppedPlayer\([\s\S]*if \(!canReuse\) retire\(stopped\);/);
  assert.match(bridge, /surfaceCreated\(SurfaceHolder surfaceHolder\)[\s\S]*installPendingSessionIfReady\(\)[\s\S]*start\(target\);/);
  assert.match(bridge, /surfaceChanged\(SurfaceHolder surfaceHolder, int format, int w, int h\)[\s\S]*installPendingSessionIfReady\(\)/);
  assert.match(bridge, /private boolean installPendingSessionIfReady\(\)[\s\S]*stopFence\.isActive\(\)[\s\S]*takePendingSessionWhenReady\(surfaceAvailable\(\)\)[\s\S]*installSession\(pending\)/);
  assert.match(bridge, /MpvStartPolicy\.mayStart\(current\(target\), target\.player != null,[\s\S]*getSurface\(\)\.isValid\(\)\)/);
});

test('MPV bridge defers holder resizes during source replacement and avoids redundant Surface layout changes', () => {
  const bounds = mpvBridgeSource.slice(mpvBridgeSource.indexOf('@JavascriptInterface public void bounds('), mpvBridgeSource.indexOf('@Override public void surfaceCreated'));
  const applyBounds = mpvBridgeSource.slice(mpvBridgeSource.indexOf('private boolean applyBounds('), mpvBridgeSource.indexOf('@Override public void surfaceCreated'));
  assert.match(bounds, /left = l; top = t; width = w; height = h;[\s\S]*applyBoundsWhenIdle\(\);/);
  assert.match(mpvBridgeSource, /addOnLayoutChangeListener\([\s\S]*applyBoundsWhenIdle\(\)/);
  assert.match(mpvBridgeSource, /private void applyBoundsWhenIdle\(\) \{\s*if \(!stopFence\.isActive\(\)\) applyBounds\(\);/);
  assert.match(applyBounds, /current\.width == w && current\.height == h[\s\S]*current\.leftMargin == l && current\.topMargin == t[\s\S]*return true;/);
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

test('Media3 callback after an error cannot emit a stale ended or progress event', () => {
  const f = fixture(), video = f.document.getElementById('hero-video');
  const id = activateNative(f); let ends = 0, ticks = 0;
  video.addEventListener('ended', () => ends++); video.addEventListener('timeupdate', () => ticks++);
  f.context.window.HongguoNativePlayback.event(id, 'error');
  f.context.window.HongguoNativePlayback.event(id, 'ended');
  f.context.window.HongguoNativePlayback.progress(id, 30000, 90000);
  assert.equal(ends, 0); assert.equal(ticks, 0);
  assert.equal(f.rootClassNames.has('native-playback'), true);
  video.pause();
});
