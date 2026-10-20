#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out_dir=${WEBOS_OUTPUT_DIR:-"$repo_dir/dist/webos"}
stage_output=${WEBOS_STAGE_OUTPUT:-}
simulator_probe=${WEBOS_SIMULATOR_PROBE:-}
check_only=0
if [ "${1:-}" = "--check-only" ]; then check_only=1; fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/hongguo-webos.XXXXXX")
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT INT TERM

app_stage="$stage/app"
service_stage="$stage/service"
mkdir -p "$app_stage" "$service_stage" "$out_dir"
cp -R "$repo_dir/core/cmd/hongguotv/ui/." "$app_stage/"
cp "$repo_dir/webos/appinfo.json" "$app_stage/appinfo.json"
cp "$repo_dir/webos/app/webos-adapter.js" "$app_stage/webos-adapter.js"
node - "$app_stage/webos-adapter.js" "$app_stage/appinfo.json" <<'NODE'
var fs = require('fs');
var adapterPath = process.argv[2];
var appInfoPath = process.argv[3];
var adapter = fs.readFileSync(adapterPath, 'utf8');
var appInfo = JSON.parse(fs.readFileSync(appInfoPath, 'utf8'));
var marker = "appVersion: ''";
if (adapter.indexOf(marker) < 0) throw new Error('webOS adapter appVersion placeholder missing');
fs.writeFileSync(adapterPath, adapter.replace(marker, 'appVersion: ' + JSON.stringify(appInfo.version)));
NODE
mkdir -p "$app_stage/webOSTVjs-1.2.13"
cp "$repo_dir/webos/app/webOSTVjs-1.2.13/webOSTV.js" "$app_stage/webOSTVjs-1.2.13/webOSTV.js"
cp "$repo_dir/webos/app/webOSTVjs-1.2.13/LICENSE-2.0.txt" "$app_stage/webOSTVjs-1.2.13/LICENSE-2.0.txt"
cp "$repo_dir/desktop/resources/appicon.png" "$app_stage/icon.png"
cp "$repo_dir/desktop/resources/appicon.png" "$app_stage/largeIcon.png"
cp -R "$repo_dir/webos/service/." "$service_stage/"
# Test vectors and local test harnesses stay in the source tree and are
# exercised by CI; do not ship them in the TV service package.
rm -f "$service_stage/passport-sign.test.js" "$service_stage/provider.test.js" "$service_stage/account.test.js" "$service_stage/service.test.js"

# A file:// document cannot resolve the shared UI's root-absolute assets.
index="$app_stage/index.html"
sed -i.bak \
  -e 's#src="/#src="./#g' \
  -e 's#href="/#href="./#g' \
  "$index"
rm -f "$index.bak"
sed -i.bak 's#<script src="./compat.js"></script>#<script src="./webOSTVjs-1.2.13/webOSTV.js"></script><script src="./webos-adapter.js"></script><script src="./compat.js"></script>#' "$index"
rm -f "$index.bak"

if [ -n "$simulator_probe" ]; then
  [ -f "$simulator_probe" ] || { echo "WEBOS_SIMULATOR_PROBE not found: $simulator_probe" >&2; exit 2; }
  [ -n "$stage_output" ] || { echo "WEBOS_SIMULATOR_PROBE requires WEBOS_STAGE_OUTPUT" >&2; exit 2; }
  cp "$simulator_probe" "$app_stage/webos-simulator-probe.js"
  sed -i.bak 's#<script src="./app.js"></script>#<script src="./webos-simulator-probe.js"></script><script src="./app.js"></script>#' "$index"
  rm -f "$index.bak"
fi

if [ -n "$stage_output" ]; then
  case "$stage_output" in
    "$HOME"/*) ;;
    *) echo "WEBOS_STAGE_OUTPUT must be inside HOME because Simulator services are loaded from there" >&2; exit 2 ;;
  esac
  [ ! -e "$stage_output" ] || { echo "WEBOS_STAGE_OUTPUT already exists: $stage_output" >&2; exit 2; }
  mkdir -p "$(dirname -- "$stage_output")"
  mkdir "$stage_output"
  cp -R "$app_stage" "$stage_output/app"
  cp -R "$service_stage" "$stage_output/service"
  echo "staging: $stage_output"
fi

if [ "$check_only" -eq 1 ]; then
  echo "webOS staging verified: $app_stage"
  exit 0
fi

ares_package=${ARES_PACKAGE:-}
if [ -z "$ares_package" ]; then
  if command -v ares-package >/dev/null 2>&1; then ares_package=$(command -v ares-package)
  elif [ -n "${ARES_DIR:-}" ] && [ -f "$ARES_DIR/node_modules/@webos-tools/cli/bin/ares-package.js" ]; then ares_package="node $ARES_DIR/node_modules/@webos-tools/cli/bin/ares-package.js"
  fi
fi
if [ -z "$ares_package" ]; then
  echo "ares-package not found; staging is valid but no .ipk was produced" >&2
  echo "Install @webos-tools/cli or set ARES_PACKAGE to ares-package" >&2
  exit 2
fi

rm -f "$out_dir"/*.ipk
# shellcheck disable=SC2086
$ares_package -o "$out_dir" "$app_stage" "$service_stage"
ipk=$(ls -t "$out_dir"/*.ipk 2>/dev/null | head -1 || true)
[ -n "$ipk" ] || { echo "ares-package completed without an .ipk" >&2; exit 1; }
echo "artifact: $ipk"
