'use strict';

var assert = require('assert');
var http = require('http');
var createNumberInput = require('./number-input');

function request(method, target, headers, body) {
  return new Promise(function (resolve, reject) {
    var options = Object.assign({}, target, { method: method, headers: headers || {} });
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
  var manager = createNumberInput({ selectIP: function () { return '127.0.0.1'; }, ttl: 30000 });
  try {
    for (var i = 0; i < 4; i++) {
      var kinds = ['search', 'danmaku', 'phone', 'code'];
      var values = ['红果短剧', '弹幕文本', '13800138000', '012345'];
      var kind = kinds[i], value = values[i];
      var started = await manager.start(kind, '+86');
      assert.strictEqual(started.kind, kind);
      assert.strictEqual(started.state, 'waiting');
      assert.strictEqual(started.expires_in, 30);
      assert(/^data:image\/svg\+xml;base64,/.test(started.qr), 'QR must be locally rendered SVG data');
      var session = manager._active();
      assert(session && session.id === started.session);
      var requestTarget = { host: '127.0.0.1', port: Number(session.host.split(':')[1]), path: '/input/' + started.session };
      var opened = await request('GET', requestTarget, { Host: session.host });
      assert.strictEqual(opened.status, 200);
      assert(opened.body.indexOf('手机和电视需在同一局域网') >= 0);
      assert.strictEqual(opened.headers['cache-control'], 'no-store');
      var key = session.formKey;
      var submitted = await request('POST', requestTarget, {
        Host: session.host,
        'Content-Type': 'application/x-www-form-urlencoded'
      }, require('querystring').stringify({ form_key: key, value: value }));
      assert.strictEqual(submitted.status, 200);
      assert(submitted.body.indexOf('已发送到电视') >= 0);
      assert.strictEqual(session.value, value);
      var consumed = manager.poll(started.session, false);
      assert.deepStrictEqual(consumed, { state: 'completed', kind: kind, value: value });
      assert.deepStrictEqual(manager.poll(started.session, false), { state: 'expired' });
      assert.strictEqual(manager._active(), null);
    }

    var invalid = await manager.start('phone', '+86');
    var invalidSession = manager._active();
    var invalidTarget = { host: '127.0.0.1', port: Number(invalidSession.host.split(':')[1]), path: '/input/' + invalid.session };
    var invalidResponse = await request('POST', invalidTarget, { Host: invalidSession.host, 'Content-Type': 'application/x-www-form-urlencoded' }, require('querystring').stringify({ form_key: invalidSession.formKey, value: '123' }));
    assert.strictEqual(invalidResponse.status, 400);
    assert.strictEqual(manager.poll(invalid.session, false).state, 'waiting');
    assert.strictEqual(manager.poll(invalid.session, true).state, 'expired');

    var international = await manager.start('phone', '+81');
    assert.strictEqual(international.kind, 'phone');
    assert.strictEqual(manager.poll(international.session, true).state, 'expired');
    await assert.rejects(manager.start('phone', '+999'), /暂不支持/);
    await assert.rejects(manager.start('unknown'), /输入会话不可用/);
  } finally {
    manager.close();
  }
  console.log('webOS phone-assisted input session and QR: PASS');
}

run().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
