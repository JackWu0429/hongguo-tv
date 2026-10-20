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
  console.log('webOS account storage, ownership, transport, reservation, and cloud sync: PASS');
}

run().then(function () { rmTree(root); }, function (error) {
  rmTree(root);
  console.error(error.stack || error);
  process.exitCode = 1;
});
