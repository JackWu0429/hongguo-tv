(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HongguoAppUpdates = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function t(key, fallback, params) {
    var i18n = typeof window !== 'undefined' && window.HongguoI18n;
    return i18n && i18n.t ? i18n.t(key, params, fallback) : fallback;
  }
  function create(options) {
    var lastAllowed = null;
    var last = '';
    function refresh() {
      var bridge = options.bridge;
      if (!bridge) { options.render({ supported: false, state: 'browser', message: t('content.browserUpdateOnly', '请在 Android 正式版中检查更新') }); return; }
      try {
        var text = bridge.getStatus();
        if (text !== last) { last = text; options.render(JSON.parse(text)); }
        var allowed = !!options.canPrompt();
        if (allowed !== lastAllowed) { lastAllowed = allowed; bridge.setPromptAllowed(allowed); }
      } catch (error) { options.render({ supported: false, state: 'error', message: t('content.updateUnavailable', '更新功能暂时不可用') }); }
    }
    function check() { if (options.bridge) { refresh(); options.bridge.check(); } }
    function configure() { if (options.bridge) options.bridge.configure(); }
    return { refresh: refresh, check: check, configure: configure };
  }
  return { create: create };
}));
