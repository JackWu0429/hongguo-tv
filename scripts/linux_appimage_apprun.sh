#!/usr/bin/env bash
set -euo pipefail
package_dir="${APPDIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
# System WebKitGTK and GStreamer stay together. Do not inject incompatible
# bundled GTK/GLib libraries or silently disable the WebKit sandbox.
exec "$package_dir/usr/bin/hongguo-tv" "$@"
