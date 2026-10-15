(function (root) {
  'use strict';

  // Keep automatic recovery deliberately small. A player error must not turn
  // into an unbounded source/player restart loop on a TV.
  function create(options) {
    options = options || {};
    var maximum = Math.max(0, Number(options.maxAttempts) || 1);
    var attempts = 0;
    var refreshed = false;
    return {
      reset: function () { attempts = 0; refreshed = false; },
      next: function (context) {
        context = context || {};
        if (context.native === 'mpv') return 'stop';
        if (!refreshed && attempts < maximum) {
          attempts++;
          refreshed = true;
          return 'refresh';
        }
        return 'stop';
      },
      attempts: function () { return attempts; }
    };
  }

  root.HongguoPlaybackRecovery = { create: create };
  if (typeof module === 'object' && module.exports) module.exports = root.HongguoPlaybackRecovery;
})(typeof window !== 'undefined' ? window : globalThis);
