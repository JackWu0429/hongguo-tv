(function (root) {
  'use strict';
  // A single speculative episode. No media is attached to a second player.
  function create(options) {
    var entry = null;
    function cancel() {
      var previous = entry; entry = null;
      if (previous && previous.request) previous.request.abort();
    }
    function key(info) {
      return [info.series_id, info.vid, info.episode, info.quality || '', info.generation, info.owner].join(':');
    }
    function current(candidate) {
      return (entry === candidate || candidate.claimed) && !(candidate.request && candidate.request.signal.aborted);
    }
    function maybe(info) {
      if (!info.active || !info.started || info.paused || info.ended || !isFinite(info.duration) ||
          !(info.duration > 0) || !isFinite(info.position) || info.position < 5 ||
          info.position / info.duration < .62 && info.duration - info.position > 45) return;
      var identity = key(info);
      if (entry && entry.key === identity) return;
      cancel();
      var candidate = { key: identity, info: info, target: null,
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
      }).catch(function () {
        // Silent failure; foreground playback retries through the normal resolver.
        return null;
      });
    }
    function keepFor(seriesID, episode, quality, owner) {
      if (entry && (entry.info.series_id !== seriesID || entry.info.episode + 1 !== episode ||
          (entry.info.quality || '') !== (quality || '') || entry.info.owner !== owner)) cancel();
    }
    function consume(target) {
      var previous = entry;
      if (!previous || previous.info.series_id !== target.series_id || previous.info.episode + 1 !== target.episode ||
          (previous.info.quality || '') !== (target.quality || '') || previous.info.owner !== target.owner ||
          previous.target && previous.target.vid !== target.vid) { cancel(); return null; }
      // Keep an in-flight request alive across the natural episode switch. Its
      // only owner is now the foreground player, which can still cancel it.
      entry = null;
      previous.claimed = true;
      previous.expectedVid = target.vid;
      return { promise: previous.promise, cancel: function () { if (previous.request) previous.request.abort(); } };
    }
    return { maybe: maybe, cancel: cancel, keepFor: keepFor, consume: consume };
  }
  root.HongguoEpisodePrefetch = { create: create };
  if (typeof module === 'object' && module.exports) module.exports = root.HongguoEpisodePrefetch;
})(typeof window !== 'undefined' ? window : globalThis);
