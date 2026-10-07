(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HongguoNumericKeypad = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'done'];
  function create(options) {
    var active = false, kind = '', value = '', error = '', index = 0;
    function snapshot() { return { open: active, kind: kind, value: value, error: error, index: index, maxLength: kind === 'phone' ? 11 : 8 }; }
    function render() { if (options.render) options.render(snapshot()); }
    function open(field, initial) {
      if (active || (field !== 'phone' && field !== 'code')) return false;
      active = true; kind = field; value = String(initial || '').replace(/[^0-9]/g, '').slice(0, field === 'phone' ? 11 : 8); error = ''; index = 0;
      render(); return true;
    }
    function close(reason) {
      if (!active) return false;
      var result = { kind: kind, value: value, reason: reason || 'back' };
      active = false; kind = value = error = ''; index = 0; render();
      if (options.close) options.close(result);
      return true;
    }
    function choose(position) {
      if (!active || position < 0 || position >= keys.length) return;
      index = position; render();
    }
    function move(direction) {
      if (!active) return;
      var row = Math.floor(index / 3), column = index % 3;
      if (direction === 'left') column = Math.max(0, column - 1);
      if (direction === 'right') column = Math.min(2, column + 1);
      if (direction === 'up') row = Math.max(0, row - 1);
      if (direction === 'down') row = Math.min(3, row + 1);
      choose(row * 3 + column);
    }
    function press(key) {
      if (!active) return false;
      if (key === 'done') {
        var valid = kind === 'phone' ? /^1[3-9][0-9]{9}$/.test(value) : /^[0-9]{4,8}$/.test(value);
        if (!valid) { error = kind === 'phone' ? '请输入正确的11位手机号' : '请输入4至8位验证码'; render(); return true; }
        return close('complete');
      }
      if (key === 'delete') value = value.slice(0, -1);
      else if (/^[0-9]$/.test(key)) {
        if (value.length >= (kind === 'phone' ? 11 : 8)) { error = kind === 'phone' ? '手机号最多11位' : '验证码最多8位'; render(); return true; }
        value += key;
      } else return false;
      error = '';
      if (options.change) options.change(kind, value);
      render(); return true;
    }
    function handleKey(key, repeat) {
      if (!active) return false;
      var direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[key];
      if (direction) move(direction);
      else if (key === 'Enter') { if (!repeat) press(keys[index]); }
      else if (key === 'Escape') { if (!repeat) close('back'); }
      else if (key === 'Backspace' || key === 'Delete') press('delete');
      else if (/^[0-9]$/.test(key)) press(key);
      else if (key === 'Tab') choose((index + 1) % keys.length);
      // Other page shortcuts cannot escape this focus surface.
      return true;
    }
    return { open: open, close: close, move: move, choose: choose, press: press, handleKey: handleKey, snapshot: snapshot, isOpen: function () { return active; } };
  }
  return { create: create, keys: keys };
}));
