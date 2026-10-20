#!/usr/bin/env python3
"""Publish the Linux AppImage only after its candidate passed both distro probes."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from publish_public_release import REPOSITORY, api, gh, release_by_tag, upload_asset, verify_assets


def candidate(directory, version, source_commit):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Invalid Linux version")
    if not re.fullmatch(r"[a-f0-9]{40}", source_commit):
        raise ValueError("Invalid source commit")
    expected_name = f"hongguo-desktop-{version}-x86_64.AppImage"
    appimages = list(directory.glob("*.AppImage"))
    if len(appimages) != 1 or appimages[0].name != expected_name:
        raise ValueError("Unexpected Linux AppImage filename")
    appimage = appimages[0]
    data = appimage.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if len(data) < 12 or data[:4] != b"\x7fELF" or data[8:11] != b"AI\x02":
        raise ValueError("Invalid type-2 AppImage")
    metadata_path = directory / "package.json"
    metadata = json.loads(metadata_path.read_text())
    if metadata.get("file") != expected_name or metadata.get("size") != len(data):
        raise ValueError("Linux package metadata differs from AppImage")
    if metadata.get("sha256") != sha or metadata.get("source_commit") != source_commit:
        raise ValueError("Linux package digest or source commit differs")
    if metadata.get("version") != version or metadata.get("core_version") != f"{version}-{source_commit}":
        raise ValueError("Linux package version differs")
    if metadata.get("architecture") != "x86_64" or metadata.get("experimental") is not True:
        raise ValueError("Linux test package metadata is invalid")
    sums = (directory / "SHA256SUMS").read_text().splitlines()
    if sums != [f"{sha}  {expected_name}"]:
        raise ValueError("Linux package checksum list differs")
    sidecar = directory / f"{expected_name}.sha256"
    if sidecar.read_text().splitlines() != [f"{sha}  {expected_name}"]:
        raise ValueError("Linux package checksum sidecar differs")
    return appimage, sidecar


def publish(directory, version, source_commit, notes):
    files = candidate(directory, version, source_commit)
    tag = f"linux-v{version}-test.1"
    release = release_by_tag(tag)
    if release:
        allowed = {path.name for path in files}
        if any(asset["name"] not in allowed for asset in release["assets"]):
            raise ValueError("Unexpected existing Linux release assets; preserving release")
        for path in files:
            if any(asset["name"] == path.name for asset in release["assets"]):
                verify_assets(release, (path,))
    else:
        release = api(f"repos/{REPOSITORY}/releases", payload={
            "tag_name": tag,
            "target_commitish": "main",
            "draft": True,
            "name": f"红果短剧 Linux AppImage 测试版 {version}",
            "body": notes.read_text(),
            "prerelease": True,
        })
    if release["draft"]:
        for path in files:
            if not any(asset["name"] == path.name for asset in release["assets"]):
                verify_assets({"assets": [upload_asset(release["id"], path)]}, (path,))
        uploaded = api(f"repos/{REPOSITORY}/releases/{release['id']}")
        verify_assets(uploaded, files)
        release = api(f"repos/{REPOSITORY}/releases/{release['id']}", method="PATCH",
                      payload={"draft": False, "prerelease": True, "make_latest": "false"})
    verify_assets(release, files)
    if release["draft"] or not release["prerelease"]:
        raise ValueError("Linux test release must remain a published prerelease")
    print(f"Published Linux test package: https://github.com/{REPOSITORY}/releases/tag/{tag}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--notes", type=Path, required=True)
    args = parser.parse_args()
    try:
        publish(args.directory, args.version, args.source_commit, args.notes)
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Linux release rejected: {exc}", file=sys.stderr)
        raise SystemExit(1)
