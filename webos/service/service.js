(function () {
  'use strict';

  var SERVICE_ID = 'com.aston314.hongguo.webos.service';
  var DEFAULT_PORT = 7655;

  function createService(options) {
    options = options || {};
    var http = options.http || require('http');
    var url = options.url || require('url');
    var provider = options.provider || require('./provider');
    var port = options.port === undefined ? DEFAULT_PORT : options.port;
    var server = null;
    var serverStart = null;
    var activity = null;
    var activityStart = null;
    var lastStartupError = null;
    var luna = options.service;
    if (!luna) {
      var Service = options.Service || require('webos-service');
      luna = new Service(SERVICE_ID);
    }

    function cors(res, origin) {
      if (origin === 'null' || origin === 'http://127.0.0.1:' + port) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Vary', 'Origin, Access-Control-Request-Private-Network');
    }

    function json(res, status, payload, req) {
      var body = JSON.stringify(payload);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      cors(res, req && req.headers && req.headers.origin);
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(body);
    }

    function notImplemented(req, res, path) {
      json(res, 501, {
        ok: false,
        error: 'WEBOS_PROVIDER_NOT_IMPLEMENTED',
        message: 'webOS 实验版尚未接入红果签名与解密服务',
        path: path,
        experimental: true,
        playback_verified: false
      }, req);
    }

    function statusPayload() {
      return {
        ok: true,
        ready: !!(server && server.listening),
        service: 'hongguo-webos-service',
        implementation: 'experimental-js-service',
        platform: 'webos',
        port: port,
        capabilities: ['web-ui', 'luna-service', 'html5-video', 'real-video-model-signing', 'cenc-aes-ctr', 'local-media-cache', 'range-media-proxy', 'category', 'rank', 'search', 'series-detail'],
        experimental: true,
        playback_verified: false,
        protocol_verified: true,
        verification_note: '红果请求签名、地址解析、CENC 解密和本地媒体 Range 已通过网络/文件验证；LG 真机播放尚未验证'
      };
    }

    function errorPayload(error, stage) {
      var code = error && error.code ? String(error.code) : 'SERVICE_START_FAILED';
      var message = String(error && error.message || error || '本机服务启动失败');
      var details = {
        ok: false,
        ready: false,
        error: code,
        code: code,
        stage: stage || error && error.stage || 'service_start',
        message: message,
        port: port,
        service: 'hongguo-webos-service'
      };
      lastStartupError = details;
      return details;
    }

    function query(req) { return url.parse(String(req.url || '/'), true).query || {}; }
    function data(req, res, payload) { json(res, 200, { ok: true, data: payload }, req); }
    function failure(req, res, error) {
      console.error('[hongguo-webos] provider error:', error && error.stack || error);
      json(res, 502, { ok: false, error: String(error && error.message || error || '上游请求失败'), playback_verified: false }, req);
    }
    function supportedMethod(req) { return req.method === 'GET' || req.method === 'HEAD'; }

    function handleProvider(req, res, pathName) {
      var q = query(req);
      if (!supportedMethod(req)) return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, req);
      if (pathName.indexOf('/minireel-proxy/media/') === 0) {
        return provider.serveMedia(req, res, pathName.slice('/minireel-proxy/media/'.length).replace(/\.mp4$/, ''));
      }
      if (pathName === '/minireel-proxy/resolve' || pathName === '/api/v1/play/info') {
        var seriesID = String(q.series_id || ''), vid = String(q.vid || '');
        return provider.prepare(seriesID, vid, String(q.quality || ''), String(q.fallback || '') === '1').then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      if (pathName === '/api/v1/category') {
        return provider.category(String(q.path || '/category/real-drama'), Number(q.offset || 0), q, String(q.selectors || '') === '1').then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      if (pathName === '/api/v1/lists/recommend') {
        return provider.recommend(Number(q.offset || 0)).then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      if (pathName === '/api/v1/lists/new') {
        return provider.category('/new/short-drama', Number(q.offset || 0), q, false).then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      if (pathName === '/api/v1/lists/rank') {
        var rankPath = String(q.path || '/rank/hot-drama');
        if (rankPath.indexOf('/rank/') !== 0) rankPath = '/rank/hot-drama';
        return provider.rank(rankPath).then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      if (pathName === '/api/v1/lists/search') {
        return provider.search(String(q.q || '')).then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      if (pathName === '/api/v1/series/detail') {
        return provider.detail(String(q.series_id || '')).then(function (result) { data(req, res, result); }, function (error) { failure(req, res, error); });
      }
      return notImplemented(req, res, pathName);
    }

    function handle(req, res) {
      if (req.method === 'OPTIONS') {
        cors(res, req.headers && req.headers.origin);
        res.statusCode = 204;
        return res.end();
      }
      var pathName = String(req.url || '/').split('?')[0];
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, req);
      if (pathName === '/api/v1/health') return json(res, 200, { ok: true, ready: !!(server && server.listening), service: 'hongguo-webos-service', port: port }, req);
      if (pathName === '/api/v1/diagnostics') return json(res, 200, { ok: true, ready: !!(server && server.listening), port: port, lastStartupError: lastStartupError }, req);
      if (pathName === '/api/v1/status') return json(res, 200, statusPayload(), req);
      if (pathName.indexOf('/api/') === 0 || pathName.indexOf('/minireel-proxy/media/') === 0 || pathName === '/minireel-proxy/resolve') return handleProvider(req, res, pathName);
      return json(res, 404, { ok: false, error: 'NOT_FOUND' }, req);
    }

    function ensureActivity() {
      var manager = luna.activityManager;
      if (activity) return Promise.resolve(activity);
      if (activityStart) return activityStart;
      if (!manager || typeof manager.create !== 'function') {
        if (manager) manager.idleTimeout = 12 * 60 * 60;
        return Promise.resolve(null);
      }
      activityStart = new Promise(function (resolve) {
        var finished = false;
        var timer = setTimeout(function () {
          if (finished) return;
          finished = true;
          activityStart = null;
          manager.idleTimeout = 12 * 60 * 60;
          resolve(null);
        }, 5000);
        try {
          manager.create('hongguo-webos-http', function (value) {
            if (finished) { activity = value || activity; return; }
            finished = true;
            clearTimeout(timer);
            activity = value || null;
            resolve(activity);
          });
        } catch (error) {
          clearTimeout(timer);
          finished = true;
          activityStart = null;
          manager.idleTimeout = 12 * 60 * 60;
          console.error('[hongguo-webos] activity create failed:', error && error.stack || error);
          resolve(null);
        }
      }).then(function (value) {
        if (value) activityStart = null;
        return value;
      });
      return activityStart;
    }

    function ensureServer() {
      if (server && server.listening) return Promise.resolve(server);
      if (serverStart) return serverStart;
      server = http.createServer(handle);
      serverStart = new Promise(function (resolve, reject) {
        function onError(error) {
          error.stage = 'http_bind';
          server.removeListener('listening', onListening);
          server = null;
          serverStart = null;
          reject(error);
        }
        function onListening() {
          server.removeListener('error', onError);
          if (server.address() && server.address().port) port = server.address().port;
          console.log('[hongguo-webos] HTTP service listening on 127.0.0.1:' + port);
          resolve(server);
        }
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      }).then(function (value) {
        serverStart = null;
        return value;
      }, function (error) {
        serverStart = null;
        if (server && !server.listening) server = null;
        console.error('[hongguo-webos] HTTP server error', error && error.stack || error);
        throw error;
      });
      return serverStart;
    }

    function ensureReady() {
      return Promise.all([ensureActivity(), ensureServer()]);
    }

    function completeActivity() {
      var manager = luna.activityManager;
      var previous = activity;
      activity = null;
      activityStart = null;
      if (!previous || !manager || typeof manager.complete !== 'function') return Promise.resolve();
      return new Promise(function (resolve) {
        var finished = false;
        var timer = setTimeout(function () { if (!finished) { finished = true; resolve(); } }, 3000);
        try {
          manager.complete(previous, function () {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve();
          });
        } catch (error) {
          clearTimeout(timer);
          console.error('[hongguo-webos] activity complete failed:', error && error.stack || error);
          resolve();
        }
      });
    }

    function stopServer() {
      if (!server || !server.listening) { server = null; return Promise.resolve(); }
      var previous = server;
      server = null;
      return new Promise(function (resolve) {
        previous.close(function (error) {
          if (error) console.error('[hongguo-webos] HTTP server close failed:', error.message || error);
          resolve();
        });
      });
    }

    function respondWhenReady(message, includeStatus) {
      ensureReady().then(function () {
        var status = statusPayload();
        message.respond(Object.assign({ returnValue: true }, includeStatus ? { status: status } : status));
      }, function (error) {
        console.error('[hongguo-webos] service startup failed:', error && error.stack || error);
        var details = errorPayload(error, error && error.stage);
        message.respond(Object.assign({ returnValue: false }, details));
      });
    }

    luna.register('ping', function (message) { respondWhenReady(message, false); });
    luna.register('getDiagnostics', function (message) { respondWhenReady(message, true); });
    luna.register('shutdown', function (message) {
      stopServer().then(completeActivity).then(function () { message.respond({ returnValue: true }); });
    });

    return { ensureReady: ensureReady, status: statusPayload, address: function () { return server && server.address(); }, shutdown: function () { return stopServer().then(completeActivity); } };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = createService;
  if (typeof require !== 'undefined' && require.main === module) {
    process.on('uncaughtException', function (error) { console.error('[hongguo-webos] uncaughtException', error && error.stack || error); });
    process.on('unhandledRejection', function (error) { console.error('[hongguo-webos] unhandledRejection', error && error.stack || error); });
    createService();
  }
}());
