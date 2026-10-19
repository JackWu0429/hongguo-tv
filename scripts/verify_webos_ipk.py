#!/usr/bin/env python3
"""Verify the app and JavaScript Service entry points inside a webOS IPK."""

import json
import re
import sys
import tarfile
from io import BytesIO
from pathlib import Path


def fail(message):
    raise SystemExit("webOS IPK verify: " + message)


def ar_members(path):
    raw = Path(path).read_bytes()
    if not raw.startswith(b"!<arch>\n"):
        fail("not an ar/IPK archive")
    offset = 8
    members = {}
    while offset < len(raw):
        header = raw[offset : offset + 60]
        if len(header) != 60 or header[58:60] != b"`\n":
            fail("invalid ar member header")
        name = header[:16].decode("ascii").strip().rstrip("/")
        try:
            size = int(header[48:58].decode("ascii").strip())
        except ValueError:
            fail("invalid ar member size")
        offset += 60
        members[name] = raw[offset : offset + size]
        offset += size + (size & 1)
    return members


def read_tar_member(archive, suffix):
    with tarfile.open(fileobj=BytesIO(archive), mode="r:gz") as package:
        matches = [member for member in package.getmembers() if member.name.endswith(suffix)]
        if len(matches) != 1:
            fail("expected exactly one " + suffix + " in package")
        stream = package.extractfile(matches[0])
        if stream is None:
            fail("could not read " + suffix)
        return stream.read(), package, matches[0].name


def main():
    if len(sys.argv) != 2:
        fail("usage: verify_webos_ipk.py path/to/app.ipk")
    members = ar_members(sys.argv[1])
    if "data.tar.gz" not in members:
        fail("IPK has no data.tar.gz")
    appinfo_raw, _, appinfo_path = read_tar_member(members["data.tar.gz"], "/appinfo.json")
    packageinfo_raw, _, packageinfo_path = read_tar_member(members["data.tar.gz"], "/packageinfo.json")
    service_package_raw, _, service_package_path = read_tar_member(members["data.tar.gz"], "/services/com.aston314.hongguo.webos.service/package.json")
    services_raw, _, services_path = read_tar_member(members["data.tar.gz"], "/services/com.aston314.hongguo.webos.service/services.json")
    appinfo = json.loads(appinfo_raw)
    packageinfo = json.loads(packageinfo_raw)
    service_package = json.loads(service_package_raw)
    services_manifest = json.loads(services_raw)
    if appinfo.get("id") != "com.aston314.hongguo.webos":
        fail("unexpected app id")
    if service_package.get("name") != "com.aston314.hongguo.webos.service":
        fail("service package id mismatch")
    if service_package.get("main") != "service.js":
        fail("service package main must be service.js")
    if service_package.get("version") != appinfo.get("version"):
        fail("service package version must match app version")
    service_definitions = services_manifest.get("services", [])
    service_definition = next((entry for entry in service_definitions if entry.get("name") == "com.aston314.hongguo.webos.service"), None)
    if service_definition is None:
        fail("services.json does not define the app service")
    commands = {entry.get("name"): entry for entry in service_definition.get("commands", [])}
    for command in ("ping", "getDiagnostics", "shutdown"):
        if command not in commands or commands[command].get("public") is not True:
            fail("services.json command must be declared public: " + command)
    service_path = service_package_path.rsplit("/", 1)[0] + "/service.js"
    app_root = appinfo_path.rsplit("/", 1)[0]
    names = set()
    with tarfile.open(fileobj=BytesIO(members["data.tar.gz"]), mode="r:gz") as package:
        names = {entry.name for entry in package.getmembers()}
        app_index_path = app_root + "/" + appinfo.get("main", "")
        if app_index_path not in names:
            fail("app main file is missing from package")
        if service_path not in names:
            fail("service main file is missing from package")
        index_stream = package.extractfile(app_index_path)
        if index_stream is None:
            fail("could not read packaged app main")
        index = index_stream.read().decode("utf-8")
        adapter = app_root + "/webos-adapter.js"
        if adapter not in names:
            fail("webOS adapter is missing from package")
        webos_tv = app_root + "/webOSTVjs-1.2.13/webOSTV.js"
        if webos_tv not in names:
            fail("official webOSTV.js library is missing from package")
        webos_tv_license = app_root + "/webOSTVjs-1.2.13/LICENSE-2.0.txt"
        if webos_tv_license not in names:
            fail("webOSTV.js license is missing from package")
        if index.find('src="./webOSTVjs-1.2.13/webOSTV.js"') < 0 or index.find('src="./webos-adapter.js"') < 0 or index.find('src="./webOSTVjs-1.2.13/webOSTV.js"') > index.find('src="./webos-adapter.js"') or index.find('src="./webos-adapter.js"') > index.find('src="./compat.js"'):
            fail("webOSTV.js and webOS adapter must load before shared UI scripts")
        adapter_stream = package.extractfile(adapter)
        if adapter_stream is None:
            fail("could not read packaged webOS adapter")
        adapter = adapter_stream.read().decode("utf-8")
        if "getDiagnostic" not in adapter or "/api/v1/health" not in adapter or "HEALTH_NOT_READY" not in adapter:
            fail("packaged adapter must verify HTTP readiness and expose diagnostics")
        version_pattern = r"appVersion\s*:\s*['\"]" + re.escape(str(appinfo.get("version", ""))) + r"['\"]"
        if re.search(version_pattern, adapter) is None:
            fail("packaged adapter app version must match appinfo.json")
        if 'id="core-connection-modal"' not in index or 'id="core-connection-retry"' not in index or 'id="core-connection-close"' not in index:
            fail("packaged UI must include the connection diagnostic modal and actions")
    services = packageinfo.get("services", [])
    if "com.aston314.hongguo.webos.service" not in services:
        fail("package does not register the HTTP service")
    print("webOS IPK verify: PASS")
    print(json.dumps({"appId": appinfo["id"], "version": appinfo["version"], "serviceMain": service_package["main"], "serviceCommands": sorted(commands), "members": len(names)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
