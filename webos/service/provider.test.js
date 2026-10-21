'use strict';

var assert = require('assert');
var crypto = require('crypto');
var EventEmitter = require('events');
var PassThrough = require('stream').PassThrough;
var http = require('http');
var https = require('https');
var fs = require('fs');
var os = require('os');
var path = require('path');
var rangeMedia = require('./range-media');
var originalDownloadFile = rangeMedia.downloadFile;
var originalRequest = https.request;
var dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-webos-provider-'));
process.env.HONGGUO_WEBOS_DATA_DIR = dataRoot;
process.env.HONGGUO_WEBOS_CACHE_DIR = dataRoot;
var seriesID = '1234567890123456789';
var categoryRequest = null;
var calendarRequest = null;
var engagementRequests = [];
var videoModelRequests = 0;
var mediaDownloadRequests = 0;
var html = '<script>window._ROUTER_DATA=' + JSON.stringify({ loaderData: { detail_page: {
  seriesDetail: {
    series_id: seriesID,
    series_name: '接口回归短剧',
    episode_cnt: 2,
    accessible_episode_cnt: 1,
    vid_list: ['2234567890123456789', '3234567890123456789'],
    celebrities: [
      { celebrity_id: '7377326001203713305', nickname: '测试演员', avatar: 'https://example.test/actor.jpg' },
      { celebrity_id: '7377326001203713305', nickname: '重复演员' },
      { user_info: { base_info: { actor_id_str: '7400000000000000001', user_name: '嵌套演员' } } }
    ]
  },
  social: {
    related_list: [
      { series_id: '4234567890123456789', series_title: '相关推荐', episode_cnt: 4 },
      { series_id: seriesID, series_title: '当前短剧' }
    ],
    reviews: [
      { review_id: '7', user_name: '观众', content: '真实剧评', rating: 9, digg_count: 5 }
    ]
  }
} } }) + ';</script>';

https.request = function (options) {
  var req = new EventEmitter();
  var requestChunks = [];
  req.write = function (chunk) { requestChunks.push(Buffer.from(chunk)); };
  req.destroy = function (error) { if (error) process.nextTick(function () { req.emit('error', error); }); };
  req.end = function () {
    var body = html;
    if (options.path.indexOf('/novel/player/video_model/v1/') >= 0) {
      videoModelRequests++;
      body = JSON.stringify({ data: { video_model: { video_list: [{ main_url: 'https://media.example.test/episode.mp4', video_meta: { vheight: 720, definition: '720P' }, encrypt_info: {} }] } } });
    }
    if (options.path.indexOf('/reading/bookapi/plan/v') >= 0) body = '{"code":0,"data":[]}';
    if (options.path.indexOf('/reading/distribution/category/landpage/v/') >= 0) {
      categoryRequest = { options: options, query: Object.fromEntries(new URL('https://fixture.test' + options.path).searchParams), body: Buffer.concat(requestChunks).toString('utf8') };
      body = JSON.stringify({ code: 0, data: { has_more: true, next_offset: 15, session_id: 'category-session', video_data: [{ series_id: seriesID, series_title: '真实分类剧', episode_cnt: 12, vid: '2234567890123456789', tags: ['悬疑'] }], selector_rows: [] } });
    }
    if (options.path.indexOf('/reading/user/subscribe/list/v1/') >= 0) {
      calendarRequest = { options: options, query: Object.fromEntries(new URL('https://fixture.test' + options.path).searchParams) };
      body = JSON.stringify({ code: 0, data: { has_more: false, next_offset: 0, subscribe_items: [{ item_id: '4234567890123456789', name: '待上线剧', cover: 'https://example.test/cover.jpg', item_desc: '简介', categories: ['都市'] }] } });
    }
    if (options.path.indexOf('/novel/player/multi_video_detail/preload/v1') >= 0) {
      var parsedRequest = new URL('https://fixture.test' + options.path);
      engagementRequests.push({ options: options, query: Object.fromEntries(parsedRequest.searchParams), body: Buffer.concat(requestChunks).toString('utf8') });
      body = engagementRequests.length === 1 ? '' : JSON.stringify({ code: 0, data: {} });
      var engagementData = {};
      engagementData[seriesID] = { video_data: { series_id_str: seriesID, followed_cnt: 19, video_list: [{ vid: '2234567890123456789', digged_count: 7, comment_count: 4, episode_cover: 'https://example.test/episode.jpg' }] } };
      if (engagementRequests.length > 1) body = JSON.stringify({ code: 0, data: engagementData });
    }
    process.nextTick(function () {
      var response = new PassThrough();
      response.statusCode = 200;
      req.emit('response', response);
      response.end(body);
    });
  };
  return req;
};

var provider = require('./provider');
rangeMedia.downloadFile = function (_, destination) {
  mediaDownloadRequests++;
  fs.writeFileSync(destination, Buffer.from('full-media-fixture'));
  return Promise.resolve();
};

function requestMedia(server, method, range, ifRange) {
  return new Promise(function (resolve, reject) {
    var headers = {};
    if (range) headers.Range = range;
    if (ifRange) headers['If-Range'] = ifRange;
    var request = http.request({ host: '127.0.0.1', port: server.address().port, method: method, path: '/media', headers: headers }, function (response) {
      var chunks = [];
      response.on('data', function (chunk) { chunks.push(chunk); });
      response.on('end', function () { resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }); });
    });
    request.on('error', reject);
    request.end();
  });
}

async function testMediaRangeProxy() {
  var token = '0123456789abcdef01234567';
  var mediaDir = path.join(dataRoot, token);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, token + '.mp4'), Buffer.from('abcdefghij'));
  var server = http.createServer(function (request, response) {
    provider.serveMedia(request, response, token);
  });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  try {
    var bounded = await requestMedia(server, 'GET', 'bytes=2-5');
    assert.strictEqual(bounded.status, 206);
    assert.strictEqual(bounded.headers['content-range'], 'bytes 2-5/10');
    assert.strictEqual(bounded.headers['content-length'], '4');
    assert.strictEqual(bounded.body.toString(), 'cdef');
    assert(bounded.headers.etag, 'the cached media has a validator for If-Range');

    var suffix = await requestMedia(server, 'GET', 'bytes=-3');
    assert.strictEqual(suffix.status, 206);
    assert.strictEqual(suffix.headers['content-range'], 'bytes 7-9/10');
    assert.strictEqual(suffix.body.toString(), 'hij');

    var matchingIfRange = await requestMedia(server, 'GET', 'bytes=0-1', bounded.headers.etag);
    assert.strictEqual(matchingIfRange.status, 206);
    assert.strictEqual(matchingIfRange.body.toString(), 'ab');

    var staleIfRange = await requestMedia(server, 'GET', 'bytes=0-1', '"stale"');
    assert.strictEqual(staleIfRange.status, 200);
    assert.strictEqual(staleIfRange.headers['content-range'], undefined);
    assert.strictEqual(staleIfRange.body.toString(), 'abcdefghij');

    var head = await requestMedia(server, 'HEAD', 'bytes=1-3');
    assert.strictEqual(head.status, 206);
    assert.strictEqual(head.headers['content-length'], '3');
    assert.strictEqual(head.body.length, 0);

    var invalid = await requestMedia(server, 'GET', 'bytes=0-1,4-5');
    assert.strictEqual(invalid.status, 416);
    assert.strictEqual(invalid.headers['content-range'], 'bytes */10');
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

async function run() {
  try {
    assert.deepStrictEqual(provider.parseMediaByteRange('bytes=-2', 10), { start: 8, end: 9, partial: true });
    assert.strictEqual(provider.parseMediaByteRange('bytes=0-1,4-5', 10), null);
    await testMediaRangeProxy();

    var detail = await provider.detail(seriesID);
    assert.strictEqual(detail.episodes.length, 2);
    assert.strictEqual(detail.episodes[1].locked, true);
    assert.deepStrictEqual(detail.actors.map(function (actor) { return actor.id; }), ['7377326001203713305', '7400000000000000001']);
    assert.strictEqual(detail.actors[0].name, '测试演员');
    assert.strictEqual(detail.actors[0].avatar, 'https://example.test/actor.jpg');
    assert.strictEqual(detail.related.length, 1);
    assert.strictEqual(detail.related[0].series_id, '4234567890123456789');
    assert.strictEqual(detail.reviews[0].content, '真实剧评');
    assert.strictEqual(detail.reviews[0].rating, 9);

    var category = await provider.category('/category/real-drama', 0, {}, false);
    assert.strictEqual(category.items.length, 1);
    assert.strictEqual(category.items[0].title, '真实分类剧');
    assert.strictEqual(category.has_more, true);
    assert(categoryRequest, 'category endpoint was requested');
    assert.strictEqual(categoryRequest.options.method, 'POST');
    assert(categoryRequest.options.headers['X-Gorgon'], 'category request is signed');
    assert(categoryRequest.options.headers['X-Medusa'], 'category request includes Passport signature');
    assert(categoryRequest.query.device_id && categoryRequest.query.iid, 'category uses a fresh device identity');
    var categoryBody = JSON.parse(categoryRequest.body);
    assert.strictEqual(categoryBody.req_scene, 'default');
    assert.strictEqual(categoryBody.req_type, 'only_content');

    var calendar = await provider.calendar({ offset: 0 });
    assert.strictEqual(calendar.items.length, 1);
    assert.strictEqual(calendar.items[0].title, '待上线剧');
    assert.deepStrictEqual(calendar.items[0].tags, ['都市']);
    assert(calendarRequest, 'calendar endpoint was requested');
    assert(calendarRequest.options.headers['X-Gorgon'], 'calendar request is signed');
    assert(calendarRequest.query.device_id && calendarRequest.query.iid, 'calendar uses a fresh device identity');
    assert.notStrictEqual(categoryRequest.query.device_id, calendarRequest.query.device_id, 'each API request gets a one-shot device identity');

    var stats = await provider.engagement(seriesID, '2234567890123456789');
    assert.strictEqual(stats.likes, 7);
    assert.strictEqual(stats.favorites, 19);
    assert.strictEqual(stats.comments, 4);
    assert.strictEqual(stats.episode_cover, 'https://example.test/episode.jpg');
    assert.strictEqual(engagementRequests.length, 2, 'an empty upstream response is retried');
    assert(engagementRequests[0].options.headers['X-Gorgon'] && engagementRequests[1].options.headers['X-Gorgon'], 'both attempts are signed');
    assert.notStrictEqual(engagementRequests[0].query.device_id, engagementRequests[1].query.device_id, 'retry uses a fresh device identity');

    var fullToken = crypto.createHash('sha256').update(seriesID + ':4234567890123456789').digest('hex').slice(0, 24);
    var rangeToken = crypto.createHash('sha256').update(fullToken + ':range').digest('hex').slice(0, 24);
    assert.notStrictEqual(rangeToken, fullToken, 'Range and full playback use independent local media tokens');
    var downloadsBeforePrefetch = mediaDownloadRequests;
    var prefetchError = await provider.prepare(seriesID, '4234567890123456789', '', false, 'range', true).then(function () { return null; }, function (error) { return error; });
    assert(prefetchError && /CENC key/.test(prefetchError.message), 'Range prefetch without a key fails quietly');
    assert.strictEqual(mediaDownloadRequests, downloadsBeforePrefetch, 'failed Range prefetch never downloads the full episode');
    assert.strictEqual(videoModelRequests, 1, 'prefetch resolves the episode source before rejecting unsupported Range');
    var rangeFallback = await provider.prepare(seriesID, '5234567890123456789', '', false, 'range', false);
    assert.strictEqual(rangeFallback.mode, 'full');
    assert(rangeFallback.range_fallback, 'foreground Range preparation reports its full-file fallback');
    assert.strictEqual(mediaDownloadRequests, downloadsBeforePrefetch + 1, 'foreground Range failure falls back to one full download');
    var fallbackToken = crypto.createHash('sha256').update(seriesID + ':5234567890123456789').digest('hex').slice(0, 24);
    assert.strictEqual(rangeFallback.path, '/minireel-proxy/media/' + fallbackToken + '.mp4', 'foreground fallback uses the standard full-file URL');
    assert.strictEqual(videoModelRequests, 2, 'foreground preparation performs a fresh source resolution');

    var seasons = await provider.seasons(seriesID);
    assert.strictEqual(seasons.source, 'webos-detail-fallback');
    assert.strictEqual(seasons.items.length, 1);
    assert.strictEqual(seasons.items[0].series_id, seriesID);
    assert.strictEqual(seasons.items[0].playable, true);

    var drama = { series_id: seriesID, title: '接口回归短剧' };
    var liked = provider.changeLibrary({ action: 'like', drama: drama, video_id: '2234567890123456789', episode: 1, value: true });
    assert.strictEqual(liked.entries[0].liked_videos[0].video_id, '2234567890123456789');
    assert.strictEqual(liked.entries[0].liked_at, liked.entries[0].liked_videos[0].liked_at);
    var unliked = provider.changeLibrary({ action: 'like', drama: drama, video_id: '2234567890123456789', episode: 1, value: false });
    assert.strictEqual(unliked.entries.length, 0);
    var dramaLike = provider.changeLibrary({ action: 'like', drama: drama, value: true });
    assert(dramaLike.entries[0].liked_at > 0, 'guest series-like behavior is retained');
    console.log('webOS provider signed category/calendar, detail actors/social and empty-season fallback: PASS');
  } finally {
    https.request = originalRequest;
    rangeMedia.downloadFile = originalDownloadFile;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

run().catch(function (error) {
  https.request = originalRequest;
  rangeMedia.downloadFile = originalDownloadFile;
  console.error(error.stack || error);
  process.exitCode = 1;
});
