import importlib.util
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

generate = module('generate_update')
publish = module('publish_public_release')
metadata = module('release_metadata')

class ReleaseUpdateTests(unittest.TestCase):
    def test_draft_release_is_found_before_its_tag_exists(self):
        from types import SimpleNamespace
        old_gh, old_api = publish.gh, publish.api
        publish.gh = lambda *a, **k: SimpleNamespace(returncode=1, stdout='', stderr='HTTP 404')
        publish.api = lambda *a, **k: [{'tag_name': 'v0.2.7', 'draft': True, 'id': 12}]
        try:
            self.assertEqual(publish.release_by_tag('v0.2.7')['id'], 12)
            self.assertIsNone(publish.release_by_tag('v0.2.8'))
        finally: publish.gh, publish.api = old_gh, old_api

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.apk = self.root / 'hongguo-tv-0.2.7.apk'
        with zipfile.ZipFile(self.apk, 'w') as archive:
            archive.writestr('AndroidManifest.xml', 'binary manifest fixture')
        self.notes = self.root / 'notes.md'; self.notes.write_text('新增应用内更新')

    def manifest(self):
        return generate.generate(self.apk, '0.2.7', 9, 23, self.notes)

    def test_generated_manifest_uses_only_public_download_and_exact_apk_bytes(self):
        result = self.manifest()
        self.assertEqual(result['version_code'], 9)
        self.assertEqual(result['size'], self.apk.stat().st_size)
        self.assertEqual(result['download_url'], 'https://github.com/aston314/hongguo-tv-releases/releases/download/v0.2.7/hongguo-tv-0.2.7.apk')
        self.assertEqual(result['release_notes'], '新增应用内更新')

    def test_wrong_filename_and_broken_archive_are_rejected(self):
        with self.assertRaises(ValueError): generate.generate(self.apk, '0.2.8', 10, 23, self.notes)
        self.apk.write_bytes(b'proxy error')
        with self.assertRaises(zipfile.BadZipFile): self.manifest()

    def test_version_metadata_reads_gradle_as_single_source(self):
        (self.root / 'android/app').mkdir(parents=True)
        (self.root / 'android/app/build.gradle').write_text('def appVersion = "0.2.10"\nversionCode 12\nminSdk 23')
        self.assertEqual(metadata.metadata(self.root), ('0.2.10', 12, 23))

    def test_publication_refuses_an_apk_changed_after_generating_metadata(self):
        value = self.manifest(); (self.root / 'update.json').write_text(json.dumps(value))
        self.apk.write_bytes(b'changed')
        original = publish.api
        publish.api = lambda *a, **k: {'private': False, 'default_branch': 'main'}
        try:
            with self.assertRaises(ValueError): publish.publish(self.root, self.notes)
        finally: publish.api = original

    def test_publication_refuses_private_download_repository(self):
        original = publish.api
        publish.api = lambda *a, **k: {'private': True, 'default_branch': 'main'}
        try:
            with self.assertRaises(ValueError): publish.publish(self.root, self.notes)
        finally: publish.api = original

    def publication_fixture(self, draft=None, old_manifest=None, corrupt_upload=False):
        value = self.manifest()
        if old_manifest is True: old_manifest = value
        (self.root / 'update.json').write_text(json.dumps(value))
        (self.root / 'SHA256SUMS.txt').write_text(value['sha256'] + '  ' + self.apk.name + '\n')
        release = {'id': 42, 'tag_name': 'v0.2.7', 'draft': True, 'assets': []}
        if draft is not None:
            release['draft'] = draft
            for name in [self.apk.name, 'SHA256SUMS.txt', 'update.json']:
                path = self.root / name
                release['assets'].append({'name': name, 'size': path.stat().st_size,
                                         'digest': 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()})
        events = []
        def fake_api(path, payload=None, method=None):
            events.append((path, payload, method))
            if path == f'repos/{publish.REPOSITORY}':
                return {'private': False, 'default_branch': 'main'}
            if path == f'repos/{publish.REPOSITORY}/releases':
                self.assertTrue(payload['draft'])
                return release.copy()
            if path == f'repos/{publish.REPOSITORY}/releases/42':
                if method == 'PATCH':
                    self.assertEqual(payload, {'draft': False})
                    release['draft'] = False
                return release.copy()
            self.fail('Unexpected API endpoint: ' + path)
        def fake_gh(*args, **kwargs):
            events.append((args, kwargs))
            if args[:2] == ('api', f'repos/{publish.REPOSITORY}/contents/update.json'):
                if old_manifest is None: return SimpleNamespace(returncode=1, stderr='HTTP 404', stdout='')
                content = json.dumps(old_manifest).encode()
                return SimpleNamespace(returncode=0, stdout=json.dumps({'sha': 'old-sha', 'content': base64.b64encode(content).decode()}))
            if args[:3] == ('api', '--method', 'PUT'):
                return SimpleNamespace(returncode=0, stdout='{}')
            if args[:3] == ('api', '--method', 'POST'):
                self.assertTrue(args[3].startswith(f'https://uploads.github.com/repos/{publish.REPOSITORY}/releases/42/assets?name='))
                path = Path(args[args.index('--input') + 1])
                asset = {'name': path.name, 'size': path.stat().st_size,
                         'digest': 'sha256:' + ('0' * 64 if corrupt_upload else hashlib.sha256(path.read_bytes()).hexdigest())}
                release['assets'].append(asset)
                return SimpleNamespace(returncode=0, stdout=json.dumps(asset))
            self.fail('Unexpected gh call: ' + str(args))
        return value, release, events, fake_api, fake_gh

    def test_new_draft_uses_returned_id_and_uploads_only_three_files(self):
        _, release, events, fake_api, fake_gh = self.publication_fixture()
        (self.root / 'private-source.go').write_text('must never be uploaded')
        with patch.object(publish, 'api', fake_api), patch.object(publish, 'gh', fake_gh), \
                patch.object(publish, 'release_by_tag', return_value=None) as lookup:
            publish.publish(self.root, self.notes)
        lookup.assert_called_once_with('v0.2.7')
        self.assertFalse(release['draft'])
        self.assertEqual([a['name'] for a in release['assets']], [self.apk.name, 'SHA256SUMS.txt', 'update.json'])
        self.assertEqual(events[-1][0][:3], ('api', '--method', 'PUT'))

    def test_bad_uploaded_digest_never_publishes_or_updates_manifest(self):
        _, release, events, fake_api, fake_gh = self.publication_fixture(corrupt_upload=True)
        with patch.object(publish, 'api', fake_api), patch.object(publish, 'gh', fake_gh), \
                patch.object(publish, 'release_by_tag', return_value=None):
            with self.assertRaises(ValueError): publish.publish(self.root, self.notes)
        self.assertTrue(release['draft'])
        self.assertFalse(any(e[0][:3] == ('api', '--method', 'PUT') for e in events))

    def test_published_release_is_idempotent(self):
        _, release, events, fake_api, fake_gh = self.publication_fixture(draft=False, old_manifest=True)
        with patch.object(publish, 'api', fake_api), patch.object(publish, 'gh', fake_gh), \
                patch.object(publish, 'release_by_tag', return_value=release):
            publish.publish(self.root, self.notes)
        self.assertFalse(any(e[0][:3] in [('api', '--method', 'PUT'), ('api', '--method', 'POST')] for e in events))

    def test_published_asset_mismatch_is_preserved_and_rejected(self):
        _, release, events, fake_api, fake_gh = self.publication_fixture(draft=False)
        release['assets'][1]['digest'] = 'sha256:' + '0' * 64
        with patch.object(publish, 'api', fake_api), patch.object(publish, 'gh', fake_gh), \
                patch.object(publish, 'release_by_tag', return_value=release):
            with self.assertRaises(ValueError): publish.publish(self.root, self.notes)
        self.assertFalse(any(e[0][:3] in [('api', '--method', 'PUT'), ('api', '--method', 'POST')] for e in events))

    def test_older_release_never_regresses_latest_version(self):
        _, release, events, fake_api, fake_gh = self.publication_fixture(draft=False, old_manifest={'version_code': 10})
        with patch.object(publish, 'api', fake_api), patch.object(publish, 'gh', fake_gh), \
                patch.object(publish, 'release_by_tag', return_value=release):
            publish.publish(self.root, self.notes)
        self.assertFalse(any(e[0][:3] == ('api', '--method', 'PUT') for e in events))

    def test_draft_resume_keeps_existing_matching_assets(self):
        _, release, events, fake_api, fake_gh = self.publication_fixture(draft=True)
        release['assets'] = release['assets'][:1]
        with patch.object(publish, 'api', fake_api), patch.object(publish, 'gh', fake_gh), \
                patch.object(publish, 'release_by_tag', return_value=release):
            publish.publish(self.root, self.notes)
        self.assertEqual(len(release['assets']), 3)
        uploads = [e for e in events if e[0][:3] == ('api', '--method', 'POST')]
        self.assertEqual(len(uploads), 2)

if __name__ == '__main__': unittest.main()
