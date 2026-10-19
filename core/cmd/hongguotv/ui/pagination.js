(function (root) {
  'use strict';
  function text(key, fallback, params) {
    return root.HongguoI18n && root.HongguoI18n.t ? root.HongguoI18n.t(key, params, fallback) : fallback;
  }
  function errorText(error) {
    var detail = error && typeof error === 'object' ? error.message : error;
    var i18n = root.HongguoI18n;
    if (detail && (!i18n || typeof i18n.locale !== 'function' || i18n.locale() === i18n.defaultLocale)) return String(detail);
    return text('common.networkFailed', '连接失败');
  }
  // Networking and progressive local rendering share this controller. Old
  // replies are invalidated before aborting, including WebViews without AbortController.
  function createPager(options) {
    var p = { items: [], buffer: [], params: {}, cursor: {}, busy: false, error: '',
      more: true, loaded: false, generation: 0, emptyPages: 0, pagesLoaded: 0, seen: Object.create(null), request: null };
    var inFlight = null;
    function status() { if (options.status) options.status(p); }
    p.cancel = function () {
      p.generation++;
      if (p.request) p.request.abort();
      p.request = null; p.busy = false; inFlight = null;
      status();
    };
    p.reset = function (params) {
      p.cancel(); p.params = Object.assign({}, params || {}); p.cursor = {};
      p.items = []; p.buffer = []; p.seen = Object.create(null); p.more = true;
      p.loaded = false; p.error = ''; p.emptyPages = 0; p.pagesLoaded = 0;
      if (options.clear) options.clear();
      status(); return p.load();
    };
    p.hasMore = function () { return p.buffer.length > 0 || p.more; };
    p.local = function (items, count) {
      p.items = items.slice(0, count); p.buffer = items.slice(count);
      p.loaded = true; p.more = false; p.error = ''; p.pagesLoaded = 0; status();
    };
    function flush() {
      var rows = p.buffer.splice(0, options.pageSize || 20);
      var append = p.loaded;
      p.items = p.items.concat(rows); p.loaded = true;
      options.render(rows, append, p);
      return rows;
    }
    p.load = function (retry) {
      if (p.busy) return inFlight;
      if (p.error && !retry || !p.hasMore()) return Promise.resolve([]);
      if (p.buffer.length) {
        var added = flush(); status();
        if (options.after) options.after(p);
        return Promise.resolve(added);
      }
      var generation = p.generation;
      var previousOffset = Number(p.cursor.offset) || 0;
      var params = Object.assign({}, p.params, p.cursor);
      params.shown = p.items.slice(-200).map(function (item) { return item.series_id; }).join(',');
      p.request = typeof AbortController === 'function' ? new AbortController() : null;
      var signal = p.request && p.request.signal;
      p.busy = true; p.error = ''; status();
      inFlight = Promise.resolve().then(function () { if (generation !== p.generation) return null; return options.request(params, signal); })
        .then(function (data) {
          if (generation !== p.generation) return [];
          if (options.metadata) options.metadata(data, p);
          (data.items || []).forEach(function (item) {
            var key = item && (options.key ? options.key(item) : item.reservation_id || item.series_id);
            if (!key || p.seen[key]) return;
            p.seen[key] = true; p.buffer.push(item);
          });
          var next = Number(data.next_offset) || 0;
          var previousCursor = p.cursor;
          p.cursor = options.cursor ? options.cursor(data, previousCursor) : { offset: next, session_id: data.session_id || p.cursor.session_id || '',
            search_id: data.search_id || '', passback: data.passback || '', source: data.source || '' };
          p.emptyPages = p.buffer.length ? 0 : p.emptyPages + 1;
          var advances = options.cursor ? JSON.stringify(p.cursor) !== JSON.stringify(previousCursor) && Object.keys(p.cursor).length > 0 : next > previousOffset;
          p.more = !!data.has_more && advances && p.emptyPages < 3;
          p.pagesLoaded++;
          return flush();
        }).catch(function (error) {
          if (generation !== p.generation || error.name === 'AbortError') return [];
          p.error = errorText(error); return [];
        }).then(function (added) {
          if (generation === p.generation) {
            p.busy = false; p.request = null; inFlight = null; status();
            if (options.after) options.after(p);
            if (!p.error && Number(options.prefetchPages) > 0 && p.pagesLoaded <= Number(options.prefetchPages) && p.hasMore()) p.load();
          }
          return added;
        });
      return inFlight;
    };
    return p;
  }
  root.HongguoPagination = { create: createPager };
  if (typeof module === 'object' && module.exports) module.exports = root.HongguoPagination;
})(typeof window !== 'undefined' ? window : globalThis);
