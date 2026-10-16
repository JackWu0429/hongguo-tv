#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_bin=${NODE:-node}

"$node_bin" - "$repo_dir" <<'NODE'
var fs = require('fs');
var path = require('path');
var root = process.argv[2];
function fail(message) { console.error('webOS verify: ' + message); process.exit(1); }
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch (error) { fail('missing ' + path.relative(root, file)); } }
function json(file) { try { return JSON.parse(read(file)); } catch (error) { fail('invalid JSON ' + path.relative(root, file) + ': ' + error.message); } }
var app = json(path.join(root, 'webos', 'appinfo.json'));
['id', 'version', 'type', 'main', 'icon', 'largeIcon'].forEach(function (key) { if (!app[key]) fail('appinfo missing ' + key); });
if (app.id !== 'com.aston314.hongguo.webos') fail('unexpected app id');
if (app.type !== 'web') fail('appinfo type must be web');
if (app.main !== 'index.html') fail('app main must be index.html');
var service = json(path.join(root, 'webos', 'service', 'services.json'));
if (!service.services || !service.services.length || service.services[0].name !== 'com.aston314.hongguo.webos.service') fail('service id mismatch');
var index = read(path.join(root, 'core', 'cmd', 'hongguotv', 'ui', 'index.html'));
var scripts = [];
index.replace(/(?:src|href)=["']([^"']+)["']/g, function (_, value) { if (/\.(?:js|css)$/.test(value)) scripts.push(value.replace(/^\//, '')); return value; });
if (scripts.length < 10) fail('shared UI asset list unexpectedly small');
if (!fs.existsSync(path.join(root, 'webos', 'app', 'webos-adapter.js'))) fail('webOS adapter missing');
var adapter = read(path.join(root, 'webos', 'app', 'webos-adapter.js'));
if (adapter.indexOf('playbackVerified: false') < 0 || adapter.indexOf('isAvailable: function () { return false; }') < 0) fail('adapter must keep native playback disabled');
if (adapter.indexOf('PalmServiceBridge') < 0 || adapter.indexOf('wakeService') < 0) fail('adapter must wake the Luna service before HTTP calls');
var serviceJs = read(path.join(root, 'webos', 'service', 'service.js'));
['webos-service', '127.0.0.1', 'WEBOS_PROVIDER_NOT_IMPLEMENTED', '/api/v1/status', 'idleTimer'].forEach(function (term) { if (serviceJs.indexOf(term) < 0) fail('service missing ' + term); });
if (/127\.0\.0\.1:(?:8787|8797|57828)/.test(adapter + serviceJs)) fail('developer-only port leaked into webOS adapter/service');
console.log('webOS verify: PASS');
console.log(JSON.stringify({ appId: app.id, version: app.version, serviceId: service.services[0].name, sharedUiAssets: scripts.length, playbackVerified: false }, null, 2));
NODE

tmp=$(mktemp -d "${TMPDIR:-/tmp}/hongguo-webos-verify.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM
WEBOS_OUTPUT_DIR="$tmp" "$repo_dir/scripts/build_webos.sh" --check-only >/dev/null
echo "webOS verify: staging command PASS"
