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
var window = {
  Promise: Promise,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Request: function (url, options) { this.url = url; this.options = options; },
  fetch: function (input, options) { fetchCalls.push({ input: input, options: options }); return Promise.resolve({ ok: true }); },
  Element: { prototype: { setAttribute: function (name, value) { this[name] = value; } } },
  HTMLMediaElement: function () {},
  XMLHttpRequest: function () {},
  addEventListener: function (name, callback) { listeners[name] = callback; },
  webOS: { service: { request: function (uri, options) {
    lunaCalls.push(uri);
    setTimeout(function () { options.onSuccess({ returnValue: true }); }, 0);
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
  assert(lunaCalls.indexOf('luna://com.aston314.hongguo.webos.service/ping') >= 0);

  await window.fetch('/api/v1/lists/recommend');
  assert.strictEqual(fetchCalls[0].input, 'http://127.0.0.1:7655/api/v1/lists/recommend');

  document.hidden = true;
  documentListeners.visibilitychange();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.strictEqual(lunaCalls.indexOf('luna://com.aston314.hongguo.webos.service/shutdown'), -1, 'backgrounding keeps the local media service available');

  document.hidden = false;
  documentListeners.visibilitychange();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert(lunaCalls.filter(function (uri) { return /\/ping$/.test(uri); }).length >= 2);
  listeners.pagehide();
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert(lunaCalls.indexOf('luna://com.aston314.hongguo.webos.service/shutdown') >= 0);
  console.log('webOS adapter service routing: PASS');
}

run().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
