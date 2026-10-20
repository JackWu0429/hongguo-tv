'use strict';

var os = require('os');
var path = require('path');

function privateIPv4(value) {
  var match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(value || ''));
  if (!match) return false;
  var parts = match.slice(1).map(Number);
  if (parts.some(function (part) { return part < 0 || part > 255; })) return false;
  return parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168;
}

var host = process.env.HONGGUO_WEBOS_BIND_HOST || '';
var port = Number(process.env.HONGGUO_WEBOS_PORT || 17659);
if (!privateIPv4(host)) {
  process.stderr.write('Set HONGGUO_WEBOS_BIND_HOST to a private IPv4 address on this machine.\n');
  process.exit(2);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  process.stderr.write('HONGGUO_WEBOS_PORT must be between 1024 and 65535.\n');
  process.exit(2);
}

var serviceID = 'com.aston314.hongguo.webos.http-direct';
process.env.HONGGUO_WEBOS_SERVICE_ID = serviceID;
process.env.HONGGUO_WEBOS_DATA_DIR = process.env.HONGGUO_WEBOS_DATA_DIR || path.join(os.tmpdir(), 'hongguo-webos-http-direct-' + port, 'data');
process.env.HONGGUO_WEBOS_CACHE_DIR = process.env.HONGGUO_WEBOS_CACHE_DIR || path.join(os.tmpdir(), 'hongguo-webos-http-direct-' + port, 'media-cache');

var createService = require('../webos/service/service');
var service = createService({
  serviceID: serviceID,
  port: port,
  bindHost: host,
  service: { register: function () {} }
});

service.ensureReady().then(function () {
  process.stdout.write('HTTP-direct Service ready at http://' + host + ':' + port + '\n');
}, function (error) {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});

function shutdown() {
  service.shutdown().then(function () { process.exit(0); }, function () { process.exit(1); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
