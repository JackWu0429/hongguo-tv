// First-party webOS provider. This is a clean JavaScript port of the
// protocol already implemented in the Go core; it does not vendor the GPL
// provider from another webOS project.
(function () {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var crypto = require('crypto');
  var http = require('http');
  var https = require('https');
  var url = require('url');
  var querystring = require('querystring');
  var passportSign = require('./passport-sign');

  var API_BASE = 'https://api5-normal-sinfonlineb.fqnovel.com';
  var WEB_BASE = 'https://hongguoduanju.com';
  var API_PATH = '/novel/player/video_model/v1/';
  var APP_UA = 'com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)';
  var MAX_JSON = 5 * 1024 * 1024;
  var MAX_MEDIA = 512 * 1024 * 1024;
  var jobs = Object.create(null);
  var cacheRoot = '';

  function fail(message) { var error = new Error(message); error.code = 'PROVIDER_ERROR'; return error; }
  function trim(value) { return String(value == null ? '' : value).replace(/^\s+|\s+$/g, ''); }
  function validID(value) { return /^[0-9]{1,32}$/.test(trim(value)); }
  function first() { var i; for (i = 0; i < arguments.length; i++) { if (trim(arguments[i])) return trim(arguments[i]); } return ''; }
  function number(value) { var n = Number(value); return isFinite(n) ? n : 0; }
  function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
  function stringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (item) {
      if (item && typeof item === 'object') item = first(item.name, item.title, item.content);
      return trim(item);
    }).filter(Boolean);
  }

  function requestBuffer(target, method, headers, body, limit) {
    return new Promise(function (resolve, reject) {
      var parsed = url.parse(target);
      var transport = parsed.protocol === 'http:' ? http : https;
      var options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.path,
        method: method || 'GET',
        headers: headers || {},
        timeout: 90000
      };
      var request;
      try { request = transport.request(options); } catch (error) { reject(error); return; }
      request.on('timeout', function () { request.destroy(fail('上游请求超时')); });
      request.on('error', reject);
      request.on('response', function (response) {
        var chunks = [];
        var total = 0;
        response.on('data', function (chunk) {
          total += chunk.length;
          if (limit && total > limit) {
            request.destroy(fail('上游响应超过大小限制'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', function () {
          resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
        });
      });
      if (body) request.write(body);
      request.end();
    });
  }

  function jsonRequest(target, method, body) {
    var raw = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    var headers = {
      'User-Agent': APP_UA,
      Accept: 'application/json',
      'Accept-Encoding': 'identity'
    };
    if (raw) { headers['Content-Type'] = 'application/json; charset=utf-8'; headers['Content-Length'] = raw.length; }
    return requestBuffer(target, method || 'GET', headers, raw, MAX_JSON).then(function (response) {
      if (response.status < 200 || response.status >= 300) throw fail('红果接口 HTTP ' + response.status);
      var text = response.body.toString('utf8');
      if (!trim(text)) throw fail('红果接口返回空响应');
      try { return JSON.parse(text); } catch (error) { throw fail('红果接口响应不是有效 JSON'); }
    });
  }

  function sortedQuery(values) {
    var keys = Object.keys(values).sort();
    var out = [];
    keys.forEach(function (key) { out.push(querystring.escape(key) + '=' + querystring.escape(String(values[key]))); });
    return out.join('&');
  }

  function appQuery(device) {
    return {
      _rticket: String(Date.now()), ac: 'wifi', aid: '8662', app_name: 'novelread', channel: 'update_64',
      device_brand: 'Redmi', device_id: device.deviceID, device_platform: 'android', device_type: '25053RT47C',
      dpi: '520', iid: device.installID, language: 'zh', manifest_version_code: '73532', os: 'android',
      os_api: '36', os_version: '16', resolution: '1280*2772', ssmix: 'a', update_version_code: '73532',
      version_code: '73532', version_name: '7.3.5.32'
    };
  }

  function randomID() {
    var bytes = crypto.randomBytes(16);
    var text = '';
    var i;
    for (i = 0; i < bytes.length; i++) text += String(bytes[i] % 10);
    return '1' + text.slice(1, 16);
  }
  function freshDevice() { return { deviceID: randomID(), installID: randomID() }; }
  function reverseBits(value) {
    var out = 0, i;
    for (i = 0; i < 8; i++) out |= ((value >> i) & 1) << (7 - i);
    return out;
  }
  function rotateNibble(value) { return ((value << 4) | (value >> 4)) & 255; }

  function miniSign(query, body, stamp) {
    var queryDigest = crypto.createHash('md5').update(query).digest();
    var bodyDigest = crypto.createHash('md5').update(body || '').digest();
    var payload = Buffer.alloc(20);
    queryDigest.copy(payload, 0, 0, 4);
    bodyDigest.copy(payload, 4, 0, 4);
    payload[12] = 0; payload[13] = 6; payload[14] = 11; payload[15] = 28;
    payload.writeUInt32BE(Math.floor(stamp / 1000), 16);
    var mask = Buffer.from('44b9b9d9a4aef9fca493aa757ca3c2c4a496938f', 'hex');
    var i;
    for (i = 0; i < 20; i++) payload[i] ^= mask[i];
    for (i = 0; i < 20; i++) payload[i] = reverseBits(rotateNibble(payload[i]) ^ payload[(i + 1) % 20]) ^ 0xff ^ 20;
    return {
      'X-Khronos': String(Math.floor(stamp / 1000)),
      'X-Gorgon': '8404401c0000' + payload.toString('hex'),
      'X-SS-STUB': bodyDigest.toString('hex').toUpperCase(),
      'X-SS-Req-Ticket': String(stamp)
    };
  }

  function bitCount(value) { var count = 0; while (value) { count++; value &= value - 1; } return count; }
  function base36(value) {
    if (value >= 48 && value <= 57) return value - 48;
    if (value >= 97 && value <= 122) return value - 97 + 10;
    if (value >= 65 && value <= 90) return value - 65 + 10;
    return -1;
  }
  function decodeSpade(value) {
    var raw;
    try { raw = Buffer.from(value, 'base64'); } catch (error) { raw = Buffer.alloc(0); }
    if (!raw.length) { try { raw = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch (ignored) {} }
    if (raw.length < 3 || raw.length > 1024) throw fail('spade_a 无效');
    var tagLength = (raw[0] ^ raw[1] ^ raw[2]) - 48;
    var length = raw.length - tagLength - 1;
    if (tagLength < 1 || length < 33 || length >= raw.length) throw fail('spade_a 结构无效');
    var seed = raw[raw.length - tagLength - 2] ^ raw[raw.length - tagLength - 1];
    var tag = Buffer.alloc(tagLength);
    var i;
    for (i = 0; i < tagLength; i++) tag[i] = raw[raw.length - tagLength + i] ^ seed;
    if (tag.toString() === 'app_v2' || tag.toString() === 'web_v2') throw fail('spade_a 格式不支持');
    var decoded = Buffer.alloc(length);
    var previous = [250, 85];
    for (i = 0; i < length; i++) {
      var current = raw[i + 1];
      decoded[i] = (previous[i % 2] ^ current) - 21 - bitCount(i) & 255;
      previous[i % 2] = current;
    }
    var keyLength = base36(decoded[0]);
    if (keyLength < 0 || keyLength >= 36 || length - keyLength - 1 !== 32) throw fail('spade_a 密钥载荷无效');
    var keyText = decoded.slice(1, 33).toString();
    if (!/^[0-9a-fA-F]{32}$/.test(keyText)) throw fail('CENC 密钥无效');
    return Buffer.from(keyText, 'hex');
  }

  function decodeModel(value) {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (ignored) {}
    }
    return value;
  }
  function modelString(value) { if (typeof value === 'string') return trim(value); if (value == null) return ''; return String(value); }
  function modelRows(value) { return Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []); }

  function videoOptions(vid) {
    var attempt = 0;
    function next() {
      attempt++;
      var device = freshDevice();
      var stamp = Date.now();
      var params = appQuery(device);
      params._rticket = String(stamp);
      var query = sortedQuery(params);
      var body = JSON.stringify({ video_id: String(vid), content_type: 1, biz_param: { need_all_video_definition: true, video_platform: 3 } });
      var signed = passportSign.sign(params, Buffer.from(body), stamp, device.deviceID);
      query = signed.query;
      var headers = signed.headers;
      headers['User-Agent'] = APP_UA;
      headers.Accept = 'application/json';
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['X-XS-From-Web'] = '0'; headers['Sdk-Version'] = '2'; headers['X-SS-DP'] = '8662';
      headers['X-Tt-Store-Region'] = 'cn'; headers['X-Tt-Store-Region-Src'] = 'did';
      return requestBuffer(API_BASE + API_PATH + '?' + query, 'POST', headers, Buffer.from(body), MAX_JSON).then(function (response) {
        if (response.status < 200 || response.status >= 300) throw fail('video_model HTTP ' + response.status);
        if (!response.body.length) { if (attempt < 3) return next(); throw fail('video_model 返回空响应'); }
        var envelope;
        try { envelope = JSON.parse(response.body.toString('utf8')); } catch (error) { throw fail('video_model 响应不是有效 JSON'); }
        var data = envelope && envelope.data;
        var model = decodeModel(data && data.video_model);
        if (!model || typeof model !== 'object') throw fail('video_model 缺少视频数据');
        var options = [];
        modelRows(model.video_list).forEach(function (row) {
          var meta = row && row.video_meta || {};
          var encryption = row && row.encrypt_info || {};
          if (String(meta.codec_type || '').toLowerCase() === 'bytevc2') return;
          var raw = modelString(row && row.main_url);
          var mediaURL = raw;
          if (!/^https?:\/\//i.test(mediaURL)) {
            try { mediaURL = Buffer.from(raw, 'base64').toString(); } catch (ignored) {}
          }
          if (!/^https:\/\//i.test(mediaURL)) return;
          var key = null;
          if (modelString(encryption.spade_a)) {
            try { key = decodeSpade(modelString(encryption.spade_a)); } catch (ignoredKey) { return; }
          }
          var height = number(meta.vheight);
          var definition = modelString(meta.definition).match(/(\d{3,4})/);
          if (definition) height = Number(definition[1]);
          options.push({ url: mediaURL, key: key, height: height, quality: height > 0 ? String(height) + 'P' : '', duration: number(model.video_duration) });
        });
        if (!options.length) throw fail('video_model 没有可播放清晰度');
        return options;
      }).catch(function (error) {
        if (attempt < 3 && /空响应/.test(String(error.message || error))) return next();
        throw error;
      });
    }
    return next();
  }

  function choose(options, quality, fallback) {
    var requested = String(quality || '').toUpperCase();
    if (requested && requested !== 'AUTO') {
      for (var i = 0; i < options.length; i++) if (options[i].quality === requested) return options[i];
      if (!fallback) throw fail('本集不提供 ' + requested);
    }
    var candidates = options.filter(function (option) { return option.height > 0 && option.height <= 720; });
    if (!candidates.length) candidates = options.slice();
    return candidates.sort(function (a, b) { return a.height - b.height; })[candidates.length - 1];
  }

  function mediaToken(seriesID, vid, quality, fallback) {
    var suffix = quality ? ':' + quality + ':' + String(!!fallback) : '';
    return crypto.createHash('sha256').update(String(seriesID) + ':' + String(vid) + suffix).digest('hex').slice(0, 24);
  }
  function ensureCacheRoot() {
    if (cacheRoot) return cacheRoot;
    var candidates = [];
    if (process.env.HONGGUO_WEBOS_CACHE_DIR) candidates.push(process.env.HONGGUO_WEBOS_CACHE_DIR);
    candidates.push('/var/palm/data/com.aston314.hongguo.webos.service/media');
    candidates.push(path.join(process.cwd(), 'media-cache'));
    for (var i = 0; i < candidates.length; i++) {
      try { fs.mkdirSync(candidates[i], { recursive: true, mode: 448 }); cacheRoot = candidates[i]; return cacheRoot; } catch (ignored) {}
    }
    throw fail('webOS 媒体缓存目录不可写');
  }
  function fileExists(file) { try { return fs.statSync(file).isFile(); } catch (ignored) { return false; } }

  function downloadFile(target, destination) {
    return new Promise(function (resolve, reject) {
      var parsed = url.parse(target);
      var transport = parsed.protocol === 'http:' ? http : https;
      var request = transport.get({ hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443), path: parsed.path, headers: { 'User-Agent': APP_UA, Accept: '*/*', 'Accept-Encoding': 'identity', Referer: 'https://novel.snssdk.com/', Origin: 'https://novel.snssdk.com' }, timeout: 90000 }, function (response) {
        if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(fail('媒体源 HTTP ' + response.statusCode)); return; }
        var output = fs.createWriteStream(destination, { mode: 384 });
        var total = 0;
        response.on('data', function (chunk) { total += chunk.length; if (total > MAX_MEDIA) request.destroy(fail('媒体超过大小限制')); });
        output.on('error', reject);
        response.on('error', reject);
        output.on('finish', function () { output.close(); resolve(); });
        response.pipe(output);
      });
      request.on('error', reject);
      request.on('timeout', function () { request.destroy(fail('媒体下载超时')); });
    });
  }

  function readU32(buffer, offset) { return buffer.readUInt32BE(offset); }
  function readU64(buffer, offset) { var high = buffer.readUInt32BE(offset); var low = buffer.readUInt32BE(offset + 4); return high * 4294967296 + low; }
  function box(buffer, offset, limit) {
    if (offset + 8 > limit) return null;
    var size = readU32(buffer, offset); var header = 8;
    if (size === 1) { if (offset + 16 > limit) return null; size = readU64(buffer, offset + 8); header = 16; }
    if (size === 0) size = limit - offset;
    if (size < header || offset + size > limit) return null;
    return { start: offset, size: size, header: header, type: buffer.toString('ascii', offset + 4, offset + 8), payload: offset + header, end: offset + size };
  }
  function boxes(buffer, start, end) { var out = []; for (var at = start; at < end;) { var item = box(buffer, at, end); if (!item) return null; out.push(item); at += item.size; } return out; }
  function child(buffer, parent, type) { var list = boxes(buffer, parent.payload, parent.end) || []; for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i]; return null; }
  function pathBox(buffer, parent, names) { var current = parent; for (var i = 0; i < names.length; i++) { current = child(buffer, current, names[i]); if (!current) return null; } return current; }
  function allChildren(buffer, parent) { return boxes(buffer, parent.payload, parent.end) || []; }

  function trackSamples(buffer, stbl, senc) {
    var stsc = child(buffer, stbl, 'stsc'), stsz = child(buffer, stbl, 'stsz'), stco = child(buffer, stbl, 'stco') || child(buffer, stbl, 'co64');
    if (!stsc || !stsz || !stco) throw fail('CENC MP4 缺少样本表');
    var p = stco.payload + 4, count = readU32(buffer, p), offsets = [], wide = stco.type === 'co64'; p += 4;
    for (var i = 0; i < count; i++) { offsets.push(wide ? readU64(buffer, p) : readU32(buffer, p)); p += wide ? 8 : 4; }
    p = stsz.payload + 4; var constant = readU32(buffer, p), sizesCount = readU32(buffer, p + 4); p += 8; var sizes = [];
    for (i = 0; i < sizesCount; i++) { sizes.push(constant || readU32(buffer, p)); if (!constant) p += 4; }
    p = stsc.payload + 8; var entryCount = readU32(buffer, stsc.payload + 4), entries = [];
    for (i = 0; i < entryCount; i++) { entries.push({ first: readU32(buffer, p), perChunk: readU32(buffer, p + 4) }); p += 12; }
    var positions = [], sample = 0;
    for (var chunk = 1; chunk <= offsets.length && sample < sizes.length; chunk++) {
      var entry = entries[entries.length - 1];
      for (i = 0; i < entries.length; i++) if (entries[i].first <= chunk) entry = entries[i];
      var at = offsets[chunk - 1];
      for (var n = 0; n < entry.perChunk && sample < sizes.length; n++) { positions.push(at); at += sizes[sample++]; }
    }
    if (sample !== sizes.length) throw fail('CENC MP4 样本数量不一致');
    p = senc.payload; var flags = readU32(buffer, p) & 0xffffff; var sencCount = readU32(buffer, p + 4); p += 8;
    if (sencCount !== sizes.length) throw fail('CENC MP4 IV 数量不一致');
    var ivSize = (senc.end - p === sencCount * 16) ? 16 : 8; var ivs = [];
    for (i = 0; i < sencCount; i++) { ivs.push(buffer.slice(p, p + ivSize)); p += ivSize; if (flags & 2) throw fail('暂不支持带 subsample 的 CENC MP4'); }
    return sizes.map(function (size, index) { return { offset: positions[index], size: size, iv: ivs[index] }; });
  }

  function zeroProtection(buffer, entry) {
    var header = entry.type === 'encv' ? 78 : 28;
    var list = boxes(buffer, entry.payload + header, entry.end) || [];
    list.forEach(function (item) { if (item.type === 'sinf') { buffer.write('free', item.start + 4, 4, 'ascii'); buffer.fill(0, item.payload, item.end); } });
  }
  function originalFormat(buffer, entry) {
    var list = boxes(buffer, entry.payload + 78, entry.end) || [];
    var sinf = list.filter(function (x) { return x.type === 'sinf'; })[0];
    if (!sinf) return 'hvc1';
    var frma = child(buffer, sinf, 'frma');
    return frma && frma.payload + 4 <= frma.end ? buffer.toString('ascii', frma.payload, frma.payload + 4) : 'hvc1';
  }
  function decryptMP4(file, key) {
    var buffer = fs.readFileSync(file);
    var root = boxes(buffer, 0, buffer.length) || [];
    var moov = root.filter(function (x) { return x.type === 'moov'; })[0];
    if (!moov) throw fail('MP4 缺少 moov');
    var tracks = allChildren(buffer, moov); var decrypted = 0;
    tracks.forEach(function (trak) {
      if (trak.type !== 'trak') return;
      var stbl = pathBox(buffer, trak, ['mdia', 'minf', 'stbl']); if (!stbl) return;
      var senc = child(buffer, stbl, 'senc'); if (!senc) return;
      var samples = trackSamples(buffer, stbl, senc);
      var stsd = child(buffer, stbl, 'stsd');
      samples.forEach(function (sample) {
        if (sample.offset < 0 || sample.offset + sample.size > buffer.length) throw fail('MP4 样本越界');
        var iv = Buffer.alloc(16); sample.iv.copy(iv, 0);
        var decipher = crypto.createDecipheriv('aes-128-ctr', key, iv); decipher.setAutoPadding(false);
        var plain = Buffer.concat([decipher.update(buffer.slice(sample.offset, sample.offset + sample.size)), decipher.final()]);
        plain.copy(buffer, sample.offset);
      });
      if (stsd) {
        var entries = allChildren(buffer, { payload: stsd.payload + 8, end: stsd.end });
        entries.forEach(function (entry) {
          if (entry.type === 'encv') { buffer.write(originalFormat(buffer, entry), entry.start + 4, 4, 'ascii'); zeroProtection(buffer, entry); }
          if (entry.type === 'enca') { buffer.write('mp4a', entry.start + 4, 4, 'ascii'); zeroProtection(buffer, entry); }
        });
      }
      decrypted++;
    });
    if (!decrypted) throw fail('MP4 没有可解密的 senc 轨道');
    fs.writeFileSync(file, buffer, { mode: 384 });
  }

  function prepare(seriesID, vid, quality, fallback) {
    if (!validID(seriesID) || !validID(vid)) return Promise.reject(fail('播放参数无效'));
    var token = mediaToken(seriesID, vid, quality, fallback); var root = ensureCacheRoot(); var dir = path.join(root, token); var file = path.join(dir, token + '.mp4');
    if (fileExists(file)) return Promise.resolve({ path: '/minireel-proxy/media/' + token + '.mp4', quality: quality || '', qualities: [], vid: vid, mode: 'full' });
    if (jobs[token]) return jobs[token];
    jobs[token] = videoOptions(vid).then(function (options) {
      var selected = choose(options, quality, fallback);
      fs.mkdirSync(dir, { recursive: true, mode: 448 });
      var temp = file + '.part';
      return downloadFile(selected.url, temp).then(function () {
        if (selected.key) decryptMP4(temp, selected.key);
        fs.renameSync(temp, file);
        return { path: '/minireel-proxy/media/' + token + '.mp4', quality: selected.quality, qualities: options.map(function (x) { return x.quality; }).filter(Boolean), vid: vid, mode: 'full' };
      }).catch(function (error) {
        try { fs.unlinkSync(temp); } catch (ignored) {}
        try { fs.rmdirSync(dir); } catch (ignoredDir) {}
        throw error;
      });
    }).then(function (result) { delete jobs[token]; return result; }, function (error) { delete jobs[token]; throw error; });
    return jobs[token];
  }

  function serveMedia(req, res, token) {
    if (!/^[a-f0-9]{24}$/.test(token)) return jsonResponse(res, 400, { ok: false, error: '媒体标识无效' });
    var file = path.join(ensureCacheRoot(), token, token + '.mp4');
    var stat;
    try { stat = fs.statSync(file); } catch (error) { return jsonResponse(res, 404, { ok: false, error: '媒体尚未准备好' }); }
    var start = 0; var end = stat.size - 1; var range = req.headers.range;
    if (range) {
      var match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) { if (match[1]) start = Number(match[1]); if (match[2]) end = Number(match[2]); else end = stat.size - 1; }
    }
    if (start < 0 || start >= stat.size || end < start) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + stat.size); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.statusCode = range ? 206 : 200;
    res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', end - start + 1); res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range'); res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (range) res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start: start, end: end }).pipe(res);
  }

  function jsonResponse(res, status, payload) { var body = JSON.stringify(payload); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS'); res.end(body); }
  function fetchHTML(target) { return requestBuffer(target, 'GET', { 'User-Agent': 'Googlebot', Accept: 'text/html' }, null, 12 * 1024 * 1024).then(function (response) { if (response.status < 200 || response.status >= 300) throw fail('官网 HTTP ' + response.status); return response.body.toString('utf8'); }); }
  function routerData(html) { var marker = html.indexOf('_ROUTER_DATA'); if (marker < 0) throw fail('页面缺少 _ROUTER_DATA'); var start = html.indexOf('{', marker); if (start < 0) throw fail('页面数据起点无效'); var depth = 0, string = false, escaped = false, end = start; for (; end < html.length; end++) { var c = html.charAt(end); if (string) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') string = false; continue; } if (c === '"') string = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (!depth) break; } } try { return JSON.parse(html.slice(start, end + 1)); } catch (error) { throw fail('页面数据解析失败'); } }
  function findObject(value, key) { if (!value || typeof value !== 'object') return null; if (!Array.isArray(value) && value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) return value[key]; var keys = Object.keys(value); for (var i = 0; i < keys.length; i++) { var found = findObject(value[keys[i]], key); if (found) return found; } return null; }
  function findArray(value, key) { if (!value || typeof value !== 'object') return null; if (!Array.isArray(value) && Array.isArray(value[key])) return value[key]; var keys = Object.keys(value); for (var i = 0; i < keys.length; i++) { var found = findArray(value[keys[i]], key); if (found) return found; } return null; }
  function normalize(value) {
    if (!value || typeof value !== 'object') return null;
    var object = value.video_data && typeof value.video_data === 'object' ? value.video_data : value;
    var id = first(object.series_id_str, object.series_id, object.seriesId, object.book_id, object.id);
    if (!id) return null;
    var vids = stringArray(object.vid_list); if (!vids.length) vids = stringArray(object.episodeVids);
    var episodeCount = number(first(object.episode_cnt, object.episode_total_cnt)) || vids.length;
    return { series_id: id, title: first(object.series_title, object.series_name, object.title, '未命名短剧'), cover: first(object.series_cover, object.cover, object.cover_url), intro: first(object.series_intro, object.video_desc, object.description), score: first(object.score, object.rating, object.scoreText).replace(/^评分/, ''), play_count: number(object.play_cnt), episode_count: episodeCount, accessible_episode_cnt: number(object.accessible_episode_cnt) || episodeCount, vid: first(object.vid, object.video_id, vids[0]), vid_list: vids, tags: stringArray(object.tags), rank: number(object.rank), heat: first(object.heatText), season_index: number(object.season_index), is_multi_season: bool(object.is_multi_season), followed: bool(object.followed) || bool(object.is_subscribed), following_update: bool(object.following_update), follow_count: number(object.follow_count), series_status: first(object.series_status, object.status) };
  }
  function normalizeRows(rows) { var seen = {}; return (rows || []).map(normalize).filter(function (item) { if (!item || seen[item.series_id]) return false; seen[item.series_id] = true; return true; }); }

  function category(pathName, offset, filters, selectors) {
    var device = freshDevice(); var selection = { genre: [pathName.indexOf('comic') >= 0 ? 'comic_series' : pathName.indexOf('ai') >= 0 ? 'ai_series' : 'short_play'], sort: [pathName.indexOf('/new/') === 0 ? 'online_time' : 'hot_score'], category_dim_theme: [], category_dim_role: [], category_dim_epoch: [], gender: [], online_time: [], creation_status: [] };
    Object.keys(filters || {}).forEach(function (key) { if (selection[key]) selection[key] = filters[key] ? [filters[key]] : []; });
    var query = appQuery(device); delete query._rticket; var endpoint = API_BASE + '/reading/distribution/category/landpage/v/?' + sortedQuery(query);
    return jsonRequest(endpoint, 'POST', { filter_ids: '', req_scene: pathName.indexOf('comic') >= 0 ? 'comic_series' : pathName.indexOf('ai') >= 0 ? 'ai_series' : 'default', offset: Number(offset) || 0, need_selector_panel: !!selectors, limit: 15, select_items: selection, session_id: '', req_type: selectors ? 'default' : 'only_content', client_req_type: 3 }).then(function (payload) {
      var data = payload && payload.data || {}; return { items: normalizeRows(data.video_data), has_more: bool(data.has_more), next_offset: number(data.next_offset), session_id: first(data.session_id), filters: selectors ? [] : undefined, source: 'webos-category' };
    });
  }
  function rank(pathName) { return fetchHTML(WEB_BASE + (pathName || '/rank/hot-drama')).then(function (html) { var content = findObject(routerData(html), 'content') || {}; var pagination = content.pagination || {}; return { items: normalizeRows(content.rankList || []), has_more: number(pagination.pageNum) > 0 && number(pagination.totalPages) > number(pagination.pageNum), next_offset: number(pagination.pageNum) + 1, source: 'webos-web' }; }); }
  function search(query) { return fetchHTML(WEB_BASE + '/search/' + encodeURIComponent(query)).then(function (html) { return { items: normalizeRows(findArray(routerData(html), 'searchList') || []), source: 'webos-web' }; }); }
  function detail(seriesID) { return fetchHTML(WEB_BASE + '/detail?series_id=' + encodeURIComponent(seriesID)).then(function (html) { var router = routerData(html); var drama = normalize(findObject(router, 'seriesDetail')); if (!drama || drama.series_id !== seriesID) throw fail('详情响应缺少剧集信息'); drama.episodes = (drama.vid_list || []).map(function (vid, index) { return { index: index + 1, video_id: vid, title: '第' + (index + 1) + '集', locked: index >= drama.accessible_episode_cnt }; }); var related = normalizeRows(findArray(router, 'related_list') || findArray(router, 'videoList') || []); return { series_id: drama.series_id, title: drama.title, cover: drama.cover, intro: drama.intro, score: drama.score, play_count: drama.play_count, episode_count: drama.episode_count, accessible_episode_cnt: drama.accessible_episode_cnt, vid: drama.vid, vid_list: drama.vid_list, episodes: drama.episodes, tags: drama.tags, related: related, reviews: [] }; }); }

  module.exports = { prepare: prepare, serveMedia: serveMedia, category: category, recommend: function (offset) { return category('/category/short-drama', offset, {}, false); }, rank: rank, search: search, detail: detail, status: function () { return { playback_verified: false, provider: 'first-party-js-port', media: 'cenc-aes-ctr-local-cache' }; } };
}());
