(function (root) {
  'use strict';
  // A single speculative episode. No media is attached to a second player.
  function create(options) {
    var entry = null;
    function stableThreshold(info) {
      var value = Number(info && info.prefetch_after_seconds);
      return isFinite(value) && value >= 0 ? value : 5;
    }
    function durationAllows(info) {
      var duration = Number(info && info.duration);
      if (duration === Infinity || duration < 0) return false;
      if (isFinite(duration) && duration > 0) return true;
      // Threshold 0 means this episode is already playing. Hisense reports
      // a frame before ExoPlayer has a duration. Waiting for duration skips
      // the only prefetch window on a short episode.
      return !isFinite(duration) && stableThreshold(info) === 0;
    }
    function cancel() {
      var previous = entry; entry = null;
      if (previous && previous.request) previous.request.abort();
    }
    function episodeNumber(value) {
      var episode = Number(value);
      return isFinite(episode) ? episode : 0;
    }
    function key(info) {
      return [info.series_id, info.vid, episodeNumber(info.episode), info.quality || '', info.mode || '', info.generation, info.owner].join(':');
    }
    function current(candidate) {
      return (entry === candidate || candidate.claimed) && !(candidate.request && candidate.request.signal.aborted);
    }
    function maybe(info) {
      if (!info.active || !info.started || info.paused || info.ended || !durationAllows(info) ||
          !isFinite(info.position) || info.position < 0 ||
          !isFinite(info.stable_seconds) || info.stable_seconds < stableThreshold(info)) return;
      var identity = key(info);
      if (entry && entry.key === identity) {
        if (entry.ready || !entry.settled || Date.now() - entry.settled < 800) return;
        cancel();
      }
      cancel();
      var candidate = { key: identity, info: info, target: null, timing: { started_at: Date.now(), ready_at: 0 },
        request: typeof AbortController === 'function' ? new AbortController() : null };
      entry = candidate;
      candidate.promise = Promise.resolve().then(function () {
        if (!current(candidate)) return null;
        return options.lookup(info, candidate.request && candidate.request.signal);
      }).then(function (target) {
        if (!current(candidate) || !target || !/^[0-9]+$/.test(target.vid || '') || target.vid === info.vid || target.series_id !== info.series_id ||
            candidate.expectedVid && candidate.expectedVid !== target.vid) return null;
        candidate.target = target;
        return options.prepare(target, candidate.request && candidate.request.signal);
      }).then(function (data) {
        candidate.settled = Date.now();
        if (current(candidate) && data && data.path) {
          candidate.ready = data.mode !== 'full';
          candidate.path = candidate.ready ? data.path : '';
          candidate.timing.ready_at = Date.now();
          if (typeof options.prepared === 'function') {
            try { options.prepared(candidate.info, candidate.target, data); } catch (ignoredPrepared) {}
          }
        }
        notifyHold(candidate);
        return data;
      }).catch(function () {
        candidate.settled = Date.now();
        notifyHold(candidate);
        return null;
      });
    }
    function notifyHold(candidate) {
      if (!candidate || !candidate.hold) return;
      var notify = candidate.hold;
      candidate.hold = null;
      try { notify(candidate.ready && candidate.path ? candidate : null); } catch (ignoredHold) {}
    }
    // One next-episode job. If it is already running, the caller waits for it
    // instead of starting a second resolver that cancels the first.
    function hold(seriesID, episode, quality, owner, mode, done) {
      if (!entry || entry.info.series_id !== seriesID || episodeNumber(entry.info.episode) + 1 !== episodeNumber(episode) ||
          (entry.info.quality || '') !== (quality || '') || entry.info.owner !== owner || (entry.info.mode || '') !== (mode || '')) return false;
      if (entry.settled && !entry.ready) return false;
      if (entry.ready && entry.path) { done(entry); return 'ready'; }
      entry.hold = done;
      return 'wait';
    }
    function keepFor(seriesID, episode, quality, owner, mode) {
      if (entry && (entry.info.series_id !== seriesID || episodeNumber(entry.info.episode) + 1 !== episodeNumber(episode) ||
          (entry.info.quality || '') !== (quality || '') || entry.info.owner !== owner || (entry.info.mode || '') !== (mode || ''))) cancel();
    }
    function consume(target) {
      var previous = entry;
      if (!previous || previous.info.series_id !== target.series_id || episodeNumber(previous.info.episode) + 1 !== episodeNumber(target.episode) ||
          (previous.info.quality || '') !== (target.quality || '') || previous.info.owner !== target.owner || (previous.info.mode || '') !== (target.mode || '') ||
          previous.target && String(previous.target.vid) !== String(target.vid)) { cancel(); return null; }
      // Keep an in-flight request alive across the natural episode switch. Its
      // only owner is now the foreground player, which can still cancel it.
      entry = null;
      previous.claimed = true;
      previous.expectedVid = target.vid;
      return { promise: previous.promise, timing: previous.timing, cancel: function () { if (previous.request) previous.request.abort(); } };
    }
    return { maybe: maybe, cancel: cancel, keepFor: keepFor, consume: consume, hold: hold };
  }
  function nextUnlockedEpisodes(detail, currentEpisode, maximum) {
    var videos = detail && detail.vid_list || [];
    var episodes = detail && detail.episodes || [];
    var accessible = Number(detail && detail.accessible_episode_cnt) || 0;
    var limit = Math.min(4, Math.max(0, Number(maximum) || 4));
    var result = [];
    for (var index = Math.max(0, Number(currentEpisode) || 0); index < videos.length && result.length < limit; index++) {
      var episode = episodes[index];
      if ((episode && episode.locked === true) || (!episode && accessible > 0 && index >= accessible)) continue;
      var vid = episode && episode.video_id || videos[index];
      if (!/^[0-9]{1,32}$/.test(String(vid || ''))) continue;
      result.push({ episode: index + 1, vid: String(vid) });
    }
    return result;
  }
  root.HongguoEpisodePrefetch = { create: create, nextUnlockedEpisodes: nextUnlockedEpisodes };
  if (typeof module === 'object' && module.exports) module.exports = root.HongguoEpisodePrefetch;
})(typeof window !== 'undefined' ? window : globalThis);
