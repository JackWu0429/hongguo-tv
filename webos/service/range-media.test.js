'use strict';

var assert = require('assert');
var crypto = require('crypto');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');
var rangeMedia = require('./range-media');

var ETAG = '"range-fixture-v1"';

function mp4Box(type, payload) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  var result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, 'ascii');
  payload.copy(result, 8);
  return result;
}

function makeFixture() {
  var key = Buffer.from('29292929292929292929292929292929', 'hex');
  var iv = Buffer.from('0807060504030201', 'hex');
  var plain = Buffer.from('Range CENC decrypts only the requested sample fragments.');
  var counter = Buffer.alloc(16); iv.copy(counter);
  var cipher = crypto.createCipheriv('aes-128-ctr', key, counter);
  var encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  var ftyp = mp4Box('ftyp', Buffer.from([105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50]));

  function makeMoov(dataOffset) {
    var fullBox = Buffer.from([0, 0, 0, 0]);
    var stsdEntry = mp4Box('encv', Buffer.concat([Buffer.alloc(78), mp4Box('sinf', mp4Box('frma', Buffer.from('hvc1')))]));
    var stsd = mp4Box('stsd', Buffer.concat([fullBox, uint32(1), stsdEntry]));
    var stsc = mp4Box('stsc', Buffer.concat([fullBox, uint32(1), uint32(1), uint32(1), uint32(1)]));
    var stsz = mp4Box('stsz', Buffer.concat([fullBox, uint32(0), uint32(1), uint32(encrypted.length)]));
    var stco = mp4Box('stco', Buffer.concat([fullBox, uint32(1), uint32(dataOffset)]));
    var senc = mp4Box('senc', Buffer.concat([fullBox, uint32(1), iv]));
    var stbl = mp4Box('stbl', Buffer.concat([stsd, stsc, stsz, stco, senc]));
    return mp4Box('moov', mp4Box('trak', mp4Box('mdia', mp4Box('minf', stbl))));
  }

  var moov = makeMoov(0);
  moov = makeMoov(ftyp.length + moov.length + 8);
  var media = Buffer.concat([ftyp, moov, mp4Box('mdat', encrypted)]);
  return { bytes: media, key: key, plain: plain, sampleOffset: ftyp.length + moov.length + 8 };
}

function uint32(value) {
  var out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
}

function listen(server) {
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server.address().port); }); });
}

function close(server) {
  return new Promise(function (resolve) { server.close(resolve); });
}

function get(port, pathName, headers, method) {
  return new Promise(function (resolve, reject) {
    var requestHeaders = Object.assign({ Connection: 'close' }, headers || {});
    var request = http.request({ host: '127.0.0.1', port: port, path: pathName, method: method || 'GET', headers: requestHeaders }, function (response) {
      var chunks = [];
      response.on('data', function (chunk) { chunks.push(chunk); });
      response.on('end', function () { resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }); });
    });
    request.on('error', reject);
    request.end();
  });
}

async function testRangeCENCThroughRedirect() {
  var fixture = makeFixture();
  var seenRanges = [];
  var droppedSampleRange = false;
  var mediaServer = http.createServer(function (request, response) {
    var match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
    assert(match, 'upstream receives a byte range');
    var start = Number(match[1]);
    var end = Math.min(Number(match[2]), fixture.bytes.length - 1);
    seenRanges.push({ start: start, end: end, ifRange: request.headers['if-range'] || '' });
    response.statusCode = 206;
    response.setHeader('ETag', ETAG);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + fixture.bytes.length);
    response.setHeader('Content-Length', end - start + 1);
    if (!droppedSampleRange && start === fixture.sampleOffset + 7 && end === fixture.sampleOffset + 36) {
      droppedSampleRange = true;
      response.write(fixture.bytes.slice(start, start + 10));
      setTimeout(function () { response.connection.destroy(); }, 10);
      return;
    }
    response.end(fixture.bytes.slice(start, end + 1));
  });
  var mediaPort = await listen(mediaServer);
  var redirectServer = http.createServer(function (request, response) {
    assert(/^bytes=/.test(request.headers.range || ''), 'redirect request retains Range');
    response.statusCode = 302;
    response.setHeader('Location', 'http://127.0.0.1:' + mediaPort + '/media');
    response.end();
  });
  var redirectPort = await listen(redirectServer);
  try {
    var source = await rangeMedia.open('http://127.0.0.1:' + redirectPort + '/signed', fixture.key, { vid: '123', quality: '720P' });
    assert.strictEqual(source.etag, ETAG);
    assert.strictEqual(source.length, fixture.bytes.length);
    assert.strictEqual(source.samples.length, 1);
    assert(source.prefix.toString('ascii').indexOf('hvc1') >= 0, 'encrypted sample entry is patched in the memory prefix');
    assert(source.prefix.toString('ascii').indexOf('sinf') < 0, 'protection box is removed without moving media offsets');

    var lastStatus = 0;
    var local = http.createServer(function (request, response) {
      rangeMedia.serve(request, response, source, function (status) { lastStatus = status; });
    });
    var localPort = await listen(local);
    try {
      var sampleStart = source.samples[0].offset;
      var start = sampleStart + 7;
      var end = sampleStart + 36;
      var result = await get(localPort, '/media', { Range: 'bytes=' + start + '-' + end });
      assert.strictEqual(result.status, 206);
      assert.strictEqual(result.headers['content-range'], 'bytes ' + start + '-' + end + '/' + fixture.bytes.length);
      assert.strictEqual(result.body.toString(), fixture.plain.slice(7, 37).toString());
      assert.strictEqual(lastStatus, 206, 'diagnostics receive the actual partial response status');
      assert(seenRanges.some(function (range) { return range.start === start && range.ifRange === ETAG; }), 'upstream fetch is on demand and carries If-Range');
      assert(seenRanges.some(function (range) { return range.start === start + 10 && range.end === end; }), 'a broken response resumes from the first missing byte: ' + JSON.stringify(seenRanges));

      var head = await get(localPort, '/media', { Range: 'bytes=0-1' }, 'HEAD');
      assert.strictEqual(head.status, 206);
      assert.strictEqual(head.body.length, 0);

      var invalid = await get(localPort, '/media', { Range: 'bytes=0-1,5-6' });
      assert.strictEqual(invalid.status, 416);
      assert.strictEqual(invalid.headers['content-range'], 'bytes */' + fixture.bytes.length);
      assert.strictEqual(lastStatus, 416, 'diagnostics receive the actual invalid-range status');
    } finally { await close(local); }
  } finally {
    await close(redirectServer);
    await close(mediaServer);
  }
}

async function testFullDownloadRedirectFallbackHelper() {
  var fixture = makeFixture();
  var mediaServer = http.createServer(function (_, response) { response.statusCode = 200; response.end(fixture.bytes); });
  var mediaPort = await listen(mediaServer);
  var redirectServer = http.createServer(function (_, response) {
    response.statusCode = 302;
    response.setHeader('Location', 'http://127.0.0.1:' + mediaPort + '/full');
    response.end();
  });
  var redirectPort = await listen(redirectServer);
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-range-fallback-'));
  var destination = path.join(root, 'episode.part');
  try {
    await rangeMedia.downloadFile('http://127.0.0.1:' + redirectPort + '/signed', destination, { 'User-Agent': 'fixture-agent' }, 1024 * 1024);
    assert.deepStrictEqual(fs.readFileSync(destination), fixture.bytes);
  } finally {
    try { fs.unlinkSync(destination); } catch (ignored) {}
    fs.rmdirSync(root);
    await close(redirectServer);
    await close(mediaServer);
  }
}

async function run() {
  assert.deepStrictEqual(rangeMedia.parseByteRange('bytes=-3', 10), { start: 7, end: 9, partial: true });
  assert.strictEqual(rangeMedia.parseByteRange('bytes=1-2,5-6', 10), null);
  assert.deepStrictEqual(rangeMedia.parseContentRange('bytes 2-5/10'), { start: 2, end: 5, total: 10 });
  assert.strictEqual(rangeMedia.strongETag('W/"weak"'), false);
  await testRangeCENCThroughRedirect();
  await testFullDownloadRedirectFallbackHelper();
  console.log('webOS Range/CENC arbitrary-offset decrypt, redirect preservation and full-download fallback helper: PASS');
}

run().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
