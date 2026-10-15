(function (root) {
  'use strict';

  function itemsFor(rows, seriesID) {
    var seen = Object.create(null), items = [];
    (Array.isArray(rows) ? rows : []).forEach(function (item) {
      var id = item && String(item.series_id || '');
      if (!id || id === String(seriesID) || seen[id] || !item.title || item.upcoming || item.playable === false || items.length >= 20) return;
      seen[id] = true; items.push(item);
    });
    return items;
  }

  // The completed playback object owns this offer. No media requests, timers
  // or global recommendation queue can outlive that playback session.
  function create(options) {
    var entry = null, open = false;
    function reset() {
      entry = null;
      open = false;
      options.hide(false, false);
    }
    function flush() {
      if (!entry) return false;
      if (!options.isCurrent(entry.playback)) { reset(); return false; }
      if (entry.shown || open || !options.canPresent()) return false;
      entry.shown = true; open = true;
      options.show(entry.items);
      return true;
    }
    function offer(playback, rows) {
      if (!options.isCurrent(playback)) return false;
      if (entry && entry.playback === playback) return flush();
      var items = itemsFor(rows, playback.item.series_id);
      if (!items.length) return false;
      entry = { playback: playback, items: items, shown: false };
      return flush();
    }
    function close(restoreFocus) {
      if (!open) return false;
      open = false;
      options.hide(restoreFocus !== false, true);
      return true;
    }
    function choose(index) {
      if (!open || !entry || !options.isCurrent(entry.playback)) { reset(); return false; }
      var item = entry.items[index];
      if (!item) return false;
      reset();
      options.play(item);
      return true;
    }
    return { offer: offer, flush: flush, reset: reset, close: close, choose: choose, isOpen: function () { return open; } };
  }

  root.HongguoEndRecommendations = { create: create, itemsFor: itemsFor };
  if (typeof module === 'object' && module.exports) module.exports = root.HongguoEndRecommendations;
})(typeof window !== 'undefined' ? window : this);
