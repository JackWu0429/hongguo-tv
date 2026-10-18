#!/usr/bin/env python3
"""Unpack supplied sources and apply default-flavor patches without network clones."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tarfile

def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive) as source:
        # Python 3.12+ data filter rejects traversal and escaping links.
        source.extractall(destination, filter='data')
    children = list(destination.iterdir())
    if len(children) != 1 or not children[0].is_dir(): raise ValueError('Unexpected source archive root')
    root = children[0]
    for item in root.iterdir(): shutil.move(str(item), destination / item.name)
    root.rmdir()

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--kit', type=Path, required=True, help='Unzipped source kit root')
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    extract(a.kit/'sources/builder.tar.gz', a.out)
    scripts = a.out/'buildscripts'; deps = scripts/'deps'; deps.mkdir()
    for archive in sorted((a.kit/'sources').glob('*.tar.gz')):
        if archive.stem == 'builder.tar': continue
        name = archive.name.removesuffix('.tar.gz')
        if name == 'dlg': continue
        extract(archive, deps/name)
    # Included for the optional FreeType logging implementation.
    dlg = deps/'freetype/subprojects/dlg'
    if dlg.exists(): dlg.rmdir()
    extract(a.kit/'sources/dlg.tar.gz', dlg)
    for folder in sorted((scripts/'patches').iterdir()):
        if folder.name not in ('ffmpeg','mpv'): continue
        for patch in sorted(folder.glob('*.patch')):
            subprocess.run(['git','apply',str(patch.resolve())],cwd=deps/folder.name,check=True)
    shutil.copyfile(scripts/'flavors/default.sh', scripts/'scripts/ffmpeg.sh')
    print('Prepared exact sources/default patches. See docs/mpv-library-source.md for toolchain and build commands.')
