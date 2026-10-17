'use strict';

var assert = require('assert');
var http = require('http');
var createService = require('./service');

var handlers = {};
var activityCalls = [];
var luna = {
  activityManager: {
    create: function (name, callback) { activityCalls.push('create:' + name); callback({ id: 'activity-1' }); },
    complete: function (activity, callback) { activityCalls.push('complete:' + activity.id); callback(); }
  },
  register: function (name, handler) { handlers[name] = handler; }
};
var provider = {
  recommend: function () { return Promise.resolve({ items: [{ series_id: '1' }] }); }
};
var service = createService({ service: luna, provider: provider, port: 0 });

function invoke(name) {
  return new Promise(function (resolve) {
    handlers[name]({ respond: resolve });
  });
}

function request(method, pathName, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: service.address().port, method: method, path: pathName, headers: headers || {} }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  var ping = await invoke('ping');
  assert.strictEqual(ping.returnValue, true);
  assert.strictEqual(ping.ok, true);
  assert.deepStrictEqual(activityCalls, ['create:hongguo-webos-http']);

  var status = await request('GET', '/api/v1/status', { Origin: 'null' });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(JSON.parse(status.body).ok, true);
  assert.strictEqual(status.headers['access-control-allow-origin'], 'null');

  var preflight = await request('OPTIONS', '/api/v1/library', {
    Origin: 'null',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type'
  });
  assert.strictEqual(preflight.status, 204);
  assert.strictEqual(preflight.headers['access-control-allow-origin'], 'null');
  assert(preflight.headers['access-control-allow-methods'].indexOf('POST') >= 0);
  assert.strictEqual(preflight.headers['access-control-allow-private-network'], 'true');

  var blockedOrigin = await request('GET', '/api/v1/status', { Origin: 'https://example.test' });
  assert.strictEqual(blockedOrigin.headers['access-control-allow-origin'], undefined, 'remote origins cannot read the local service');

  var recommendations = await request('GET', '/api/v1/lists/recommend?offset=0');
  assert.strictEqual(JSON.parse(recommendations.body).data.items[0].series_id, '1');

  var stopped = await invoke('shutdown');
  assert.strictEqual(stopped.returnValue, true);
  assert(activityCalls.indexOf('complete:activity-1') >= 0);
  console.log('webOS service lifecycle and CORS: PASS');
}

run().catch(function (error) {
  service.shutdown().then(function () { console.error(error.stack || error); process.exitCode = 1; });
});
