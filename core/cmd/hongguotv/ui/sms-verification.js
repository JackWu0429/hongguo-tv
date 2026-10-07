(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HongguoSMSVerification = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function create(options) {
    var now = options.now || Date.now, later = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
    var session = null, state = 'idle', generation = 0, request = null;
    var pollTimer = null, roundTimer = null, sessionTimer = null, roundDeadline = 0;
    function snapshot() { return { state: state, remaining: state === 'waiting' ? Math.max(0, Math.ceil((roundDeadline - now()) / 1000)) : 0 }; }
    function stop(next) {
      ++generation; clear(pollTimer); clear(roundTimer); pollTimer = roundTimer = null;
      var pending = request; request = null;
      state = next || 'ready'; roundDeadline = 0;
      if (pending && pending.abort) pending.abort();
      if (options.onState) options.onState(snapshot());
    }
    function expired() { return !session || now() >= session.expiresAt; }
    function setSession(value) {
      if (value && (!value.key || typeof value.expiresAt !== 'number' || !isFinite(value.expiresAt))) value = null;
      if (session && value && session.key === value.key && session.expiresAt === value.expiresAt) return;
      clear(sessionTimer); sessionTimer = null;
      session = value;
      stop(value ? expired() ? 'expired' : 'ready' : 'idle');
      if (value && !expired()) sessionTimer = later(function () { stop('expired'); }, Math.max(0, value.expiresAt - now()));
    }
    function start() {
      if (state === 'waiting') return false;
      if (expired()) { stop('expired'); return false; }
      stop('waiting');
      var epoch = generation;
      roundDeadline = now() + 90000;
      roundTimer = later(function () { if (epoch === generation) stop('timeout'); }, 90000);
      if (options.onState) options.onState(snapshot());
      function poll() {
        if (epoch !== generation) return;
        if (expired()) { stop('expired'); return; }
        if (now() >= roundDeadline) { stop('timeout'); return; }
        if (options.canPoll && !options.canPoll()) { stop('ready'); return; }
        try { request = options.request(); }
        catch (error) { stop('error'); return; }
        request.promise.then(function (result) {
          if (epoch !== generation) return;
          request = null;
          if (expired()) { stop('expired'); return; }
          if (result.confirmed) { stop('confirmed'); return; }
          if (result.error) { stop('error'); return; }
          if (!result.active) { stop('idle'); return; }
          pollTimer = later(poll, Math.min(3000, Math.max(0, roundDeadline - now())));
        }, function () { if (epoch === generation) { request = null; stop('error'); } });
      }
      poll(); return true;
    }
    return { setSession: setSession, start: start, stop: stop, snapshot: snapshot };
  }
  return { create: create };
}));
