'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var source = fs.readFileSync(path.join(__dirname, 'webos-adapter.js'), 'utf8');
var lunaCalls = [];
var listeners = {};
var documentListeners = {};
var fetchCalls = [];
var lunaOptions = [];
var failNextPingWithTimeout = false;
var healthPayload = { ok: true, ready: true, port: 7655 };
var healthFails = false;
var window = {
  Promise: Promise,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Request: function (url, options) { this.url = url; this.options = options; },
  fetch: function (input, options) {
    fetchCalls.push({ input: input, options: options });
    if (String(input).indexOf('/api/v1/health') >= 0) {
      return healthFails ? Promise.resolve({ ok: false, status: 503 }) : Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(healthPayload); } });
    }
    return Promise.resolve({ ok: true });
  },
  Element: { prototype: { setAttribute: function (name, value) { this[name] = value; } } },
  HTMLMediaElement: function () {},
  XMLHttpRequest: function () {},
  addEventListener: function (name, callback) { listeners[name] = callback; },
  webOS: { service: { request: function (uri, options) {
    lunaCalls.push(uri);
    lunaOptions.push(options);
    if (options.method === 'ping' && failNextPingWithTimeout) {
      failNextPingWithTimeout = false;
      setTimeout(function () { options.onFailure({ errorCode: 'LUNA_TIMEOUT', errorText: 'Luna 命令响应超时' }); }, 0);
      return {};
    }
    setTimeout(function () { options.onSuccess({ returnValue: true, ok: true, ready: true }); }, 0);
    return {};
  } } }
};
window.HTMLMediaElement.prototype = {};
window.HTMLMediaElement.prototype.setAttribute = function (name, value) { this[name] = value; };
Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
  configurable: true,
  get: function () { return this._src; },
  set: function (value) { this._src = value; }
});
window.XMLHttpRequest.prototype.open = function (method, url, async) {
  this.method = method;
  this.url = url;
  this.async = async;
  this.readyState = 1;
};
window.XMLHttpRequest.prototype.send = function (body) { this.body = body; this.sent = true; };
var document = {
  hidden: false,
  addEventListener: function (name, callback) { documentListeners[name] = callback; }
};

vm.runInNewContext(source, { window: window, document: document, Promise: Promise, Array: Array, Object: Object, String: String, JSON: JSON });

async function run() {
  var xhr = new window.XMLHttpRequest();
  xhr.open('GET', '/api/v1/status', true);
  assert.strictEqual(xhr.url, 'http://127.0.0.1:7655/api/v1/status');
  xhr.send();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(xhr.sent, true, 'XHR send waits for the service ping and then runs');
  assert(lunaCalls.indexOf('luna://com.aston314.hongguo.webos.service') >= 0);
  assert(lunaOptions.some(function (options) { return options.method === 'ping'; }), 'webOS service calls use the compatible method option');

  await window.fetch('/api/v1/lists/recommend');
  assert.strictEqual(fetchCalls[0].input, 'http://127.0.0.1:7655/api/v1/health', 'health is checked after Luna ping');
  assert.strictEqual(fetchCalls[1].input, 'http://127.0.0.1:7655/api/v1/lists/recommend');
  assert.strictEqual(window.HongguoWebOS.getDiagnostic().code, 'READY');

  failNextPingWithTimeout = true;
  documentListeners.visibilitychange();
  await window.HongguoWebOS.wakeService();
  assert.strictEqual(window.HongguoWebOS.getDiagnostic().code, 'READY', 'a timed-out cold-start ping is retried once before the service is marked unavailable');
  assert.strictEqual(lunaOptions.filter(function (options) { return options.method === 'ping'; }).length, 3, 'the delayed service is reached by the bounded retry');

  var lunaRequest = window.webOS.service.request;
  window.webOS.service.request = function (uri, options) {
    if (options.method === 'ping') setTimeout(function () { options.onSuccess({ returnValue: false, code: 'EADDRINUSE', stage: 'http_bind', message: 'port is occupied' }); }, 0);
    else lunaRequest(uri, options);
  };
  documentListeners.visibilitychange();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  await assert.rejects(window.HongguoWebOS.wakeService(), function (error) {
    return error.code === 'EADDRINUSE' && error.stage === 'http_bind';
  });
  assert.strictEqual(window.HongguoWebOS.getDiagnostic().code, 'EADDRINUSE');

  window.webOS.service.request = lunaRequest;
  healthFails = true;
  await assert.rejects(window.HongguoWebOS.wakeService(), function (error) {
    return error.code === 'HEALTH_HTTP_FAILED' && error.stage === 'http_health';
  });
  assert.strictEqual(window.HongguoWebOS.getDiagnostic().code, 'HEALTH_HTTP_FAILED');
  healthFails = false;

  document.hidden = true;
  documentListeners.visibilitychange();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(lunaCalls.indexOf('luna://com.aston314.hongguo.webos.service/shutdown'), -1, 'backgrounding keeps the local media service available');

  document.hidden = false;
  documentListeners.visibilitychange();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert(lunaOptions.filter(function (options) { return options.method === 'ping'; }).length >= 2);
  listeners.pagehide();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert(lunaOptions.some(function (options) { return options.method === 'shutdown'; }));
  console.log('webOS adapter routing, health checks, and error diagnostics: PASS');
}

run().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
