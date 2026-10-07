import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

generate = module('generate_update')
publish = module('publish_public_release')
metadata = module('release_metadata')

class ReleaseUpdateTests(unittest.TestCase):
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

if __name__ == '__main__': unittest.main()
