(function (root) {
  'use strict';

  function supports(platform) { return platform === 'android' || platform === 'webos'; }
  function valid(value) { return value === 'enabled' || value === 'disabled'; }
  function create(options) {
    options = options || {};
    var platform = options.platform || 'desktop';
    var bridge = options.bridge;
    var storage = options.storage;
    var key = options.key || 'hongguo-tv-auto-cinema';
    var enabled = supports(platform);
    var message = '';
    function read() {
      if (!supports(platform)) { enabled = false; return enabled; }
      var value = '';
      try {
        if (bridge && typeof bridge.readAutoCinema === 'function') value = bridge.readAutoCinema();
        else if (storage && typeof storage.getItem === 'function') value = storage.getItem(key);
      } catch (ignored) {}
      if (valid(value)) enabled = value === 'enabled';
      return enabled;
    }
    function render() { if (typeof options.render === 'function') options.render({ supported: supports(platform), enabled: enabled, message: message }); }
    read(); render();
    return {
      enabled: function () { return enabled; },
      choose: function (value) {
        if (!supports(platform) || (value !== 'enabled' && value !== 'disabled')) return false;
        try {
          if (bridge && typeof bridge.writeAutoCinema === 'function') bridge.writeAutoCinema(value);
          else if (storage && typeof storage.setItem === 'function') storage.setItem(key, value);
          else return false;
          var saved = '';
          if (bridge && typeof bridge.readAutoCinema === 'function') saved = bridge.readAutoCinema();
          else saved = storage.getItem(key);
          if (saved !== value) return false;
          enabled = value === 'enabled'; message = ''; render(); return true;
        } catch (ignoredSave) { message = 'save_failed'; render(); return false; }
      }
    };
  }
  function shouldEnter(state) {
    return !!(state && supports(state.platform) && state.enabled && state.page === 'player' &&
      state.initialCardLaunch && state.firstFrame && state.focusedOnPlayer && !state.userExited);
  }

  var api = { supports: supports, shouldEnter: shouldEnter, create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HongguoAutoCinema = api;
}(this));
