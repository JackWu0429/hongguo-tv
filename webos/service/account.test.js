'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var createAccount = require('./account');

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-webos-account-'));
var calls = [];
function response(payload, headers) {
  return Promise.resolve({ status: 200, headers: headers || {}, body: Buffer.from(JSON.stringify(payload)) });
}
function transport(target, method, headers, body) {
  var parsed = require('url').parse(target, true), pathname = parsed.pathname;
  calls.push({ target: target, method: method, headers: headers, body: body && body.toString('utf8') });
  if (pathname === '/reading/user/subscribe/list/v1/' && parsed.query.tab_type === '14') return response({ code: 0, data: { mix_data: [], has_more: false } });
  if (pathname === '/reading/user/subscribe/list/v1/' && parsed.query.tab_type === '13') return response({ code: 0, data: { subscribe_items: [], has_more: false } });
  if (pathname === '/reading/bookapi/read_history/list/v') return response({ code: 0, data: { data_list: [], has_more: false } });
  if (pathname === '/reading/bookapi/bookshelf/video/list/v') return response({ code: 0, data: { video_shelf_info: [] } });
  if (pathname === '/reading/ugc/action/mget/v') return response({ code: 0, data: { mixed_data_list: null, has_more: false } });
  if (pathname === '/reading/bookapi/bookmall/tab/v') return response({ code: 0, data: { bookstore_id: '7650476689721409598', tab_item: [{ tab_type: 45, session_id: 'follow-session', cell_data: [
    { show_type: 647, cell_id_str: '8650476176527343678', cell_data: [{ video_detail: { series_id: '9001', series_title: '演员推荐', episode_cnt: 12, first_vid: '9002' } }] },
    { show_type: 648, cell_id_str: '7650476176527343678', has_more: true, next_offset: 0, cell_data: [{ video_data: [{ video_detail: { series_id: '1234567890123456789', series_title: '追更剧', episode_cnt: 12, first_vid: '2234567890123456789' } }] }] }
  ] }] } });
  if (pathname === '/reading/bookapi/bookmall/cell/change/v') return response({ code: 0, data: { has_more: false, next_offset: 6, session_id: 'follow-session', cell_view: { cell_data: [{ video_detail: { series_id: '3234567890123456789', series_title: '第二页追更剧', episode_cnt: 8, first_vid: '4234567890123456789' } }] } } });
  if (pathname === '/reading/bookapi/search/uncover_subscribe/v') return response({ code: 0, data: {} });
  if (pathname === '/novel/articleapi/do_action/v1/') return response({ code: 0, data: {} });
  return response({ code: 0, data: {} }, { 'set-cookie': ['sessionid=next-session; Path=/'], 'x-tt-token': 'next-token' });
}

function rmTree(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function (name) {
    var item = path.join(dir, name), stat = fs.lstatSync(item);
    if (stat.isDirectory()) rmTree(item); else fs.unlinkSync(item);
  });
  fs.rmdirSync(dir);
}

async function run() {
  var account = createAccount({ dataDir: root, requestBuffer: transport });
  assert.strictEqual(account.status().logged_in, false);
  assert.deepStrictEqual(account.librarySnapshot().entries, []);

  account.state.session.registered = true;
  account.state.session.cookies.sessionid = 'old-session';
  account.state.profile = { uid: '12345678901234567', name: '测试账号', phone: '+86**********' };
  account.save();
  var originalSync = account.sync;
  account.sync = function () { return Promise.resolve(account.status()); };

  var drama = { series_id: '1234567890123456789', title: '测试短剧', cover: 'https://example.test/poster.jpg' };
  var favorite = account.changeLibrary({ owner_id: account.state.profile.uid, action: 'favorite', drama: drama, value: true });
  assert.strictEqual(favorite.owner_id, account.state.profile.uid);
  assert.strictEqual(favorite.entries[0].favorite_at > 0, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(favorite, 'cloud'), false);
  assert.throws(function () { account.changeLibrary({ owner_id: 'another-account', action: 'favorite', drama: drama, value: false }); }, /账号已切换/);

  account.changeLibrary({ owner_id: account.state.profile.uid, action: 'progress', drama: drama, episode: 2, video_id: '9876543210123456789', position: 15, duration: 80 });
  var stored = account.library();
  assert.strictEqual(stored.cloud.pending.length, 2);
  assert(stored.cloud.pending[0].sequence < stored.cloud.pending[1].sequence);
  assert(calls.length === 0, 'local writes do not synchronously block on cloud sync');

  account.changeLibrary({ owner_id: account.state.profile.uid, action: 'remove', kind: 'favorites', series_id: drama.series_id });
  stored = account.library();
  assert(stored.cloud.hidden['favorites:' + drama.series_id] > 0);
  assert.strictEqual(stored.cloud.pending.filter(function (item) { return item.kind === 'favorite'; }).length, 1);
  assert.strictEqual(stored.cloud.pending.filter(function (item) { return item.kind === 'favorite'; })[0].value, false);

  var before = calls.length;
  var op = await account.client.request('/account/test', 'GET', {}, null, false);
  assert.strictEqual(op.code, 0);
  assert.strictEqual(calls.length, before + 1, 'Client.request uses injected transport');
  assert.strictEqual(account.state.session.cookies.sessionid, 'next-session');
  assert.strictEqual(account.state.session.token, 'next-token');
  assert.strictEqual(calls[calls.length - 1].headers.Cookie.indexOf('old-session') >= 0, true);

  var followRecommendations = await account.recommend({ channel: '45' });
  assert.strictEqual(followRecommendations.items.length, 1, 'only the follow cell is parsed');
  assert.strictEqual(followRecommendations.items[0].title, '追更剧', 'actor recommendations are not mixed into follow content');
  assert.strictEqual(followRecommendations.items[0].vid, '2234567890123456789');
  assert.strictEqual(followRecommendations.feed_cell, '7650476176527343678');
  assert.strictEqual(followRecommendations.feed_plan, '7650476689721409598');
  assert.strictEqual(followRecommendations.session_id, 'follow-session');
  var firstRecommendCall = calls[calls.length - 1];
  assert(firstRecommendCall.target.indexOf('/reading/bookapi/bookmall/tab/v?') >= 0, 'first request discovers the signed account follow cell');
  assert(firstRecommendCall.headers['X-Gorgon'], 'follow recommendations use a signed account request');
  assert.strictEqual(require('url').parse(firstRecommendCall.target, true).query.tab_type, '45');
  var followPage = await account.recommend({ channel: '45', feed_cell: followRecommendations.feed_cell, feed_plan: followRecommendations.feed_plan, session_id: followRecommendations.session_id, offset: '0', shown: 'seen-id' });
  assert.strictEqual(followPage.items[0].title, '第二页追更剧');
  assert.strictEqual(followPage.has_more, false);
  var pageCall = calls[calls.length - 1];
  var pageQuery = require('url').parse(pageCall.target, true).query;
  assert.strictEqual(pageQuery.cell_id, '7650476176527343678');
  assert.strictEqual(pageQuery.plan_id, '7650476689721409598');
  assert.strictEqual(pageQuery.session_id, 'follow-session');
  assert.strictEqual(pageQuery.filter_ids, 'seen-id');

  var reserveResult = await account.reserve('1234567890123456789', true);
  assert.deepStrictEqual(reserveResult, { accepted: true, confirmed: false });
  assert.strictEqual(calls[calls.length - 1].method, 'POST');
  assert(calls[calls.length - 1].body.indexOf('1234567890123456789') >= 0);

  account.sync = originalSync;
  var syncResult = await account.sync();
  assert.strictEqual(syncResult.sync.pending, 0);
  assert.strictEqual(syncResult.sync.state, 'idle');

  var loggedOut = createAccount({ dataDir: path.join(root, 'guest'), requestBuffer: transport });
  assert.throws(function () { loggedOut.notifications(); }, /请先登录/);
  await assert.rejects(loggedOut.recommend({ channel: '45' }), /请先登录/);
  console.log('webOS account storage, ownership, transport, reservation, and cloud sync: PASS');
}

run().then(function () { rmTree(root); }, function (error) {
  rmTree(root);
  console.error(error.stack || error);
  process.exitCode = 1;
});
