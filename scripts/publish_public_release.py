#!/usr/bin/env python3
"""Publish only allowlisted release files. Never upload the source checkout."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import quote

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

def api(path, method=None, **kwargs):
    args = ['api', path]
    if method is not None:
        args += ['--method', method]
    return json.loads(gh(*args, **kwargs).stdout)

def release_by_tag(tag):
    result = gh('api', f'repos/{REPOSITORY}/releases/tags/{tag}', required=False)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if '404' not in result.stderr:
        raise RuntimeError(result.stderr.strip() or 'Cannot read release')
    # A draft's tag may not exist until publication. Resolve it from drafts,
    # then use its release ID rather than requiring the future Git tag.
    return next((r for r in api(f'repos/{REPOSITORY}/releases?per_page=100') if r['tag_name'] == tag), None)

def upload_asset(release_id, path):
    # Keep authentication in gh. The upload host and repository are fixed;
    # do not follow an upload_url obtained from arbitrary metadata.
    endpoint = f'https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets?name={quote(path.name)}'
    return json.loads(gh('api', '--method', 'POST', endpoint,
                         '--header', 'Content-Type: application/octet-stream',
                         '--input', str(path)).stdout)

def verify_assets(release, files):
    assets = {asset['name']: asset for asset in release['assets']}
    for path in files:
        asset = assets.get(path.name)
        digest = 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
        if asset is None or asset.get('digest') != digest or asset.get('size') != path.stat().st_size:
            raise ValueError(f'Published asset differs: {path.name}; preserving existing files')

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
    files = (apk, sums, manifest_path)
    release = release_by_tag(tag)
    if release is None:
        # POST returns the authoritative ID even before draft/tag discovery
        # catches up. Retain that ID for uploads and publication.
        release = api(f'repos/{REPOSITORY}/releases', payload={
            'tag_name': tag, 'target_commitish': 'main', 'draft': True,
            'name': f'红果短剧 {tag}', 'body': notes.read_text()})
    if release['draft']:
        assets = {asset['name']: asset for asset in release['assets']}
        for path in files:
            asset = assets.get(path.name)
            if asset is None:
                asset = upload_asset(release['id'], path)
            verify_assets({'assets': [asset]}, (path,))
        # Re-read by ID to verify the complete upload before making it public.
        uploaded = api(f'repos/{REPOSITORY}/releases/{release["id"]}')
        verify_assets(uploaded, files)
        release = api(f'repos/{REPOSITORY}/releases/{release["id"]}',
                      payload={'draft': False}, method='PATCH')
    verify_assets(release, files)
    if release['draft']:
        raise RuntimeError('Release remains a draft; update metadata was not changed')
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
        if base64.b64decode(old['content']) == manifest_path.read_bytes():
            print(f'{tag} is already published with matching files and metadata')
            return
        payload['sha'] = old['sha']
    gh('api', '--method', 'PUT', f'repos/{REPOSITORY}/contents/update.json', payload=payload)
    print(f'Published {tag}: https://github.com/{REPOSITORY}/releases/tag/{tag}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--notes', type=Path, required=True)
    args = parser.parse_args()
    publish(args.directory, args.notes)
