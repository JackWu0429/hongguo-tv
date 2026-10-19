(function (root) {
  'use strict';
  // A single speculative episode. No media is attached to a second player.
  function create(options) {
    var entry = null;
    function stableThreshold(info) {
      var value = Number(info && info.prefetch_after_seconds);
      return isFinite(value) && value >= 0 ? value : 5;
    }
    function cancel() {
      var previous = entry; entry = null;
      if (previous && previous.request) previous.request.abort();
    }
    function key(info) {
      return [info.series_id, info.vid, info.episode, info.quality || '', info.mode || '', info.generation, info.owner].join(':');
    }
    function current(candidate) {
      return (entry === candidate || candidate.claimed) && !(candidate.request && candidate.request.signal.aborted);
    }
    function maybe(info) {
      if (!info.active || !info.started || info.paused || info.ended || !isFinite(info.duration) ||
          !(info.duration > 0) || !isFinite(info.position) || info.position < 0 ||
          !isFinite(info.stable_seconds) || info.stable_seconds < stableThreshold(info)) return;
      var identity = key(info);
      if (entry && entry.key === identity) return;
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
        if (current(candidate) && data && data.path) candidate.timing.ready_at = Date.now();
        return data;
      }).catch(function () {
        // Silent failure; foreground playback retries through the normal resolver.
        return null;
      });
    }
    function keepFor(seriesID, episode, quality, owner, mode) {
      if (entry && (entry.info.series_id !== seriesID || entry.info.episode + 1 !== episode ||
          (entry.info.quality || '') !== (quality || '') || entry.info.owner !== owner || (entry.info.mode || '') !== (mode || ''))) cancel();
    }
    function consume(target) {
      var previous = entry;
      if (!previous || previous.info.series_id !== target.series_id || previous.info.episode + 1 !== target.episode ||
          (previous.info.quality || '') !== (target.quality || '') || previous.info.owner !== target.owner || (previous.info.mode || '') !== (target.mode || '') ||
          previous.target && previous.target.vid !== target.vid) { cancel(); return null; }
      // Keep an in-flight request alive across the natural episode switch. Its
      // only owner is now the foreground player, which can still cancel it.
      entry = null;
      previous.claimed = true;
      previous.expectedVid = target.vid;
      return { promise: previous.promise, timing: previous.timing, cancel: function () { if (previous.request) previous.request.abort(); } };
    }
    return { maybe: maybe, cancel: cancel, keepFor: keepFor, consume: consume };
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
