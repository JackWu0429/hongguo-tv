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
var commands = service.services[0].commands || [];
['ping', 'getDiagnostics', 'shutdown'].forEach(function (name) {
  var command = commands.filter(function (entry) { return entry.name === name; })[0];
  if (!command || command.public !== true) fail('service command must be declared public: ' + name);
});
var servicePackage = json(path.join(root, 'webos', 'service', 'package.json'));
if (servicePackage.name !== service.services[0].name || servicePackage.main !== 'service.js') fail('service package must declare its registered id and service.js entry point');
if (servicePackage.version !== app.version) fail('service package version must match app version');
if (!fs.existsSync(path.join(root, 'webos', 'service', servicePackage.main))) fail('service entry point is missing');
var index = read(path.join(root, 'core', 'cmd', 'hongguotv', 'ui', 'index.html'));
var scripts = [];
index.replace(/(?:src|href)=["']([^"']+)["']/g, function (_, value) { if (/\.(?:js|css)$/.test(value)) scripts.push(value.replace(/^\//, '')); return value; });
if (scripts.length < 10) fail('shared UI asset list unexpectedly small');
if (!fs.existsSync(path.join(root, 'webos', 'app', 'webos-adapter.js'))) fail('webOS adapter missing');
if (!fs.existsSync(path.join(root, 'webos', 'app', 'webOSTVjs-1.2.13', 'webOSTV.js'))) fail('official webOSTV.js library missing');
var adapter = read(path.join(root, 'webos', 'app', 'webos-adapter.js'));
if (adapter.indexOf('playbackVerified: false') < 0 || adapter.indexOf('isAvailable: function () { return false; }') < 0) fail('adapter must keep native playback disabled');
if (adapter.indexOf('PalmServiceBridge') < 0 || adapter.indexOf('wakeService') < 0 || adapter.indexOf('XMLHttpRequest') < 0 || adapter.indexOf('method: method') < 0 || adapter.indexOf('/api/v1/health') < 0 || adapter.indexOf('getDiagnostic') < 0) fail('adapter must expose compatible Luna and HTTP health diagnostics before fetch and XHR calls');
var serviceJs = read(path.join(root, 'webos', 'service', 'service.js'));
['webos-service', '127.0.0.1', 'WEBOS_PROVIDER_NOT_IMPLEMENTED', '/api/v1/status', '/api/v1/health', '/api/v1/diagnostics', 'http_bind', 'manager.create', 'manager.complete', 'Access-Control-Allow-Private-Network'].forEach(function (term) { if (serviceJs.indexOf(term) < 0) fail('service missing ' + term); });
var providerJs = read(path.join(root, 'webos', 'service', 'provider.js'));
var signerJs = read(path.join(root, 'webos', 'service', 'passport-sign.js'));
['video_model', 'spade_a', 'decryptMP4', 'serveMedia', 'randomBytes', 'cenc-aes-ctr'].forEach(function (term) { if (providerJs.indexOf(term) < 0 && serviceJs.indexOf(term) < 0) fail('real provider missing ' + term); });
['X-Medusa', 'X-Helios', 'passportF13', 'aesV3'].forEach(function (term) { if (signerJs.indexOf(term) < 0) fail('passport signer missing ' + term); });
if (serviceJs.indexOf("require('./provider')") < 0) fail('service does not load first-party provider');
if (/127\.0\.0\.1:(?:8787|8797|57828)/.test(adapter + serviceJs)) fail('developer-only port leaked into webOS adapter/service');
if (fs.existsSync(path.join(root, 'webos', 'app', 'webos-adapter.test.js'))) require(path.join(root, 'webos', 'app', 'webos-adapter.test.js'));
if (fs.existsSync(path.join(root, 'webos', 'service', 'service.test.js'))) require(path.join(root, 'webos', 'service', 'service.test.js'));
console.log('webOS verify: PASS');
console.log(JSON.stringify({ appId: app.id, version: app.version, serviceId: service.services[0].name, sharedUiAssets: scripts.length, playbackVerified: false }, null, 2));
NODE

tmp=$(mktemp -d "${TMPDIR:-/tmp}/hongguo-webos-verify.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM
WEBOS_OUTPUT_DIR="$tmp" "$repo_dir/scripts/build_webos.sh" --check-only >/dev/null
echo "webOS verify: staging command PASS"
