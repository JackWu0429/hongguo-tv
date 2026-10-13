import importlib.util,sys,json,tempfile,unittest,zipfile,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import publish_desktop_release as release
import desktop_metadata
import unittest.mock

class DesktopReleaseTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.notes=self.root/'notes.md';self.notes.write_text('下载 ZIP 自行替换')
  for suffix,files in [('macos-universal',{'红果短剧.app/Contents/MacOS/红果短剧':b'\xca\xfe\xba\xbeapp','红果短剧.app/Contents/MacOS/hongguo-tv-core':b'\xca\xfe\xba\xbecore','红果短剧.app/Contents/Info.plist':b'plist'}),('windows-x64',{'红果短剧.exe':b'MZapp','hongguo-tv-core.exe':b'MZcore','README.txt':b'notes'})]:
   p=self.root/f'hongguo-desktop-0.2.59-{suffix}.zip'
   with zipfile.ZipFile(p,'w') as z:
    for n,b in files.items():z.writestr(n,b)
   (self.root/(p.name+'.sha256')).write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n')
 def test_manifest_keeps_desktop_and_android_separate(self):
  m=release.generate(self.root,'0.2.59',1,self.notes)
  self.assertEqual(m['product'],'hongguo-desktop');self.assertEqual(set(m['packages']),{'macos-universal','windows-amd64'})
  for p in m['packages'].values():self.assertIn('/desktop-v0.2.59/',p['download_url']);self.assertTrue(p['name'].endswith('.zip'))
 def test_modified_package_and_missing_platform_fail_before_publication(self):
  p=self.root/'hongguo-desktop-0.2.59-windows-x64.zip';p.write_bytes(b'bad')
  with unittest.mock.patch.object(release.subprocess,'run',wraps=release.subprocess.run) as run:
   original=run._mock_wraps
   run.side_effect=lambda *a,**k:original(*a,**dict(k,capture_output=True))
   with self.assertRaises(Exception):release.generate(self.root,'0.2.59',1,self.notes)
 def test_same_code_cannot_replace_bytes_or_downgrade_channel(self):
  m=release.generate(self.root,'0.2.59',1,self.notes)
  self.assertTrue(release.may_update(m,m));bad=dict(m,release_notes='changed')
  with self.assertRaises(ValueError):release.may_update(m,bad)
  self.assertFalse(release.may_update(dict(m,version_code=2),m))
 def test_desktop_identity_is_independent_of_gradle(self):
  (self.root/'desktop').mkdir();(self.root/'desktop/release.json').write_text('{"version_name":"0.2.59","version_code":1}')
  self.assertEqual(desktop_metadata.metadata(self.root),('0.2.59',1))
  (self.root/'desktop/release.json').write_text('{"version_name":"0.2.59","version_code":true}')
  with self.assertRaises(ValueError):desktop_metadata.metadata(self.root)

if __name__=='__main__':unittest.main()
