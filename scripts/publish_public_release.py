#!/usr/bin/env python3
"""Publish only allowlisted release files. Never upload the source checkout."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

REPOSITORY = 'aston314/hongguo-tv-releases'

def gh(*args, payload=None, required=True):
    command = ['gh', *args]
    if payload is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=None if payload is None else json.dumps(payload),
                            capture_output=True, text=True, check=False)
    if required and result.returncode:
        raise RuntimeError(result.stderr.strip() or 'GitHub publication failed')
    return result

def api(path, **kwargs):
    return json.loads(gh('api', path, **kwargs).stdout)

def release_by_tag(tag):
    result = gh('api', f'repos/{REPOSITORY}/releases/tags/{tag}', required=False)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if '404' not in result.stderr:
        raise RuntimeError(result.stderr.strip() or 'Cannot read release')
    # A draft's tag may not exist until publication. Resolve it from drafts,
    # then use its release ID rather than requiring the future Git tag.
    return next((r for r in api(f'repos/{REPOSITORY}/releases?per_page=100') if r['tag_name'] == tag), None)

def publish(directory, notes):
    repo = api(f'repos/{REPOSITORY}')
    if repo['private'] or repo['default_branch'] != 'main':
        raise ValueError('Download repository must be public with a main branch')
    manifest_path = directory / 'update.json'
    manifest = json.loads(manifest_path.read_text())
    version = manifest['version_name']; tag = f'v{version}'
    apk = directory / f'hongguo-tv-{version}.apk'
    sums = directory / 'SHA256SUMS.txt'
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    if digest != manifest['sha256'] or apk.stat().st_size != manifest['size']:
        raise ValueError('APK differs from update manifest')
    if sums.read_text().split() != [digest, apk.name]:
        raise ValueError('SHA256SUMS differs from APK')
    if manifest['download_url'] != f'https://github.com/{REPOSITORY}/releases/download/{tag}/{apk.name}':
        raise ValueError('Manifest points outside the public release')
    release = release_by_tag(tag)
    if release is None:
        gh('release', 'create', tag, '--repo', REPOSITORY, '--draft', '--title', f'红果短剧 {tag}', '--notes-file', str(notes))
    else:
        if not release['draft']:
            asset = next((a for a in release['assets'] if a['name'] == apk.name), None)
            if asset is None or asset.get('digest') != 'sha256:' + digest:
                raise ValueError('An existing published release differs; preserving its assets')
    current = release_by_tag(tag)
    if current is None:
        raise RuntimeError('Created release is not readable with the publication token')
    if current['draft']:
        gh('release', 'upload', tag, str(apk), str(sums), str(manifest_path), '--repo', REPOSITORY, '--clobber')
        uploaded = api(f'repos/{REPOSITORY}/releases/{current["id"]}')
        asset = next(a for a in uploaded['assets'] if a['name'] == apk.name)
        if asset.get('digest') != 'sha256:' + digest:
            raise ValueError('Uploaded GitHub asset digest differs')
        gh('release', 'edit', tag, '--repo', REPOSITORY, '--draft=false')
    old_result = gh('api', f'repos/{REPOSITORY}/contents/update.json', required=False)
    payload = {'message': f'Publish Android update {tag}', 'content': base64.b64encode(manifest_path.read_bytes()).decode()}
    if old_result.returncode == 0:
        old = json.loads(old_result.stdout)
        previous = json.loads(base64.b64decode(old['content']))
        if previous['version_code'] > manifest['version_code']:
            print('Newer update metadata already published; kept it unchanged')
            return
        if previous['version_code'] == manifest['version_code'] and previous['sha256'] != digest:
            raise ValueError('Refusing to change APK bytes for an existing versionCode')
        payload['sha'] = old['sha']
    gh('api', '--method', 'PUT', f'repos/{REPOSITORY}/contents/update.json', payload=payload)
    print(f'Published {tag}: https://github.com/{REPOSITORY}/releases/tag/{tag}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--notes', type=Path, required=True)
    args = parser.parse_args()
    publish(args.directory, args.notes)
