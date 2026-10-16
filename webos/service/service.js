(function () {
  'use strict';

  var http = require('http');
  var Service = require('webos-service');
  var SERVICE_ID = 'com.aston314.hongguo.webos.service';
  var DEFAULT_PORT = 7655;
  var server = null;
  var port = DEFAULT_PORT;
  var idleTimer = null;

  // webos-service's default idle timer is about five seconds. That is too
  // short for a media element making a burst of Range requests, so keep the
  // service alive until the app explicitly calls shutdown.
  var luna = new Service(SERVICE_ID, null, { idleTimer: 12 * 60 * 60 });

  function json(res, status, payload) {
    var body = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
  }

  function notImplemented(res, path) {
    json(res, 501, {
      ok: false,
      error: 'WEBOS_PROVIDER_NOT_IMPLEMENTED',
      message: 'webOS 实验版尚未接入红果签名与解密服务',
      path: path,
      experimental: true,
      playback_verified: false
    });
  }

  function statusPayload() {
    return {
      ok: true,
      service: 'hongguo-webos-service',
      implementation: 'experimental-js-service',
      platform: 'webos',
      port: port,
      capabilities: ['web-ui', 'luna-service', 'html5-video', 'local-media-proxy-boundary'],
      experimental: true,
      playback_verified: false
    };
  }

  function armIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    // A service must remain available while the HTML5 element is buffering.
    // This is deliberately long; later playback integration can replace it
    // with an active media lease and explicit shutdown.
    idleTimer = setTimeout(function () {}, 24 * 60 * 60 * 1000);
  }

  function handle(req, res) {
    armIdleTimer();
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    var url = String(req.url || '/').split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    if (url === '/api/v1/health') return json(res, 200, { ok: true });
    if (url === '/api/v1/status') return json(res, 200, statusPayload());
    if (url.indexOf('/api/') === 0 || url.indexOf('/minireel-proxy/media/') === 0 || url === '/minireel-proxy/resolve') return notImplemented(res, url);
    return json(res, 404, { ok: false, error: 'NOT_FOUND' });
  }

  function listen(nextPort) {
    port = nextPort;
    server = http.createServer(handle);
    server.on('error', function (error) {
      console.error('[hongguo-webos] HTTP server error', error && error.stack || error);
    });
    server.listen(port, '127.0.0.1', function () {
      console.log('[hongguo-webos] HTTP service listening on 127.0.0.1:' + port);
      armIdleTimer();
    });
  }

  luna.register('ping', function (message) {
    message.respond(Object.assign({ returnValue: true }, statusPayload()));
  });
  luna.register('getDiagnostics', function (message) {
    message.respond({ returnValue: true, status: statusPayload() });
  });
  luna.register('shutdown', function (message) {
    if (server) server.close();
    if (idleTimer) clearTimeout(idleTimer);
    message.respond({ returnValue: true });
  });

  process.on('uncaughtException', function (error) { console.error('[hongguo-webos] uncaughtException', error && error.stack || error); });
  process.on('unhandledRejection', function (error) { console.error('[hongguo-webos] unhandledRejection', error && error.stack || error); });
  listen(DEFAULT_PORT);
}());
