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
  recommend: function () { return Promise.resolve({ items: [{ series_id: '1' }] }); },
  discussion: function () { return Promise.resolve({ items: [], has_more: false, total: 0 }); },
  replies: function () { return Promise.resolve({ items: [], has_more: false, total: 0 }); },
  mediaDiagnostics: function () { return { media_prepared: false, media_state: 'none' }; },
  library: function () { return { version: 1, entries: [], owner_id: '' }; },
  changeLibrary: function () { return { version: 1, entries: [], owner_id: '' }; },
  searchHistory: function () { return { items: [], limit: 10 }; }
};
var accountStatus = { logged_in: false, profile: null, app_code_available: false };
var account = {
  status: function () { return accountStatus; },
  librarySnapshot: function () { return { version: 1, entries: [], owner_id: accountStatus.logged_in ? '123' : '' }; },
  changeLibrary: function () { return { version: 1, entries: [], owner_id: '123' }; },
  sendCode: function () { accountStatus.app_code_available = true; var error = new Error('设备注册连接失败，请稍后重试'); error.status = 400; error.code = 'ACCOUNT_DEVICE'; throw error; },
  loginSMS: function () { return Promise.resolve(accountStatus); },
  verify: function () { return Promise.resolve(accountStatus); },
  cancel: function () { return accountStatus; },
  logout: function () { return accountStatus; },
  sync: function () { return Promise.resolve(accountStatus); },
  importHistory: function () { return Promise.resolve({ status: accountStatus, import_history: { imported: 2, remaining: 1 } }); },
  reservations: function () { var error = new Error('请先登录'); error.status = 401; error.code = 'ACCOUNT_REQUIRED'; return Promise.reject(error); },
  follow: function () { var error = new Error('请先登录'); error.status = 401; error.code = 'ACCOUNT_REQUIRED'; return Promise.reject(error); },
  reserve: function () { return Promise.resolve({ accepted: true, confirmed: false }); },
  notifications: function () { var error = new Error('请先登录'); error.status = 401; error.code = 'ACCOUNT_REQUIRED'; return Promise.reject(error); },
  markNotifications: function () { var error = new Error('请先登录'); error.status = 401; error.code = 'ACCOUNT_REQUIRED'; throw error; }
};
var service = createService({ service: luna, provider: provider, account: account, port: 0 });
var registry = require('./services.json');

function invoke(name) {
  return new Promise(function (resolve) {
    handlers[name]({ respond: resolve });
  });
}

function request(method, pathName, headers, body) {
  return new Promise(function (resolve, reject) {
    var options = { host: '127.0.0.1', port: service.address().port, method: method, path: pathName, headers: Object.assign({}, headers || {}) };
    if (body) { options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(body); }
    var req = http.request(options, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  var registeredCommands = registry.services[0].commands;
  ['ping', 'getDiagnostics', 'shutdown'].forEach(function (name) {
    var command = registeredCommands.filter(function (entry) { return entry.name === name; })[0];
    assert(command, name + ' is declared in services.json');
    assert.strictEqual(command.public, true, name + ' is public to the app');
  });

  var ping = await invoke('ping');
  assert.strictEqual(ping.returnValue, true);
  assert.strictEqual(ping.ok, true);
  assert.strictEqual(ping.ready, true);
  assert.deepStrictEqual(activityCalls, ['create:hongguo-webos-http']);

  var status = await request('GET', '/api/v1/status', { Origin: 'null' });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(JSON.parse(status.body).ok, true);
  assert.strictEqual(JSON.parse(status.body).ready, true);
  assert.strictEqual(status.headers['access-control-allow-origin'], 'null');

  var preflight = await request('OPTIONS', '/api/v1/library', {
    Origin: 'null',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type'
  });
  assert.strictEqual(preflight.status, 204);
  assert.strictEqual(preflight.headers['access-control-allow-origin'], 'null');
  assert(preflight.headers['access-control-allow-methods'].indexOf('POST') >= 0);
  assert(preflight.headers['access-control-allow-methods'].indexOf('DELETE') >= 0);
  assert.strictEqual(preflight.headers['access-control-allow-private-network'], 'true');

  var blockedOrigin = await request('GET', '/api/v1/status', { Origin: 'https://example.test' });
  assert.strictEqual(blockedOrigin.headers['access-control-allow-origin'], undefined, 'remote origins cannot read the local service');

  var recommendations = await request('GET', '/api/v1/lists/recommend?offset=0');
  assert.strictEqual(JSON.parse(recommendations.body).data.items[0].series_id, '1');

  var comments = await request('GET', '/api/v1/comments?series_id=1&vid=2');
  assert.strictEqual(comments.status, 200);
  assert.strictEqual(JSON.parse(comments.body).data.total, 0);
  var replies = await request('GET', '/api/v1/replies?series_id=1&vid=2&comment_id=3');
  assert.strictEqual(replies.status, 200);
  var playerDiagnostics = await request('GET', '/api/v1/player/diagnostics?media=%2Fminireel-proxy%2Fmedia%2Faaaaaaaaaaaaaaaaaaaaaaaa.mp4');
  assert.strictEqual(playerDiagnostics.status, 200);
  assert.strictEqual(JSON.parse(playerDiagnostics.body).data.media_state, 'none');

  var library = await request('GET', '/api/v1/library');
  assert.strictEqual(JSON.parse(library.body).data.owner_id, '');
  var staleLibrary = await request('POST', '/api/v1/library', {}, JSON.stringify({ owner_id: 'stale-user', action: 'clear', kind: 'history' }));
  assert.strictEqual(staleLibrary.status, 409);
  var sendCode = await request('POST', '/api/v1/account/send-code', {}, JSON.stringify({ country_code: '+86', phone: '13800138000' }));
  var sendCodePayload = JSON.parse(sendCode.body);
  assert.strictEqual(sendCode.status, 400);
  assert.strictEqual(sendCodePayload.data.app_code_available, true);
  assert.strictEqual(sendCodePayload.message, '设备注册连接失败，请稍后重试');
  var importHistory = await request('POST', '/api/v1/account/import-history', {}, JSON.stringify({ owner_id: '123' }));
  assert.deepStrictEqual(JSON.parse(importHistory.body).import_history, { imported: 2, remaining: 1 });
  var reservation = await request('POST', '/api/v1/reservation', {}, JSON.stringify({ item_id: '1234567890123456789', reserved: true }));
  assert.deepStrictEqual(JSON.parse(reservation.body).data, { accepted: true, confirmed: false });
  var numberInput = await request('POST', '/api/v1/number-input', {}, JSON.stringify({ kind: 'search' }));
  assert.strictEqual(numberInput.status, 503);
  assert(JSON.parse(numberInput.body).message.indexOf('数字键盘') >= 0);
  var loggedOutReservations = await request('GET', '/api/v1/lists/reservations');
  assert.strictEqual(loggedOutReservations.status, 401);

  var diagnostics = await request('GET', '/api/v1/diagnostics');
  assert.strictEqual(JSON.parse(diagnostics.body).ready, true);
  assert.strictEqual(JSON.parse(diagnostics.body).lastStartupError, null);

  var stopped = await invoke('shutdown');
  assert.strictEqual(stopped.returnValue, true);
  assert(activityCalls.indexOf('complete:activity-1') >= 0);

  var occupied = require('net').createServer();
  await new Promise(function (resolve) { occupied.listen(0, '127.0.0.1', resolve); });
  var blockedHandlers = {};
  var blockedService = createService({
    service: {
      activityManager: { create: function (_, callback) { callback(null); }, complete: function (_, callback) { callback(); } },
      register: function (name, handler) { blockedHandlers[name] = handler; }
    },
    provider: provider,
    account: account,
    port: occupied.address().port
  });
  var blocked = await new Promise(function (resolve) { blockedHandlers.ping({ respond: resolve }); });
  assert.strictEqual(blocked.returnValue, false);
  assert.strictEqual(blocked.ready, false);
  assert.strictEqual(blocked.stage, 'http_bind');
  assert.strictEqual(blocked.code, 'EADDRINUSE');
  await blockedService.shutdown();
  await new Promise(function (resolve) { occupied.close(resolve); });
  console.log('webOS service lifecycle and CORS: PASS');
}

run().catch(function (error) {
  service.shutdown().then(function () { console.error(error.stack || error); process.exitCode = 1; });
});
