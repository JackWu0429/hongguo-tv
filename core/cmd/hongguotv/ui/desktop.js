(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HongguoDesktopUI = api;
    if (root.HongguoDesktop || /(?:^|[?&])platform=desktop(?:&|$)/.test(root.location.search)) api.install(root);
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function t(key, fallback, params) {
    var i18n = typeof window !== 'undefined' && window.HongguoI18n;
    return i18n && i18n.t ? i18n.t(key, params, fallback) : fallback;
  }
  function mediaSource(path, config) {
    if (!config || !config.mediaBase || !/^\/minireel-proxy\/media\/[a-zA-Z0-9_-]+\.mp4$/.test(path)) return path;
    if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(config.mediaBase)) return path;
    return config.mediaBase + path;
  }
  function editing(element) {
    return !!(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
  }
  function install(win) {
    var doc = win.document, config = win.HongguoDesktop || { platform: 'preview', version: t('ui.desktopPreview', '桌面预览') };
    win.HongguoDesktop = config;
    doc.documentElement.classList.add('desktop-shell');
    ['account-phone', 'account-code'].forEach(function (id) {
      var old = doc.getElementById(id);
      if (!old || old.tagName === 'INPUT') return;
      var input = doc.createElement('input');
      input.id = id; input.className = old.className; input.type = 'text';
      input.setAttribute('data-focus', old.getAttribute('data-focus'));
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('autocomplete', id === 'account-phone' ? 'tel' : 'one-time-code');
      input.maxLength = id === 'account-phone' ? 11 : 8;
      input.placeholder = id === 'account-phone' ? t('ui.inputPhone', '请输入手机号') : t('ui.inputCode', '请输入验证码');
      input.setAttribute('aria-label', id === 'account-phone' ? t('ui.phoneLabel', '手机号') : t('ui.codeLabel', '短信验证码'));
      input.addEventListener('input', function () {
        if (!input.composing) input.value = input.value.replace(/[^0-9]/g, '').slice(0, input.maxLength);
        input.classList.toggle('is-empty', !input.value);
      });
      input.addEventListener('compositionstart', function () { input.composing = true; });
      input.addEventListener('compositionend', function () { input.composing = false; input.dispatchEvent(new win.Event('input')); });
      old.parentNode.replaceChild(input, old);
    });
    doc.addEventListener('phonecountrychange', function (event) {
      var input = doc.getElementById('account-phone');
      if (input && event.detail && event.detail.maxLength) {
        input.maxLength = event.detail.maxLength;
        if (input.value.length > input.maxLength) input.value = input.value.slice(0, input.maxLength);
      }
    });
    var help = doc.querySelector('.account-input-help');
    if (help) help.textContent = t('ui.desktopInputHelp', '直接输入或粘贴手机号和验证码；按 Tab 切换，按 Enter 提交。');
    win.HongguoTVUpdates = createUpdateBridge(win, config);
    win.HongguoDesktopWindow = createWindowMonitor(win, config);
    win.HongguoDesktopWindow.refresh();
    win.setInterval(win.HongguoDesktopWindow.refresh, 400);
    doc.addEventListener('visibilitychange', win.HongguoDesktopWindow.refresh);
  }
  function createWindowMonitor(win, config) {
    var pending = false, lastHidden = false, lastFullscreen = null;
    config.background = false;
    function refresh() {
      var bridge = win.go && win.go.main && win.go.main.desktopApp;
      if (pending || !bridge || !bridge.GetWindowState) return;
      pending = true;
      Promise.resolve(bridge.GetWindowState()).then(function (value) {
        var state = JSON.parse(value), hidden = !!state.hidden, fullscreen = !!state.fullscreen;
        config.background = hidden;
        if (!win.HongguoTV) return;
        if (hidden !== lastHidden) {
          lastHidden = hidden;
          if (hidden) win.HongguoTV.pauseForBackground(); else win.HongguoTV.resumeFromBackground();
        }
        if (fullscreen !== lastFullscreen) {
          lastFullscreen = fullscreen;
          win.HongguoTV.desktopFullscreenChanged(fullscreen);
        }
      }).catch(function () {}).then(function () { pending = false; });
    }
    return { refresh: refresh };
  }
  function createUpdateBridge(win, config) {
    var status = { supported: config.platform !== 'preview', desktop: true, state: 'idle', current_version: config.version,
      message: t('ui.updateDaily', '每天自动检查一次；下载 ZIP 后请自行解压替换。') };
    var pending = false, allowed = false;
    function app() { return win.go && win.go.main && win.go.main.desktopApp; }
    function poll() {
      if (pending || !app()) return;
      pending = true;
      Promise.resolve(app().GetUpdateStatus()).then(function (value) {
        var next = JSON.parse(value); next.prompt_allowed = allowed; status = next;
      }).catch(function () { status.message = t('ui.updateUnavailable', '更新状态暂时不可用，请稍后重试。'); }).then(function () { pending = false; });
    }
    function invoke(method) {
      var bridge = app(); if (!bridge) return;
      Promise.resolve(bridge[method]()).then(poll).catch(function () { status.message = t('ui.updateFailed', '更新操作未能完成，请重试。'); });
    }
    return {
      getStatus: function () { poll(); return JSON.stringify(status); },
      setPromptAllowed: function (value) { allowed = !!value; status.prompt_allowed = allowed; },
      check: function () { invoke('CheckUpdate'); },
      download: function () { invoke('DownloadUpdate'); },
      openFolder: function () { invoke('OpenUpdateFolder'); }
    };
  }
  return { mediaSource: mediaSource, editing: editing, install: install, createUpdateBridge: createUpdateBridge, createWindowMonitor: createWindowMonitor };
}));
