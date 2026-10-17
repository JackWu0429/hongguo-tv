(function (window, document) {
  'use strict';

  // The shared UI expects an application-local HTTP origin. A webOS web app
  // starts as file://, so keep the adapter small and expose one explicit
  // service boundary instead of changing product code for this platform.
  var SERVICE_BASE = 'http://127.0.0.1:7655';
  var SERVICE_URI = 'luna://com.aston314.hongguo.webos.service';
  var rawFetch = window.fetch;
  var xhrPrototype = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  var rawXHROpen = xhrPrototype && xhrPrototype.open;
  var rawXHRSend = xhrPrototype && xhrPrototype.send;
  var rawSetAttribute = window.Element && window.Element.prototype.setAttribute;
  var rawMediaSrc = window.HTMLMediaElement && Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'src');

  function serviceURL(value) {
    if (typeof value !== 'string') return value;
    if (/^https?:\/\//i.test(value) || /^data:/i.test(value) || /^blob:/i.test(value)) return value;
    if (value.indexOf('/api/') === 0 || value.indexOf('/minireel-proxy/') === 0 || value === '/health') {
      return SERVICE_BASE + value;
    }
    return value;
  }

  function inputURL(input) {
    if (typeof input === 'string') return serviceURL(input);
    if (input && typeof input.url === 'string') {
      try { return new window.Request(serviceURL(input.url), input); } catch (ignored) {}
    }
    return input;
  }

  function isServiceURL(value) {
    return typeof value === 'string' && value.indexOf(SERVICE_BASE) === 0;
  }

  window.HongguoWebOS = {
    platform: 'webos',
    serviceBase: SERVICE_BASE,
    experimental: true,
    playbackVerified: false,
    capabilities: ['web-ui', 'luna-service', 'html5-video', 'local-media-proxy-boundary']
  };

  // Prevent Android-only native-player code from trying to use a nonexistent
  // bridge. native-player.js will keep the HTML5 video element as its path.
  window.HongguoNativePlayer = {
    isAvailable: function () { return false; },
    engine: function () { return 'webos-html5'; },
    diagnostics: function () { return JSON.stringify({ platform: 'webos', experimental: true, playback_verified: false }); }
  };
  window.HongguoTVUpdates = {
    getStatus: function () { return JSON.stringify({ supported: false, state: 'unsupported', message: 'webOS 实验版暂未接入在线更新' }); },
    check: function () {},
    download: function () {}
  };

  var serviceWake = null;
  function requestService(method, complete) {
    var finished = false;
    var timer;
    function done(response) {
      if (finished) return;
      finished = true;
      if (timer) window.clearTimeout(timer);
      complete(response);
    }
    try {
      if (window.webOS && window.webOS.service && window.webOS.service.request) {
        window.webOS.service.request(SERVICE_URI + '/' + method, {
          parameters: {},
          onSuccess: done,
          onFailure: function () { done(null); }
        });
        timer = window.setTimeout(function () { done(null); }, 5000);
        return;
      }
      if (window.PalmServiceBridge) {
        var bridge = new window.PalmServiceBridge();
        bridge.onservicecallback = function (response) {
          try { done(JSON.parse(response)); } catch (ignoredJSON) { done(null); }
        };
        bridge.call(SERVICE_URI + '/' + method, '{}');
        timer = window.setTimeout(function () { done(null); }, 5000);
        return;
      }
    } catch (ignored) {}
    done(null);
  }

  function wakeService() {
    if (serviceWake) return serviceWake;
    serviceWake = new Promise(function (resolve) {
      requestService('ping', function (response) { resolve(response); });
    });
    serviceWake.then(function () {
      window.setTimeout(function () { serviceWake = null; }, 1000);
    }, function () { serviceWake = null; });
    return serviceWake;
  }

  function releaseService() {
    serviceWake = null;
    requestService('shutdown', function () {});
  }

  window.HongguoWebOS.wakeService = wakeService;
  wakeService();

  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        serviceWake = null;
        wakeService();
      }
    });
  }
  window.addEventListener('pagehide', releaseService);

  if (rawXHROpen && rawXHRSend) {
    xhrPrototype.open = function (method, target) {
      var args = Array.prototype.slice.call(arguments);
      var rewritten = serviceURL(target);
      args[1] = rewritten;
      this.__hongguoWebOSServiceURL = isServiceURL(rewritten);
      return rawXHROpen.apply(this, args);
    };
    xhrPrototype.send = function () {
      var xhr = this;
      var args = arguments;
      if (!xhr.__hongguoWebOSServiceURL) return rawXHRSend.apply(xhr, args);
      return wakeService().then(function () {
        if (xhr.readyState === 1) rawXHRSend.apply(xhr, args);
      });
    };
  }

  if (typeof rawFetch === 'function') {
    window.fetch = function (input, options) {
      var rewritten = inputURL(input);
      var target = typeof rewritten === 'string' ? rewritten : rewritten && rewritten.url;
      if (isServiceURL(target)) {
        return wakeService().then(function () { return rawFetch.call(window, rewritten, options); });
      }
      return rawFetch.call(window, rewritten, options);
    };
  }

  // HTMLMediaElement.src is the one path that does not use fetch. Rewrite only
  // the local media proxy, leaving poster images and external URLs untouched.
  if (rawMediaSrc && rawMediaSrc.set) {
    try {
      Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
        configurable: true,
        enumerable: rawMediaSrc.enumerable,
        get: rawMediaSrc.get,
        set: function (value) { rawMediaSrc.set.call(this, serviceURL(value)); }
      });
    } catch (ignoredMediaSrc) {}
  }
  if (rawSetAttribute && window.HTMLMediaElement) {
    try {
      window.HTMLMediaElement.prototype.setAttribute = function (name, value) {
        rawSetAttribute.call(this, name, name.toLowerCase() === 'src' ? serviceURL(String(value)) : value);
      };
    } catch (ignoredAttribute) {}
  }

  window.addEventListener('error', function (event) {
    if (window.console && console.warn && event && event.message) console.warn('[hongguo-webos]', event.message);
  });
}(window, document));
