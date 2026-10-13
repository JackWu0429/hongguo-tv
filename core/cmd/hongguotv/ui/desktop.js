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
  function mediaSource(path, config) {
    if (!config || !config.mediaBase || !/^\/minireel-proxy\/media\/[a-zA-Z0-9_-]+\.mp4$/.test(path)) return path;
    if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(config.mediaBase)) return path;
    return config.mediaBase + path;
  }
  function editing(element) {
    return !!(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
  }
  function install(win) {
    var doc = win.document, config = win.HongguoDesktop || { platform: 'preview', version: '桌面预览' };
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
      input.placeholder = id === 'account-phone' ? '请输入手机号' : '请输入验证码';
      input.setAttribute('aria-label', id === 'account-phone' ? '手机号' : '短信验证码');
      input.addEventListener('input', function () {
        if (!input.composing) input.value = input.value.replace(/[^0-9]/g, '').slice(0, input.maxLength);
        input.classList.toggle('is-empty', !input.value);
      });
      input.addEventListener('compositionstart', function () { input.composing = true; });
      input.addEventListener('compositionend', function () { input.composing = false; input.dispatchEvent(new win.Event('input')); });
      old.parentNode.replaceChild(input, old);
    });
    var help = doc.querySelector('.account-input-help');
    if (help) help.textContent = '直接输入或粘贴手机号和验证码；按 Tab 切换，按 Enter 提交。';
    win.HongguoTVUpdates = {
      getStatus: function () { return JSON.stringify({ supported: config.platform !== 'preview', state: 'desktop', current_version: config.version,
        message: '桌面测试版：下载页可查看后续版本，更新应用不会清除账号和观看记录。' }); },
      setPromptAllowed: function () {},
      check: function () {
        var app = win.go && win.go.main && win.go.main.desktopApp;
        if (app) app.OpenDownloads();
      }
    };
  }
  return { mediaSource: mediaSource, editing: editing, install: install };
}));
