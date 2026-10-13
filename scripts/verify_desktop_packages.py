#!/usr/bin/env python3
"""Verify release ZIP/checksum pairs and both shell/core entries before publication."""
from pathlib import Path
import hashlib
import sys
import zipfile

root=Path(sys.argv[1]); archives=sorted(root.glob('*.zip'))
assert len(archives)==2, 'Expected exactly macOS and Windows ZIPs'
assert len(list(root.glob('*.sha256')))==2
platforms=set()
for archive in archives:
    expected=(root/(archive.name+'.sha256')).read_text().strip().split()
    assert len(expected)==2 and expected[1]==archive.name
    digest=hashlib.sha256(archive.read_bytes()).hexdigest(); assert digest==expected[0]
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        names=set(z.namelist())
        if archive.name.endswith('-macos-universal.zip'):
            platforms.add('macos')
            for name in ['hongguo-desktop.app/Contents/MacOS/hongguo-desktop','hongguo-desktop.app/Contents/MacOS/hongguo-tv-core','hongguo-desktop.app/Contents/Info.plist']:
                assert name in names and z.getinfo(name).file_size>0
            for name in ['hongguo-desktop.app/Contents/MacOS/hongguo-desktop','hongguo-desktop.app/Contents/MacOS/hongguo-tv-core']:
                assert z.read(name)[:4]==b'\xca\xfe\xba\xbe', 'macOS executable must be universal'
        elif archive.name.endswith('-windows-x64.zip'):
            platforms.add('windows')
            for name in ['hongguo-desktop.exe','hongguo-tv-core.exe','README.txt']:
                assert name in names and z.getinfo(name).file_size>0
            for name in ['hongguo-desktop.exe','hongguo-tv-core.exe']:
                assert z.read(name)[:2]==b'MZ', 'Windows executable missing PE header'
        else: raise AssertionError('Unknown package')
    print(archive.name,archive.stat().st_size,digest)
assert platforms=={'macos','windows'}
