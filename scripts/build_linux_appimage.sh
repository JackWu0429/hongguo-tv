#!/usr/bin/env bash
# Linux test packages are built inside Debian 12 on GitHub Actions.
set -euo pipefail
: "${GITHUB_ACTIONS:?Use the Linux AppImage validation workflow}"
: "${HONGGUO_CORE_VERSION:?Exact bundled core identity is required}"
: "${HONGGUO_LINUX_VERSION:?Linux package version is required}"
: "${HONGGUO_LINUX_OUT:?Output directory is required}"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$(mktemp -d /tmp/hongguo-appimage-build.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
app_dir="$build_dir/AppDir"
mkdir -p "$app_dir/usr/bin" "$HONGGUO_LINUX_OUT" "$repo_dir/desktop/frontend/dist"
cp "$repo_dir/desktop/frontend/index.html" "$repo_dir/desktop/frontend/dist/index.html"
cd "$repo_dir"
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$HONGGUO_CORE_VERSION" -o "$app_dir/usr/bin/hongguo-tv-core" ./core/cmd/hongguotv
cd desktop
go test -tags 'production,webkit2_41' ./...
go build -trimpath -tags 'production,webkit2_41' -ldflags "-s -w -X main.version=$HONGGUO_CORE_VERSION -X main.desktopVersion=$HONGGUO_LINUX_VERSION -X main.desktopVersionCode=0" -o "$app_dir/usr/bin/hongguo-tv" .
install -m 755 "$repo_dir/scripts/linux_appimage_apprun.sh" "$app_dir/AppRun"
install -m 644 "$repo_dir/desktop/resources/appicon.png" "$app_dir/hongguo-tv.png"
ln -s hongguo-tv.png "$app_dir/.DirIcon"
cat > "$app_dir/hongguo-tv.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=红果短剧
Exec=hongguo-tv
Icon=hongguo-tv
Terminal=false
Categories=AudioVideo;Video;
StartupWMClass=hongguo-tv
EOF
install -m 644 "$repo_dir/docs/linux-appimage.md" "$app_dir/README.md"
curl --fail --location --retry 3 'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage' -o "$build_dir/appimagetool.AppImage"
curl --fail --location --retry 3 'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64' -o "$build_dir/runtime-x86_64"
printf '%s  %s\n' '95cbe7cce9717fce90c484e34052ee7c7f1d7635b33c12525b4776826a7d29b6' "$build_dir/appimagetool.AppImage" | sha256sum --check
printf '%s  %s\n' '617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46' "$build_dir/runtime-x86_64" | sha256sum --check
chmod +x "$build_dir/appimagetool.AppImage"
cd "$build_dir"
./appimagetool.AppImage --appimage-extract >/dev/null
package_path="$HONGGUO_LINUX_OUT/hongguo-desktop-$HONGGUO_LINUX_VERSION-x86_64.AppImage"
ARCH=x86_64 ./squashfs-root/AppRun --no-appstream --runtime-file "$build_dir/runtime-x86_64" "$app_dir" "$package_path"
chmod 755 "$package_path"
cd "$HONGGUO_LINUX_OUT"
sha256sum "$(basename "$package_path")" > SHA256SUMS
(cd "$HONGGUO_LINUX_OUT" && sha256sum "$(basename "$package_path")" > "$(basename "$package_path").sha256")
python3 - "$package_path" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
p=Path(sys.argv[1])
assert p.read_bytes()[8:11] == b'AI\x02', 'Not a type-2 AppImage'
metadata={'file':p.name,'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
          'source_commit':os.environ['GITHUB_SHA'],'core_version':os.environ['HONGGUO_CORE_VERSION'],
          'version':os.environ['HONGGUO_LINUX_VERSION'],'architecture':'x86_64','build_distribution':'Debian 12',
          'system_runtime_required':['WebKitGTK 4.1','GTK 3','GStreamer 1.0','GStreamer libav HEVC/AAC decoder'],
          'bundled':['desktop shell','Go core','shared UI'],'experimental':True}
(p.parent/'package.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
print(json.dumps(metadata,ensure_ascii=False,indent=2))
PY
