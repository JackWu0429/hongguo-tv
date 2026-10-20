'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var outputPath = process.argv[2];
var port = Number(process.argv[3] || 17656);
if (!outputPath || !Number.isInteger(port) || port < 1024 || port > 65535) {
  process.stderr.write('usage: node webos_simulator_report_server.js OUTPUT.json [PORT]\n');
  process.exit(2);
}

function cors(req, res) {
  var origin = req.headers.origin || '';
  if (origin === 'null' || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

var server = http.createServer(function (req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/report') {
    res.statusCode = 404;
    res.end();
    return;
  }
  var chunks = [];
  var size = 0;
  req.on('data', function (chunk) {
    size += chunk.length;
    if (size > 128 * 1024) {
      res.statusCode = 413;
      res.end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', function () {
    if (res.writableEnded) return;
    var body = Buffer.concat(chunks).toString('utf8');
    if (/https?:\/\//i.test(body)) {
      res.statusCode = 400;
      res.end('report must not contain playback URLs');
      return;
    }
    var report;
    try { report = JSON.parse(body); } catch (error) {
      res.statusCode = 400;
      res.end('invalid JSON');
      return;
    }
    if (!report || report.platform !== 'webOS TV 26 Simulator' || report.redacted !== true) {
      res.statusCode = 400;
      res.end('unexpected report identity');
      return;
    }
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      var temporary = outputPath + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, outputPath);
    } catch (error) {
      res.statusCode = 500;
      res.end('failed to save report');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
});

server.listen(port, '127.0.0.1', function () {
  process.stdout.write('webOS Simulator report receiver listening on 127.0.0.1:' + port + '\n');
});

process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
