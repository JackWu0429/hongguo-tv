(function () {
  'use strict';
  // Executed only by the opt-in native Linux test after each navigation.
  if (!window.HongguoTV || window.__linuxPlaybackProbe) return;
  window.__linuxPlaybackProbe = true;
  var report = { ok: false, engine: 'Wails 2 / WebKitGTK', userAgent: navigator.userAgent,
    series_id: '7696023326375808024', steps: [], events: [], requests: [] };
  var video = document.getElementById('hero-video');
  var started = performance.now(), presented = 0, lastPTS = null, sourceNumber = 0, lastSource = '';
  var originalFetch = window.fetch;
  // Keep status/mode evidence without retaining signed URLs, response bodies,
  // keys, local media tokens, or account data in the test report.
  window.fetch = function (input, options) {
    var url = String(input && input.url || input);
    var relevant = /\/api\/v1\/(?:play\/info|series\/detail)(?:\?|$)/.test(url);
    return originalFetch.apply(this, arguments).then(function (response) {
      if (relevant) {
        var entry = { endpoint: url.indexOf('/play/info') >= 0 ? 'play/info' : 'series/detail', status: response.status };
        report.requests.push(entry);
        response.clone().json().then(function (body) {
          var data = body.data || body;
          entry.ok = body.ok;
          if (entry.endpoint === 'play/info') {
            entry.mode = data.mode || null;
            entry.vid = data.vid || null;
          }
        }).catch(function () {});
      }
      return response;
    });
  };
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function text(selector) { var node = document.querySelector(selector); return node ? node.textContent.trim() : ''; }
  function sample() {
    var source = video.currentSrc || video.src;
    if (source !== lastSource) { lastSource = source; sourceNumber++; }
    var quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : {};
    var rect = video.getBoundingClientRect();
    return { elapsed: Math.round(performance.now() - started), source: sourceNumber,
      title: text('.hero-title'), episode: text('#hero-top-episode'),
      time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null,
      width: video.videoWidth, height: video.videoHeight, readyState: video.readyState,
      paused: video.paused, muted: video.muted, volume: video.volume,
      error: video.error ? { code: video.error.code } : null,
      decodedFrames: quality.totalVideoFrames || video.webkitDecodedFrameCount || 0,
      droppedFrames: quality.droppedVideoFrames || video.webkitDroppedFrameCount || 0,
      presentedCallbacks: presented, lastPTS: lastPTS,
      viewport: { width: innerWidth, height: innerHeight },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      overlay: document.getElementById('hero').className,
      status: text('#player-status') || text('.hero-status') };
  }
  if (video.requestVideoFrameCallback) {
    var frame = function (now, metadata) {
      presented++; lastPTS = metadata.mediaTime;
      video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
  }
  ['loadstart', 'loadedmetadata', 'loadeddata', 'playing', 'waiting', 'seeking', 'seeked', 'ended', 'error'].forEach(function (name) {
    video.addEventListener(name, function () {
      if (report.events.length < 120) report.events.push({ event: name, sample: sample() });
    });
  });
  async function waitFor(label, condition, timeout) {
    var deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      if (condition()) return;
      if (video.error) throw new Error(label + ': MediaError ' + video.error.code);
      await sleep(200);
    }
    throw new Error(label + ': timed out');
  }
  async function capture(stage) {
    var data = sample(); data.stage = stage;
    try { data.media_path = new URL(video.currentSrc || video.src).pathname; } catch (ignored) {}
    var response = await originalFetch('/__linux_probe/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('native capture failed: ' + response.status);
    var captured = await response.json();
    report.steps.push(captured);
    return data;
  }
  (async function () {
    try {
      // The normal shell/API/account startup must finish before card launch.
      await sleep(4000);
      if (!window.HongguoTV.openHomeProgram({ series_id: report.series_id, title: '神豪外挂第一季' })) throw new Error('card launch rejected');
      await waitFor('episode 1 first decoded picture', function () {
        return text('.hero-title') === '神豪外挂第一季' && /第1集/.test(text('#hero-top-episode')) &&
          video.videoWidth > 0 && video.readyState >= 2 && video.currentTime > 2 && !video.paused;
      }, 100000);
      var first = await capture('first-a');
      await sleep(3500);
      var later = await capture('first-b');
      if (later.time - first.time < 2 || later.source !== first.source) throw new Error('episode 1 did not continue playing');
      var target = Math.min(later.time + 12, video.duration - 8);
      if (target - video.currentTime < 3) throw new Error('clip too short to verify a seek');
      var seekEvents = report.events.filter(function (e) { return e.event === 'seeked'; }).length;
      video.currentTime = target;
      await waitFor('seek and resume', function () {
        return video.currentTime > target + 1 && !video.seeking && !video.paused &&
          report.events.filter(function (e) { return e.event === 'seeked'; }).length > seekEvents;
      }, 45000);
      await capture('after-seek');
      var oldSource = video.currentSrc;
      document.getElementById('hero-feed-focus').focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await waitFor('episode 2 decoded picture', function () {
        return /第2集/.test(text('#hero-top-episode')) && video.currentSrc !== oldSource &&
          video.videoWidth > 0 && video.currentTime > 2 && video.readyState >= 2 && !video.paused;
      }, 100000);
      var second = await capture('second-a');
      await sleep(3500);
      var secondLater = await capture('second-b');
      if (secondLater.time - second.time < 2 || secondLater.source !== second.source) throw new Error('episode 2 did not continue playing');
      if (presented < 20 && secondLater.decodedFrames < 20) throw new Error('no decoded/presented frame evidence');
      report.ok = true;
    } catch (error) {
      report.failure = String(error.message || error).replace(/https?:\/\/\S+/g, '[URL omitted]');
      report.last = sample();
      try { await capture('failure'); } catch (ignored) {}
    }
    await originalFetch('/__linux_probe/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report)
    });
  }());
}());
