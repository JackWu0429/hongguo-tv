(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HongguoEpisodeWheel = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var PIXEL_THRESHOLD = 60;
  var GESTURE_IDLE_MS = 280;
  var SWITCH_COOLDOWN_MS = 750;
  var EXCLUDED_ROLES = { dialog: true, button: true, menu: true, listbox: true, combobox: true };
  var EXCLUDED_CLASSES = /(^|\s)(modal|dialog|popup|player-options|diagnostic-scroll|discussion-scroll)(\s|$)/;

  function excludedTarget(target, surface) {
    for (var node = target; node && node !== surface; node = node.parentElement) {
      var tag = String(node.tagName || '').toUpperCase();
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'A') return true;
      if (node.isContentEditable) return true;
      if (node.getAttribute) {
        if (node.getAttribute('aria-modal') === 'true' || node.getAttribute('data-wheel-pass-through') !== null) return true;
        if (EXCLUDED_ROLES[node.getAttribute('role')]) return true;
      }
      if (EXCLUDED_CLASSES.test(String(node.className || ''))) return true;
    }
    return false;
  }

  function attach(surface, options) {
    if (!surface || !surface.addEventListener) return function () {};
    options = options || {};
    var lastEventAt = null;
    var lastSwitchAt = -Infinity;
    var accumulated = 0;
    var direction = 0;
    var consumed = false;

    function resetGesture() {
      accumulated = 0;
      direction = 0;
      consumed = false;
    }

    function onWheel(event) {
      if (event.defaultPrevented || options.isEnabled && !options.isEnabled() ||
          event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
          event.deltaMode === 2 || excludedTarget(event.target, surface)) return;

      var now = Number(event.timeStamp);
      if (!isFinite(now)) now = Date.now();
      if (lastEventAt === null || now - lastEventAt > GESTURE_IDLE_MS) resetGesture();
      lastEventAt = now;

      event.preventDefault();
      if (consumed) return;

      var sign = event.deltaY > 0 ? 1 : -1;
      var delta = event.deltaMode === 1 ? sign : event.deltaY;
      if (direction && sign !== direction) accumulated = delta;
      else accumulated += delta;
      direction = sign;

      var threshold = event.deltaMode === 1 ? 1 : PIXEL_THRESHOLD;
      if (Math.abs(accumulated) < threshold) return;

      consumed = true;
      if (now - lastSwitchAt < SWITCH_COOLDOWN_MS) return;
      lastSwitchAt = now;
      if (options.onStep) options.onStep(sign);
    }

    surface.addEventListener('wheel', onWheel, false);
    return function () { surface.removeEventListener('wheel', onWheel, false); };
  }

  return { attach: attach };
}));
