'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var sign = require('./passport-sign');
var vector = JSON.parse(fs.readFileSync(path.join(__dirname, '../../core/cmd/hongguotv/testdata/passport-vectors.json'), 'utf8'));
var body = Buffer.from(vector.body);
var branch = sign.branch(vector.query, body, vector.ts);
assert.strictEqual(branch.iv, vector.iv);
assert.strictEqual(branch.q.toString('hex'), vector.sm3);
assert.strictEqual(sign.passportF13(branch.iv, vector.ts, branch.q, branch.m).toString('hex'), vector.f13);
assert.strictEqual(sign.passportProto(vector.query, vector.ts, 0x12345678, '7000000000000000001', branch.q, branch.m, Buffer.from(vector.f13, 'hex')).toString('hex'), vector.proto);
assert.strictEqual(sign.helios(vector.ts, 0x12345678), vector.helios);
assert.strictEqual(sign.gorgon(vector.query, body, vector.ts, 0x4567), vector.gorgon);
vector.aes_v3.forEach(function (expected, index) {
  var data = Buffer.alloc(256);
  for (var i = 0; i < data.length; i++) data[i] = i;
  assert.strictEqual(sign.aesV3(data, vector.ts + index).toString('hex'), expected);
});
console.log('webOS Passport signature vectors: PASS');
