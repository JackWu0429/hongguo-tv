(function (root) {
  'use strict';
  function create(options) {
    var bridge = options.bridge, mode = '', supported = false, message = '';
    function read() {
      if (!bridge || typeof bridge.engine !== 'function' || bridge.engine() !== 'mpv' ||
          typeof bridge.decoderMode !== 'function' || typeof bridge.setDecoderMode !== 'function') return false;
      var value = bridge.decoderMode();
      if (value !== 'mpv_auto' && value !== 'mpv_software') return false;
      mode = value; return true;
    }
    function render() { options.render({ supported: supported, mode: mode, message: message }); }
    try { supported = read(); } catch (ignored) { supported = false; }
    render();
    return { choose: function (value) {
      if (!supported || value !== 'mpv_auto' && value !== 'mpv_software') return false;
      try {
        bridge.setDecoderMode(value);
        if (!read() || mode !== value) throw new Error('Preference not saved');
        message = '已选择' + (mode === 'mpv_auto' ? '自动解码' : '软件解码') + '，下次播放或切集时生效。';
        render(); return true;
      } catch (ignoredSave) {
        message = '设置未能保存，请重试。'; render(); return false;
      }
    } };
  }
  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HongguoPlaybackSettings = api;
}(this));
