#!/usr/bin/env python3
"""Read the APK version once so builds, filenames and update manifests agree."""
import argparse
import os
from pathlib import Path
import re

def metadata(root):
    source = (root / 'android/app/build.gradle').read_text()
    version = re.search(r'def appVersion = "([0-9]+\.[0-9]+\.[0-9]+)"', source).group(1)
    code = int(re.search(r'\bversionCode\s+(\d+)', source).group(1))
    sdk = int(re.search(r'\bminSdk\s+(\d+)', source).group(1))
    return version, code, sdk

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--github-env', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    version, code, sdk = metadata(root)
    sha = os.environ['GITHUB_SHA']
    assert re.fullmatch(r'[a-f0-9]{40}', sha)
    with args.github_env.open('a') as output:
        output.write(f'APP_VERSION={version}\nAPP_VERSION_CODE={code}\nAPP_MIN_SDK={sdk}\nHONGGUO_CORE_VERSION={version}-{sha}\n')
    print(f'Build version {version}, code {code}, minimum SDK {sdk}')
