#!/usr/bin/env bash
set -euo pipefail
: "${HONGGUO_PROBE_OUTPUT:?An isolated evidence directory is required}"
cd /work
mkdir -p "$HONGGUO_PROBE_OUTPUT" /tmp/hongguo-linux-cache /tmp/hongguo-linux-config
(cd /candidate && sha256sum --check SHA256SUMS)
package_path="$(find /candidate -maxdepth 1 -name '*.AppImage' -type f)"
test -n "$package_path"
chmod +x "$package_path"
export HONGGUO_PROBE_JS=/work/scripts/linux_playback_probe.js
export HONGGUO_PROBE_REQUIRE_AUTOPLAY=1 HONGGUO_PROBE_APPIMAGE=1
export HONGGUO_PROBE_ENVIRONMENT="$(. /etc/os-release; printf '%s' "$PRETTY_NAME") / Xvfb / software decoding / same AppImage"
export XDG_CACHE_HOME=/tmp/hongguo-linux-cache XDG_CONFIG_HOME=/tmp/hongguo-linux-config
export LIBGL_ALWAYS_SOFTWARE=1 GST_PLUGIN_FEATURE_RANK=avdec_h265:300,avdec_h264:300
unset HONGGUO_CORE_PATH
{
  cat /etc/os-release
  uname -m
  dpkg-query -W 'libwebkit2gtk-4.1-0' 'libgstreamer1.0-0' 'gstreamer1.0-libav'
  gst-inspect-1.0 avdec_h265
  cat /candidate/package.json
} > "$HONGGUO_PROBE_OUTPUT/environment.txt"
set +e
xvfb-run -a -s '-screen 0 1280x800x24' dbus-run-session -- bash -c '
  set -e
  openbox > /tmp/hongguo-openbox.log 2>&1 &
  pulseaudio --start --exit-idle-time=-1
  pactl load-module module-null-sink sink_name=linux_probe >/dev/null
  pactl set-default-sink linux_probe
  timeout 7m "$1" --appimage-extract-and-run --linux-playback-self-test
' _ "$package_path" > /tmp/hongguo-appimage-private.log 2>&1
native_status=$?
set -e
python3 - <<'PY'
import os,re
from pathlib import Path
log=re.sub(r'''(?:https?|wails)://[^\s'"<>]+''','[URL omitted]',Path('/tmp/hongguo-appimage-private.log').read_text(errors='replace'))
(Path(os.environ['HONGGUO_PROBE_OUTPUT'])/'native.txt').write_text(log)
print(log[-8000:])
PY
python3 scripts/verify_linux_playback.py "$HONGGUO_PROBE_OUTPUT"
test "$native_status" -eq 0
