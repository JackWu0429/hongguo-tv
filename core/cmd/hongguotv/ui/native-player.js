(function () {
  'use strict';

  // Android 10+ uses this adapter to keep the HTML control surface while
  // Media3 owns the decoder and video surface. Android 6-9 keep the original
  // HTMLMediaElement path because some Android 9 TV Media3 surfaces stay black
  // while audio and playback progress continue.
  var domVideo = document.getElementById('hero-video');
  var bridge = window.HongguoNativePlayer;
  var nativeEnabled = false;
  var usingNative = true;
  try { nativeEnabled = !!(bridge && bridge.isAvailable && bridge.isAvailable()); } catch (ignored) {}
  if (!domVideo || !nativeEnabled) {
    window.HongguoNativePlaybackAdapter = { enabled: false, video: function () { return domVideo; } };
    return;
  }

  var listeners = {};
  var sequence = 0;
  var loadId = 'hongguo-' + (++sequence);
  var state = { source: '', currentTime: 0, duration: NaN, paused: true, ended: false, seeking: false,
    readyState: 0, videoWidth: 0, videoHeight: 0, seekPending: false, playbackRate: 1, volume: 1, muted: true, started: false };

  function isNative() { return nativeEnabled && usingNative; }
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
    var payload = JSON.stringify({ source: localSource(state.source), start_position: state.currentTime || 0,
      paused: false, speed: state.playbackRate || 1 });
    try { bridge.play(loadId, payload); } catch (error) { dispatch('error', error); }
  }
  function fallbackToDom() {
    if (!isNative()) return;
    usingNative = false;
    document.documentElement.classList.remove('native-playback');
    try {
      domVideo.src = state.source;
      domVideo.playbackRate = state.playbackRate;
      domVideo.volume = state.volume;
      domVideo.muted = state.muted;
      domVideo.load();
      if (!state.paused) Promise.resolve(domVideo.play()).catch(function () {});
    } catch (ignored) {}
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
      state.currentTime = 0; state.duration = NaN; state.paused = true; state.ended = false; state.seeking = false;
      state.readyState = 0; state.videoWidth = 0; state.videoHeight = 0; state.seekPending = false; state.started = false;
      try { bridge.begin(loadId); } catch (ignored) {}
      dispatch('emptied');
    },
    play: function () {
      if (!isNative()) return domVideo.play();
      if (!state.source) return Promise.reject(new Error('没有播放地址'));
      state.paused = false; state.ended = false;
      if (state.started && bridge.resume) { try { bridge.resume(); } catch (ignored) {} }
      else invokePlay();
      return Promise.resolve();
    },
    pause: function () { if (!isNative()) { domVideo.pause(); return; } state.paused = true; if (bridge.pause) try { bridge.pause(); } catch (ignored) {} dispatch('pause'); },
    classList: domVideo.classList,
    style: domVideo.style,
    error: null,
    networkState: 0,
    buffered: { length: 0, start: function () { return 0; }, end: function () { return 0; } }
  };
  Object.defineProperties(proxy, {
    src: { get: function () { return isNative() ? state.source : domVideo.src; }, set: function (value) { if (!isNative()) { domVideo.src = value == null ? '' : String(value); return; } state.source = value == null ? '' : String(value); proxy.networkState = state.source ? 2 : 0; if (!state.source) setClass('has-source', false); } },
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
      if (id !== loadId) return;
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
      if (name === 'playing') { state.started = true; state.paused = false; state.ended = false; state.seeking = false; state.readyState = Math.max(3, state.readyState); dispatch('playing', detail); return; }
      if (name === 'paused') { state.paused = true; dispatch('pause', detail); return; }
      if (name === 'ended') { state.ended = true; state.paused = true; state.seeking = false; dispatch('ended', detail); return; }
      if (name === 'error') { fallbackToDom(); }
    },
    progress: function (id, position, duration) {
      if (id !== loadId) return;
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
  ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'ended', 'timeupdate', 'waiting', 'seeking', 'seeked', 'ratechange', 'volumechange', 'emptied', 'error'].forEach(function (name) {
    domVideo.addEventListener(name, function (event) { if (!isNative()) dispatch(name, event); });
  });
  window.HongguoNativePlaybackAdapter = { enabled: true, video: function () { return proxy; }, syncBounds: syncBounds };
  // app.js intentionally keeps its established DOM lookup contract. Redirect
  // only this media element so existing focus, history and test seams remain
  // unchanged while the native adapter supplies the media-like surface.
  var originalGetElementById = document.getElementById.bind(document);
  document.getElementById = function (id) { return id === 'hero-video' ? proxy : originalGetElementById(id); };
  document.documentElement.classList.add('native-playback');
  window.addEventListener('resize', syncBounds);
  window.addEventListener('orientationchange', syncBounds);
}());
