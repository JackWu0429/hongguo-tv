#!/usr/bin/env python3
"""Stage hash-pinned LGPL libmpv and build only our MIT JNI bridge in GitHub CI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NDK_VERSION = '27.2.12479018'
BASE = 'https://github.com/media-kit/libmpv-android-video-build/releases/download/v1.1.11/'
LIBRARIES = {
    'arm64-v8a': '2a906875af68be8c98c4a83c236bc24053f46e0accf62b115993ef1d740e98cc',
    'armeabi-v7a': 'a9926cb4f8f42032769d411390b812f08a10a8048c67518e1e325803468da047',
    'x86_64': 'afe9aed06498a04b9b9655b0ad812dd29f864dcb6f735ab7df3900082bcb713d',
}
HEADER_URL = 'https://raw.githubusercontent.com/mpv-player/mpv/78d43740f52db817d98bcf24fb30a76ab6fa13ff/libmpv/client.h'
HEADER_SHA = 'f46da37538ad97d67cb1d12ea2f4291f577a7faaf7a0df460f12e43588206e21'

def fetch(url, digest, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == digest:
        return path
    data = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                data = response.read()
            break
        except OSError:
            if attempt == 2: raise
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Dependency SHA256 mismatch: ' + path.name)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_bytes(data); temporary.replace(path)
    return path

def prepare(cache, compile_bridge=True):
    header = fetch(HEADER_URL, HEADER_SHA, ROOT / 'android/mpv-jni/include/mpv/client.h')
    out = ROOT / 'android/app/src/mpv/jniLibs'
    for abi, digest in LIBRARIES.items():
        archive = fetch(BASE + f'default-{abi}.jar', digest, cache / f'default-{abi}.jar')
        destination = out / abi; destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as jar:
            # The media-kit helper and GPL flavor are deliberately excluded.
            data = jar.read(f'lib/{abi}/libmpv.so')
        if not data.startswith(b'\x7fELF'): raise ValueError('Invalid libmpv ELF')
        (destination / 'libmpv.so').write_bytes(data)
    if compile_bridge:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise RuntimeError('Android APK/native builds run only in GitHub Actions')
        sdk = Path(os.environ['ANDROID_HOME'])
        toolchain = sdk / 'ndk' / NDK_VERSION / 'toolchains/llvm/prebuilt/linux-x86_64/bin'
        triples = {'arm64-v8a': 'aarch64-linux-android', 'armeabi-v7a': 'armv7a-linux-androideabi', 'x86_64': 'x86_64-linux-android'}
        for abi, triple in triples.items():
            destination = out / abi
            subprocess.run([str(toolchain / (triple + '23-clang++')), '-std=c++17', '-O2', '-fPIC', '-shared',
                '-static-libstdc++', '-Wl,--no-undefined', '-Wl,-z,max-page-size=16384',
                '-I' + str(header.parent.parent), str(ROOT / 'android/mpv-jni/bridge.cpp'),
                '-L' + str(destination), '-lmpv', '-o', str(destination / 'libhongguompv.so')], check=True)
            subprocess.run([str(toolchain / 'llvm-strip'), '--strip-unneeded', str(destination / 'libhongguompv.so')], check=True)
    print('Staged LGPL libmpv default v1.1.11 for ' + ', '.join(LIBRARIES))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=ROOT / 'tmp/mpv-deps')
    parser.add_argument('--download-only', action='store_true')
    args = parser.parse_args()
    prepare(args.cache, not args.download_only)
