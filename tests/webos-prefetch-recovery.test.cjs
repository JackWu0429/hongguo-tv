'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const vm = require('node:vm');
const cancel = require('../webos/service/audio-cancel');
const tick = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const providerFile = process.env.HONGGUO_WEBOS_PROVIDER_UNDER_TEST || require.resolve('../webos/service/provider');

function spade() {
  const decoded = Buffer.from('0' + '29'.repeat(16)), raw = Buffer.alloc(38), previous = [250, 85];
  for (let i = 0; i < decoded.length; i++) {
    const bits = i.toString(2).replace(/0/g, '').length;
    raw[i + 1] = ((decoded[i] + 21 + bits) & 255) ^ previous[i % 2];
    previous[i % 2] = raw[i + 1];
  }
  raw[0] = 52 ^ raw[1] ^ raw[2];
  const seed = raw[32] ^ raw[33];
  Buffer.from('test').forEach((value, i) => { raw[34 + i] = value ^ seed; });
  return raw.toString('base64');
}
function observe(promise) { return promise.then(value => ({ value }), error => ({ error })); }
async function until(predicate) {
  for (let i = 0; i < 600; i++) { if (predicate()) return; await pause(5); }
  throw Error('Expected preparation event did not occur');
}
function fixture(replies, warmHead) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-prefetch-recovery-'));
  const before = process.env.HONGGUO_WEBOS_CACHE_DIR;
  process.env.HONGGUO_WEBOS_CACHE_DIR = cache;
  const requests = [];
  let registrations = 0;
  let rangeOpens = 0, downloads = 0, headWarms = 0;
  const transport = { request(options) {
    const req = new EventEmitter();
    if (options.path.startsWith('/service/2/device_register/')) {
      registrations++;
      let destroyed = false;
      req.write = () => {};
      req.destroy = error => { destroyed = true; if (error) process.nextTick(() => req.emit('error', error)); };
      req.end = () => process.nextTick(() => {
        if (destroyed) return;
        const res = new PassThrough(); res.statusCode = 200; res.headers = {};
        req.emit('response', res);
        res.end(JSON.stringify({ device_id_str: '1234567890123456789', install_id_str: '2234567890123456789' }));
      });
      return req;
    }
    assert(options.path.startsWith('/novel/player/multi_video_model/v1/'));
    const index = requests.length, reply = replies[index] || {};
    const item = { destroyed: false, body: [], respond: null };
    requests.push(item);
    req.write = data => item.body.push(Buffer.from(data));
    req.destroy = error => { item.destroyed = true; if (error) process.nextTick(() => req.emit('error', error)); };
    item.respond = () => {
      if (item.destroyed) return;
      if (reply.network) { const error = new Error(reply.network); error.code = reply.network; req.emit('error', error); return; }
      const res = new PassThrough(); res.statusCode = reply.status || 200; res.headers = {};
      req.emit('response', res);
      res.end(reply.empty ? '' : reply.body !== undefined ? reply.body : JSON.stringify({ data: { '456': { video_model: { video_list: [{
        main_url: 'https://media.example.test/recovery.mp4', video_meta: { vheight: 720, definition: '720P' }, encrypt_info: { spade_a: spade() }
      }] } } } }));
    };
    req.end = () => { if (!reply.hold) process.nextTick(item.respond); };
    return req;
  } };
  const mod = new Module(providerFile, module); mod.filename = providerFile; mod.paths = Module._nodeModulePaths(path.dirname(providerFile));
  const normal = mod.require.bind(mod);
  mod.require = id => id === 'https' ? transport : id === './range-media' ? {
    open() { rangeOpens++; return Promise.resolve({ prefix: Buffer.alloc(16), samples: [], key: Buffer.alloc(16), length: 128, etag: '"fixture"' }); },
    prefetchHead(source, signal) { headWarms++; return warmHead ? warmHead(source, signal) : Promise.resolve(0); },
    headDiagnostics() { return { media_head_cache_bytes: 128, media_head_cache_hits: 0 }; },
    downloadFile() { downloads++; throw Error('Recovery must not download a complete video'); }
  } : normal(id);
  mod._compile(fs.readFileSync(providerFile, 'utf8'), providerFile);
  const provider = mod.exports, consumers = [], prepare = provider.prepare;
  provider.prepare = function (...args) {
    consumers.push({ prefetch: args[5], signal: args[6] }); return prepare.apply(provider, args);
  };
  return { provider, requests, consumers, get registrations() { return registrations; }, get rangeOpens() { return rangeOpens; }, get downloads() { return downloads; },
    get headWarms() { return headWarms; },
    prepare(prefetch, signal) { return provider.prepare('123', '456', '', true, 'range', prefetch, signal); },
    close() { provider.closeCache(); if (before === undefined) delete process.env.HONGGUO_WEBOS_CACHE_DIR; else process.env.HONGGUO_WEBOS_CACHE_DIR = before; fs.rmSync(cache, { recursive: true }); }
  };
}

test('source preparation is available to foreground while network-only head warming is still pending', async () => {
  let finish;
  const f = fixture([{}], () => new Promise(resolve => { finish = resolve; }));
  try {
    const speculative = f.prepare(true); await until(() => f.headWarms === 1);
    const current = await f.prepare(false);
    assert.equal(current.mode, 'range'); assert.equal(current.preparation_cached, true);
    assert.equal(f.requests.length, 1); assert.equal(f.registrations, 1); assert.equal(f.rangeOpens, 1);
    finish(128); assert.equal((await speculative).path, current.path);
    assert.equal(f.downloads, 0);
  } finally { f.close(); }
});

test('failed speculative head data keeps valid play info and never starts a full-file fallback', async () => {
  const f = fixture([{}], () => Promise.reject(new Error('head unavailable')));
  try {
    const speculative = await f.prepare(true), foreground = await f.prepare(false);
    assert.equal(speculative.preparation_timing.media_head_prefetch_failed, true);
    assert.equal(speculative.path, foreground.path);
    assert.equal(f.requests.length, 1); assert.equal(f.downloads, 0);
  } finally { f.close(); }
});

test('a foreground handoff recovers a failed speculative source once, without full download', async () => {
  const f = fixture([{ status: 502, hold: true }, {}]);
  try {
    const background = observe(f.prepare(true)); await tick();
    const foreground = observe(f.prepare(false)); f.requests[0].respond();
    const result = await foreground;
    assert(!result.error, 'foreground must get a new source attempt after its shared prefetch fails');
    assert.equal(result.value.mode, 'range'); assert.equal(result.value.preparation_shared, true);
    assert.equal(f.requests.length, 2); assert.equal(f.rangeOpens, 1); assert.equal(f.downloads, 0);
    assert.equal(result.value.preparation_timing.media_resolve_retries, 1);
    assert.equal((await background).value.path, result.value.path);
  } finally { f.close(); }
});

test('successful sharing still resolves only once', async () => {
  const f = fixture([{ hold: true }]);
  try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false)); f.requests[0].respond();
    const [x, y] = await Promise.all([b, p]); assert(!x.error && !y.error); assert.equal(x.value.path, y.value.path);
    assert.equal(f.requests.length, 1); assert.equal(f.rangeOpens, 1);
  } finally { f.close(); }
});

test('speculative errors stay single-shot while direct foreground errors retry twice at most', async () => {
  const speculative = fixture([{ status: 502 }]);
  try {
    const result = await observe(speculative.prepare(true));
    assert.equal(result.error.code, 'VIDEO_MODEL_HTTP');
    await pause(300);
    assert.equal(speculative.requests.length, 1, 'speculative preparation must not self-retry');
  } finally { speculative.close(); }

  const recovered = fixture([{ status: 502 }, {}]);
  try {
    const result = await observe(recovered.prepare(false));
    assert(!result.error, 'a direct foreground transient error should recover once');
    assert.equal(recovered.requests.length, 2); assert.equal(recovered.registrations, 1);
    assert.equal(result.value.preparation_timing.media_resolve_retries, 1);
  } finally { recovered.close(); }

  const exhausted = fixture([{ status: 502 }, { status: 503 }, { status: 504 }, {}]);
  try {
    const result = await observe(exhausted.prepare(false));
    assert.equal(result.error.code, 'VIDEO_MODEL_HTTP');
    assert.equal(exhausted.requests.length, 3, 'foreground retry budget is bounded to two retries');
  } finally { exhausted.close(); }
});

test('concurrent foreground consumers share the one recovery, including a late join', async () => {
  const f = fixture([{ status: 503, hold: true }, { hold: true }]);
  try {
    const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false)), q = observe(f.prepare(false));
    f.requests[0].respond(); await until(() => f.requests.length === 2);
    const late = observe(f.prepare(false)); f.requests[1].respond();
    const results = await Promise.all([b, p, q, late]);
    assert(results.every(x => !x.error)); assert.equal(new Set(results.map(x => x.value.path)).size, 1);
    assert.equal(f.requests.length, 2); assert.equal(f.rangeOpens, 1);
  } finally { f.close(); }
});

test('a second failure is returned normally and an explicit retry starts fresh', async () => {
  const f = fixture([{ status: 502, hold: true }, { status: 503 }, {}]);
  try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false)); f.requests[0].respond();
    assert.equal((await p).error.status, 503); assert((await b).error); assert.equal(f.requests.length, 2);
    assert.equal((await f.prepare(false)).mode, 'range'); assert.equal(f.requests.length, 3);
  } finally { f.close(); }
});

test('permission, missing source, malformed response and unsupported quality errors are not retried', async () => {
  for (const reply of [{ status: 401 }, { status: 403 }, { status: 404 }, { body: 'invalid JSON' }, { body: '{}' },
    { body: JSON.stringify({ data: { video_model: { video_list: [] } } }) }]) {
    const f = fixture([Object.assign({ hold: true }, reply)]);
    try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false)); f.requests[0].respond();
      assert((await p).error); assert((await b).error); assert.equal(f.requests.length, 1); assert.equal(f.downloads, 0);
    } finally { f.close(); }
  }
  const f = fixture([{ hold: true }]);
  try {
    const b = observe(f.provider.prepare('123', '456', '1080P', false, 'range', true)); await tick();
    const p = observe(f.provider.prepare('123', '456', '1080P', false, 'range', false)); f.requests[0].respond();
    assert.match((await p).error.message, /本集不提供/); assert((await b).error); assert.equal(f.requests.length, 1);
  } finally { f.close(); }
});

test('temporary transport errors recover, while exhausted empty responses have one extra bounded attempt', async () => {
  for (const replies of [[{ hold: true, network: 'ECONNRESET' }, {}], [{ hold: true, empty: true }, { empty: true }, { empty: true }, {}]]) {
    const f = fixture(replies);
    try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false)); f.requests[0].respond();
      assert(!(await p).error); await b; assert.equal(f.requests.length, replies.length); assert.equal(f.rangeOpens, 1);
    } finally { f.close(); }
  }
});

test('two exhausted empty-response attempts stop at six requests', async () => {
  const f = fixture([{ hold: true, empty: true }, ...Array.from({ length: 5 }, () => ({ empty: true }))]);
  try {
    const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false)); f.requests[0].respond();
    assert.equal((await p).error.code, 'VIDEO_MODEL_EMPTY'); await b; assert.equal(f.requests.length, 6); assert.equal(f.rangeOpens, 0);
  } finally { f.close(); }
});

test('cancelling the only foreground waiter before failure prevents recovery', async () => {
  const f = fixture([{ status: 502, hold: true }]), c = cancel.create();
  try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false, c.signal)); c.abort();
    assert.equal((await p).error.name, 'AbortError'); f.requests[0].respond(); assert((await b).error);
    await pause(300); assert.equal(f.requests.length, 1);
  } finally { f.close(); }
});

test('cancelling during recovery backoff prevents a new upstream request', async () => {
  const f = fixture([{ status: 502, hold: true }]), c = cancel.create();
  try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false, c.signal)); f.requests[0].respond();
    await tick(); c.abort(); assert.equal((await p).error.name, 'AbortError'); await b;
    await pause(300); assert.equal(f.requests.length, 1);
  } finally { f.close(); }
});

test('cancelling one consumer keeps the shared recovery alive for the other', async () => {
  const f = fixture([{ status: 502, hold: true }, {}]), a = cancel.create(), c = cancel.create();
  try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false, a.signal)), q = observe(f.prepare(false, c.signal));
    a.abort(); f.requests[0].respond(); assert.equal((await p).error.name, 'AbortError'); assert(!(await q).error); await b;
    assert.equal(f.requests.length, 2);
  } finally { f.close(); }
});

test('cancelling the last foreground consumer aborts an in-flight recovery', async () => {
  const f = fixture([{ status: 502, hold: true }, { hold: true }]), c = cancel.create();
  try { const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false, c.signal)); f.requests[0].respond();
    await until(() => f.requests.length === 2); c.abort(); assert.equal((await p).error.name, 'AbortError'); await b;
    assert.equal(f.requests[1].destroyed, true); assert.equal(f.rangeOpens, 0); assert.equal(f.requests.length, 2);
  } finally { f.close(); }
});

test('a new foreground request never joins a cancelled recovery still settling', async () => {
  const f = fixture([{ status: 502, hold: true }, {}]), c = cancel.create();
  try {
    const b = observe(f.prepare(true)); await tick(); const p = observe(f.prepare(false, c.signal)); f.requests[0].respond();
    await tick(); c.abort();
    // Call synchronously before the cancelled job's rejection handlers run.
    const fresh = observe(f.prepare(false));
    assert.equal((await p).error.name, 'AbortError'); assert(!(await fresh).error); await b;
    assert.equal(f.requests.length, 2); assert.equal(f.rangeOpens, 1);
  } finally { f.close(); }
});

async function service(f) {
  const create = require(path.join(path.dirname(providerFile), 'service'));
  const s = create({ service: { register() {} }, provider: f.provider, account: {}, numberInput: { close() {} }, updates: {}, port: 0 });
  await s.ensureReady(); return s;
}
function request(s, prefetch) {
  let req;
  const promise = new Promise((resolve, reject) => {
    req = http.get({ host: '127.0.0.1', port: s.address().port, path: '/api/v1/play/info?series_id=123&vid=456&fallback=1&mode=range' + (prefetch ? '&prefetch=1' : '') }, res => {
      let text = ''; res.on('data', x => { text += x; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    }); req.on('error', reject);
  });
  return { promise, abort() { req.destroy(); } };
}

test('actual HTTP handoff and the page 1200ms deadline recover without a retry-button click', async () => {
  const f = fixture([{ status: 502, hold: true }, {}]), s = await service(f);
  try {
    const b = request(s, true); await until(() => f.requests.length === 1);
    const source = fs.readFileSync(require.resolve('../core/cmd/hongguotv/ui/app.js'), 'utf8');
    const begin = source.indexOf('  function waitForPlaybackPrefetch('), end = source.indexOf('\n  function recoverPlaybackAfterError(', begin);
    assert(begin >= 0 && end > begin);
    const context = { Promise, setTimeout, clearTimeout, feedGeneration: 1, playbackDebug() {} };
    vm.runInNewContext(source.slice(begin, end), context);
    const handoff = { promise: b.promise.then(x => x.data.ok ? x.data.data : null) };
    assert.equal(await context.waitForPlaybackPrefetch(handoff, 1, { aborted: false }), null);
    const p = request(s, false); await until(() => f.consumers.some(x => !x.prefetch)); f.requests[0].respond();
    const result = await p.promise;
    assert.equal(result.status, 200); assert.equal(result.data.data.mode, 'range'); await b.promise;
    assert.equal(f.requests.length, 2); assert.equal(f.downloads, 0);
  } finally { await s.shutdown(); f.close(); }
});

test('disconnecting the actual foreground HTTP client prevents a speculative failure from restarting work', async () => {
  const f = fixture([{ status: 502, hold: true }]), s = await service(f);
  try {
    const b = request(s, true); await until(() => f.requests.length === 1);
    const p = request(s, false), ended = observe(p.promise); await until(() => f.consumers.some(x => !x.prefetch));
    p.abort(); await ended; await until(() => f.consumers.some(x => !x.prefetch && x.signal && x.signal.aborted));
    f.requests[0].respond(); await b.promise; await pause(300); assert.equal(f.requests.length, 1);
  } finally { await s.shutdown(); f.close(); }
});
