(function () {
  'use strict';
  function t(key, fallback, params) {
    var i18n = window.HongguoI18n;
    return i18n && i18n.t ? i18n.t(key, params, fallback) : fallback;
  }

  // This file only runs when a native bridge exists. On this Hisense the
  // HTML video fires `playing` for HEVC and then never presents a frame, so
  // every episode used to wait out a fallback timer and start a second
  // decoder. Stay on the bridge. Browsers without the bridge return above.
  var domVideo = document.getElementById('hero-video');
  var bridge = window.HongguoNativePlayer;
  var nativeEnabled = false;
  var usingNative = false;
  var nativeRequested = false;
  var fixedNative = false;
  try { nativeEnabled = !!(bridge && bridge.isAvailable && bridge.isAvailable()); } catch (ignored) {}
  try { fixedNative = !!(nativeEnabled && bridge.engine && bridge.engine() === 'mpv'); } catch (ignoredEngine) {}
  if (!domVideo || !nativeEnabled) {
    window.HongguoNativePlaybackAdapter = { enabled: false, video: function () { return domVideo; } };
    return;
  }

  var listeners = {};
  var sequence = 0;
  var loadId = 'hongguo-' + (++sequence);
  var state = { source: '', currentTime: 0, startPosition: 0, duration: NaN, paused: true, ended: false, seeking: false,
    readyState: 0, videoWidth: 0, videoHeight: 0, seekPending: false, playbackRate: 1, volume: 1, muted: true, started: false };
  usingNative = true;
  document.documentElement.classList.add('native-playback');

  function isNative() { return nativeEnabled && usingNative; }
  function intendedMuted() {
    var intent = domVideo.getAttribute('data-playback-audio-intent');
    if (intent === '1') return true;
    // A missing or "0" attribute means the user did not mute. The cover mute
    // on the element itself must not silence the Media3 fallback.
    return false;
  }
  function dispatch(name, detail) {
    var list = (listeners[name] || []).slice();
    list.forEach(function (listener) { try { listener.call(proxy, detail || { type: name, target: proxy }); } catch (ignored) {} });
  }
  function setClass(name, value) { domVideo.classList.toggle(name, !!value); }
  function syncBounds() {
    try {
      var node = document.querySelector('.hero-media') || domVideo;
      var rect = node.getBoundingClientRect();
      var width = window.innerWidth || document.documentElement.clientWidth || 1;
      var height = window.innerHeight || document.documentElement.clientHeight || 1;
      if (rect.width > 1 && rect.height > 1 && bridge.bounds) {
        bridge.bounds(rect.left / width, rect.top / height, rect.width / width, rect.height / height);
      }
    } catch (ignored) {}
  }
  function localSource(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return (window.location.origin || '') + path;
  }
  function invokePlay() {
    if (!state.source) return;
    syncBounds();
    // The cover mutes the HTML element. Media3 must follow the intent
    // attribute, which holdPlaybackAudio sets from the volume preference.
    state.volume = Number(domVideo.volume);
    if (!isFinite(state.volume)) state.volume = 1;
    state.muted = intendedMuted();
    try {
      console.info('HGSWITCH audio native muted=' + (state.muted ? 1 : 0) + ' volume=' + state.volume);
    } catch (ignoredAudioLog) {}
    try { if (bridge.setVolume) bridge.setVolume(state.volume, state.muted); } catch (ignoredVolume) {}
    var payload = JSON.stringify({ source: localSource(state.source), start_position: state.currentTime || 0,
      paused: false, speed: state.playbackRate || 1 });
    try { nativeRequested = true; bridge.play(loadId, payload); } catch (error) { nativeRequested = false; dispatch('error', error); }
  }
  function enqueue(path) {
    if (!path || !state.source || !bridge.enqueue || !isNative() || fixedNative) return false;
    try {
      bridge.enqueue(loadId, JSON.stringify({ source: localSource(path) }));
      return true;
    } catch (ignored) { return false; }
  }
  function cutTo(path) {
    if (!path || !state.source || !bridge.cutTo || !isNative() || fixedNative) return false;
    try {
      bridge.cutTo(loadId, JSON.stringify({ source: localSource(path) }));
      return true;
    } catch (ignored) { return false; }
  }
  function adoptSource(path) {
    if (path) state.source = path;
    state.currentTime = 0;
    state.ended = false;
    state.paused = false;
    state.started = true;
    state.readyState = Math.max(3, state.readyState);
  }
  function resetToDomSource(next) {
    nativeRequested = false;
    loadId = 'hongguo-' + (++sequence);
    if (isNative()) {
      try { if (bridge.stop) bridge.stop(); } catch (ignoredStop) {}
    }
    usingNative = true;
    document.documentElement.classList.add('native-playback');
    state.source = next;
    state.currentTime = 0; state.startPosition = 0; state.duration = NaN; state.paused = true; state.ended = false;
    state.seeking = false; state.readyState = 0; state.videoWidth = 0; state.videoHeight = 0;
    state.seekPending = false; state.started = false;
    // Do not hand the URL to the HTML video. That starts a decoder this TV
    // cannot present, then waits a second before Media3 replaces it.
    proxy.error = null;
    proxy.networkState = next ? 2 : 0;
    dispatch('emptied');
  }

  function add(name, listener) {
    if (!listeners[name]) listeners[name] = [];
    listeners[name].push(listener);
  }
  function remove(name, listener) {
    var list = listeners[name] || [], index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  var proxy = {
    getAttribute: function (name) { return name === 'src' ? (state.source || null) : domVideo.getAttribute(name); },
    setAttribute: function (name, value) { if (name === 'src') proxy.src = value; else domVideo.setAttribute(name, value); },
    removeAttribute: function (name) { if (name === 'src') proxy.src = ''; else domVideo.removeAttribute(name); },
    addEventListener: add,
    removeEventListener: remove,
    dispatchEvent: function (event) { if (event && event.type) dispatch(event.type, event); return true; },
    load: function () {
      if (!isNative()) { domVideo.load(); return; }
      loadId = 'hongguo-' + (++sequence);
      nativeRequested = false;
      proxy.error = null;
      state.currentTime = state.startPosition; state.duration = NaN; state.paused = true; state.ended = false; state.seeking = false;
      state.readyState = 0; state.videoWidth = 0; state.videoHeight = 0; state.seekPending = false; state.started = false;
      try { bridge.begin(loadId); } catch (ignored) {}
      dispatch('emptied');
    },
    play: function () {
      if (!state.source) return Promise.reject(new Error(t('content.noMediaUrl', '没有播放地址')));
      state.paused = false; state.ended = false;
      if (nativeRequested && bridge.resume) { try { bridge.resume(); } catch (ignored) {} }
      else invokePlay();
      return Promise.resolve();
    },
    pause: function () { state.paused = true; if (bridge.pause) try { bridge.pause(); } catch (ignored) {} dispatch('pause'); },
    classList: domVideo.classList,
    style: domVideo.style,
    error: null,
    networkState: 0,
    buffered: { length: 0, start: function () { return 0; }, end: function () { return 0; } }
  };
  Object.defineProperties(proxy, {
    src: { get: function () { return isNative() ? state.source : domVideo.src; }, set: function (value) {
      var next = value == null ? '' : String(value);
      if (!isNative()) {
        resetToDomSource(next); return;
      }
      if (next !== state.source) { resetToDomSource(next); return; }
      state.source = next; proxy.networkState = state.source ? 2 : 0; if (!state.source) setClass('has-source', false);
    } },
    currentTime: { get: function () { return isNative() ? state.currentTime : domVideo.currentTime; }, set: function (value) { if (!isNative()) { domVideo.currentTime = value; return; } var next = Number(value); if (!isFinite(next)) return; state.seeking = true; state.seekPending = true; state.currentTime = Math.max(0, next); dispatch('seeking'); if (bridge.seekTo) try { bridge.seekTo(state.currentTime); } catch (ignored) {} } },
    duration: { get: function () { return isNative() ? state.duration : domVideo.duration; } },
    paused: { get: function () { return isNative() ? state.paused : domVideo.paused; } },
    ended: { get: function () { return isNative() ? state.ended : domVideo.ended; } },
    seeking: { get: function () { return isNative() ? state.seeking : domVideo.seeking; } },
    readyState: { get: function () { return isNative() ? state.readyState : domVideo.readyState; } },
    videoWidth: { get: function () { return isNative() ? state.videoWidth : domVideo.videoWidth; } },
    videoHeight: { get: function () { return isNative() ? state.videoHeight : domVideo.videoHeight; } },
    playbackRate: { get: function () { return isNative() ? state.playbackRate : domVideo.playbackRate; }, set: function (value) { if (!isNative()) { domVideo.playbackRate = value; return; } var next = Number(value); if (!isFinite(next) || next <= 0) return; state.playbackRate = next; if (bridge.setSpeed) try { bridge.setSpeed(next); } catch (ignored) {} } },
    defaultPlaybackRate: { get: function () { return isNative() ? state.playbackRate : domVideo.defaultPlaybackRate; }, set: function (value) { proxy.playbackRate = value; } },
    volume: { get: function () { return isNative() ? state.volume : domVideo.volume; }, set: function (value) { if (!isNative()) { domVideo.volume = value; return; } var next = Math.max(0, Math.min(1, Number(value))); if (!isFinite(next)) return; state.volume = next; state.muted = next === 0; if (bridge.setVolume) try { bridge.setVolume(next, state.muted); } catch (ignored) {} dispatch('volumechange'); } },
    muted: { get: function () { return isNative() ? state.muted : domVideo.muted; }, set: function (value) { if (!isNative()) { domVideo.muted = value; return; } state.muted = !!value; if (bridge.setVolume) try { bridge.setVolume(state.volume, state.muted); } catch (ignored) {} dispatch('volumechange'); } }
  });

  window.HongguoNativePlayback = {
    event: function (id, name, detail) {
      if (!isNative() || id !== loadId) return;
      detail = detail || {};
      if (name === 'buffering' || name === 'waiting') { state.readyState = 1; state.seeking = false; dispatch('waiting', detail); return; }
      if (name === 'frame') {
        state.readyState = 3; state.videoWidth = Number(detail.width) || 0; state.videoHeight = Number(detail.height) || 0;
        // Keep the rendered-frame signal separate from `playing`. Some
        // Android 9 WebViews receive this callback first; app.js can reveal
        // the real native surface without treating the episode as started
        // for history/progress purposes.
        dispatch('nativeframe', { type: 'nativeframe', nativeFrame: true, width: state.videoWidth, height: state.videoHeight });
        dispatch('loadedmetadata'); dispatch('loadeddata'); dispatch('canplay'); return;
      }
      if (name === 'advanced') {
        dispatch('advanced', detail);
        state.currentTime = 0; state.duration = NaN; state.paused = false; state.ended = false;
        state.started = true; state.seeking = false; state.readyState = Math.max(3, state.readyState);
        return;
      }
      if (name === 'cutfail') { dispatch('cutfail', detail); return; }
      if (name === 'playing') { state.started = true; state.paused = false; state.ended = false; state.seeking = false; state.readyState = Math.max(3, state.readyState); dispatch('playing', detail); return; }
      if (name === 'paused') { state.paused = true; dispatch('pause', detail); return; }
      if (name === 'ended') { state.ended = true; state.paused = true; state.seeking = false; dispatch('ended', detail); return; }
      if (name === 'error') {
        state.paused = true; state.started = false; state.readyState = 0;
        nativeRequested = false;
        loadId = 'hongguo-' + (++sequence);
        proxy.error = { code: 3, message: detail.kind || (fixedNative ? t('content.mpvFailed', 'MPV 播放失败') : t('content.nativeFailed', '播放失败')) };
        dispatch('error', { type: 'error', target: proxy, detail: detail });
      }
    },
    progress: function (id, position, duration) {
      if (!isNative() || id !== loadId) return;
      // PlayerBridge reports both values in milliseconds. Keep the adapter's
      // HTMLMediaElement-compatible state in seconds; leaving position in ms
      // makes the timeline clamp to 100% almost immediately on native playback.
      var positionMs = Number(position);
      var durationMs = Number(duration);
      state.currentTime = isFinite(positionMs) && positionMs >= 0 ? positionMs / 1000 : 0;
      state.duration = isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : NaN;
      if (isFinite(state.duration) && state.currentTime > state.duration) state.currentTime = state.duration;
      if (state.seekPending) { state.seekPending = false; state.seeking = false; dispatch('seeked'); } else state.seeking = false; dispatch('timeupdate');
    }
  };
  window.HongguoNativePlaybackAdapter = {
    enabled: true,
    engine: fixedNative ? 'mpv' : 'webview_media3',
    video: function () { return proxy; },
    isNative: isNative,
    setStartPosition: function (seconds) {
      var value = Number(seconds);
      state.startPosition = isFinite(value) && value > 0 ? Math.min(value, 86400) : 0;
      if (isNative()) state.currentTime = state.startPosition;
    },
    syncBounds: syncBounds,
    enableNative: function () { return isNative(); },
    enqueue: enqueue,
    adoptSource: adoptSource,
    cutTo: cutTo
  };
  // app.js intentionally keeps its established DOM lookup contract. Redirect
  // only this media element so existing focus, history and test seams remain
  // unchanged while the native adapter supplies the media-like surface.
  var originalGetElementById = document.getElementById.bind(document);
  document.getElementById = function (id) { return id === 'hero-video' ? proxy : originalGetElementById(id); };
  window.addEventListener('resize', syncBounds);
  window.addEventListener('orientationchange', syncBounds);
}());
