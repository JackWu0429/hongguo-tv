(function (window, document) {
  'use strict';

  // The shared UI expects an application-local HTTP origin. A webOS web app
  // starts as file://, so keep the adapter small and expose one explicit
  // service boundary instead of changing product code for this platform.
  var SERVICE_BASE = 'http://127.0.0.1:7655';
  var SERVICE_URI = 'luna://com.aston314.hongguo.webos.service';
  var LUNA_REQUEST_TIMEOUT_MS = 8000;
  var LUNA_TIMEOUT_RETRIES = 1;
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
    appVersion: '',
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
  var serviceRequests = [];
  function retainServiceRequest(request) {
    if (request && serviceRequests.indexOf(request) < 0) serviceRequests.push(request);
    return request;
  }
  function releaseServiceRequest(request) {
    var index = serviceRequests.indexOf(request);
    if (index >= 0) serviceRequests.splice(index, 1);
  }
  var serviceDiagnostic = { stage: 'not_checked', code: 'NOT_CHECKED', message: '本机服务尚未检查', port: 7655 };
  function diagnosticError(stage, code, message) {
    var error = new Error(String(message || code || '本机服务连接失败'));
    error.stage = stage;
    error.code = code;
    serviceDiagnostic = { stage: stage, code: code, message: error.message, port: 7655, timestamp: Date.now() };
    return error;
  }
  function checkHealth() {
    if (typeof rawFetch !== 'function') return Promise.reject(diagnosticError('http_health', 'FETCH_UNAVAILABLE', '当前 WebView 不支持 fetch，无法检查本机服务'));
    return rawFetch.call(window, SERVICE_BASE + '/api/v1/health', { method: 'GET', cache: 'no-store' }).then(function (response) {
      if (!response || !response.ok) throw diagnosticError('http_health', 'HEALTH_HTTP_FAILED', 'HTTP 健康检查失败，状态码 ' + (response && response.status || 0));
      return response.json().then(function (payload) {
        if (!payload || payload.ok !== true || payload.ready !== true) throw diagnosticError('http_health', 'HEALTH_NOT_READY', '本机服务 HTTP 健康检查未就绪');
        serviceDiagnostic = { stage: 'ready', code: 'READY', message: 'Luna ping 与 HTTP 健康检查均成功', port: payload.port || 7655, timestamp: Date.now() };
        return payload;
      }, function () { throw diagnosticError('http_health', 'HEALTH_INVALID_JSON', '本机服务健康检查响应不是有效 JSON'); });
    }, function (error) {
      if (error && error.stage) throw error;
      throw diagnosticError('http_health', 'HEALTH_UNREACHABLE', error && error.message || '无法连接 127.0.0.1:7655');
    });
  }
  function requestService(method, complete) {
    var finished = false;
    var timer;
    var requestHandle = null;
    function done(response, failure) {
      if (finished) return;
      finished = true;
      if (timer) window.clearTimeout(timer);
      releaseServiceRequest(requestHandle);
      complete(response, failure || null);
    }
    try {
      if (window.webOS && window.webOS.service && window.webOS.service.request) {
        // The base URI + method option is the documented form and works on
        // older webOSTV.js versions where the extended /method URI times out.
        requestHandle = retainServiceRequest(window.webOS.service.request(SERVICE_URI, {
          method: method,
          parameters: {},
          onSuccess: done,
          onFailure: function (error) { done(null, error || { errorCode: 'LUNA_REQUEST_FAILED' }); }
        }));
        timer = window.setTimeout(function () { done(null, { errorCode: 'LUNA_TIMEOUT', errorText: 'Luna 命令响应超时' }); }, LUNA_REQUEST_TIMEOUT_MS);
        return;
      }
      if (window.PalmServiceBridge) {
        var bridge = new window.PalmServiceBridge();
        bridge.onservicecallback = function (response) {
          try {
            var parsed = JSON.parse(response);
            done(parsed, parsed && parsed.returnValue === false ? parsed : null);
          } catch (ignoredJSON) { done(null, { errorCode: 'LUNA_INVALID_RESPONSE', errorText: 'Luna 返回了无效响应' }); }
        };
        bridge.call(SERVICE_URI + '/' + method, '{}');
        timer = window.setTimeout(function () { done(null, { errorCode: 'LUNA_TIMEOUT', errorText: 'Luna 命令响应超时' }); }, LUNA_REQUEST_TIMEOUT_MS);
        return;
      }
    } catch (error) { done(null, { errorCode: 'LUNA_REQUEST_EXCEPTION', errorText: error && error.message || String(error) }); return; }
    done(null, { errorCode: 'LUNA_API_UNAVAILABLE', errorText: '未找到 webOS Luna Service 调用接口' });
  }

  function wakeService() {
    if (serviceWake) return serviceWake;
    serviceWake = new Promise(function (resolve, reject) {
      var attempt = 0;
      function ping() {
        attempt += 1;
        requestService('ping', function (response, failure) {
          if (failure || !response || response.returnValue !== true || response.ready !== true) {
            var code = failure && (failure.error || failure.errorCode || failure.code) || response && (response.error || response.code) || 'LUNA_NOT_READY';
            var message = failure && (failure.message || failure.errorText) || response && (response.message || response.errorText) || 'Luna ping 未返回 ready=true';
            if (String(code) === 'LUNA_TIMEOUT' && attempt <= LUNA_TIMEOUT_RETRIES) {
              window.setTimeout(ping, 300);
              return;
            }
            reject(diagnosticError(response && response.stage || 'luna_ping', String(code), String(message)));
            return;
          }
          checkHealth().then(resolve, reject);
        });
      }
      ping();
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
  window.HongguoWebOS.getDiagnostics = function () { return JSON.stringify(serviceDiagnostic); };
  window.HongguoWebOS.getDiagnostic = function () { return Object.assign({}, serviceDiagnostic); };
  wakeService().catch(function () {});

  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        serviceWake = null;
        wakeService().catch(function () {});
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
      }, function () {
        // Send the original request so XHR callers receive their normal network
        // error event; the Luna/health failure remains available in diagnostics.
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
