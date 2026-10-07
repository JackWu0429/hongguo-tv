(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HongguoNumberInput = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function create(options) {
    var generation = 0, active = false, session = '', kind = '', timer = null, expires = 0;
    var schedule = options.schedule || setTimeout, unschedule = options.unschedule || clearTimeout, now = options.now || Date.now;
    function cancel(id) { if (id) options.request('DELETE', id).catch(function () {}); }
    function stop() {
      ++generation; active = false; unschedule(timer); timer = null;
      cancel(session); session = kind = ''; expires = 0;
      options.render({ state: 'closed' });
    }
    function start(field) {
      stop(); active = true; kind = field;
      var current = generation, failures = 0;
      options.render({ state: 'creating' });
      function fail(message) {
        if (!active || current !== generation) return;
        options.render({ state: 'unavailable', message: message || '扫码暂不可用，可使用左侧数字键盘' });
        cancel(session); session = ''; active = false;
      }
      function poll() {
        if (!active || current !== generation) return;
        if (now() >= expires) { fail('二维码已过期，可重新打开输入框或使用左侧键盘'); return; }
        options.request('GET', session).then(function (data) {
          if (!active || current !== generation) return;
          failures = 0;
          if (data.state === 'completed') {
            if (data.kind !== kind || typeof data.value !== 'string' || !(kind === 'phone' ? /^1[3-9][0-9]{9}$/.test(data.value) : /^[0-9]{4,8}$/.test(data.value))) { fail(); return; }
            var fieldKind = kind;
            stop(); options.complete(fieldKind, data.value); return;
          }
          if (data.state !== 'waiting') { fail('二维码已失效，可重新打开输入框或使用左侧键盘'); return; }
          timer = schedule(poll, 900);
        }).catch(function () {
          if (!active || current !== generation) return;
          if (++failures >= 3) fail(); else timer = schedule(poll, 900);
        });
      }
      options.request('POST', '', field).then(function (data) {
        // A create response may arrive after Back, completion or a new field.
        if (!active || current !== generation) { cancel(data.session); return; }
        if (!data.session || data.kind !== field || data.state !== 'waiting' || !data.qr || !(data.expires_in > 0)) { cancel(data.session); fail(); return; }
        session = data.session; expires = now() + Math.min(300, data.expires_in) * 1000;
        options.render({ state: 'waiting', qr: data.qr });
        timer = schedule(poll, 900);
      }).catch(function () { fail(); });
    }
    return { start: start, stop: stop };
  }
  return { create: create };
}));
