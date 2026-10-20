'use strict';

var assert = require('assert');
var EventEmitter = require('events');
var PassThrough = require('stream').PassThrough;
var https = require('https');
var originalRequest = https.request;
var seriesID = '1234567890123456789';
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
  req.write = function () {};
  req.destroy = function (error) { if (error) process.nextTick(function () { req.emit('error', error); }); };
  req.end = function () {
    var body = options.path.indexOf('/reading/bookapi/plan/v') >= 0 ? '{"code":0,"data":[]}' : html;
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

async function run() {
  try {
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

    var seasons = await provider.seasons(seriesID);
    assert.strictEqual(seasons.source, 'webos-detail-fallback');
    assert.strictEqual(seasons.items.length, 1);
    assert.strictEqual(seasons.items[0].series_id, seriesID);
    assert.strictEqual(seasons.items[0].playable, true);
    console.log('webOS provider detail actors/social and empty-season fallback: PASS');
  } finally {
    https.request = originalRequest;
  }
}

run().catch(function (error) {
  https.request = originalRequest;
  console.error(error.stack || error);
  process.exitCode = 1;
});
