(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HongguoSearchHistory = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function normalize(value) {
    if (typeof value !== 'string') return '';
    value = value.replace(/\s+/g, ' ').trim();
    return value && value.length <= 100 && !/[\x00-\x1f\x7f-\x9f]/.test(value) ? value : '';
  }
  function create(options) {
    var queue = Promise.resolve();
    function request(method, query) {
      // A pending read/add cannot resurrect entries after a confirmed clear.
      queue = queue.then(function () {
        return options.request(method, query).then(function (data) {
          var items = [];
          (data.items || []).forEach(function (value) {
            var text = normalize(value);
            if (text && items.indexOf(text) < 0 && items.length < 10) items.push(text);
          });
          options.render(items); return true;
        }).catch(function (error) {
          if (options.error) options.error(method, error);
          return false;
        });
      });
      return queue;
    }
    return {
      load: function () { return request('GET'); },
      add: function (value) { var query = normalize(value); return query ? request('POST', query) : Promise.resolve(false); },
      clear: function () { return request('DELETE'); }
    };
  }
  return { create: create, normalize: normalize };
}));
