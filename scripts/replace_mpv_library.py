#!/usr/bin/env python3
"""Replace ABI-matched libmpv.so, then align/sign with the user's own key."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import zipfile

ABIS = ('arm64-v8a', 'armeabi-v7a', 'x86_64')
def replace(apk, libraries, output):
    if output.exists() or apk.resolve() == output.resolve(): raise ValueError('Use a new output path')
    replacements = {}
    for abi, elf_class, machine in [('arm64-v8a', 2, 183), ('armeabi-v7a', 1, 40), ('x86_64', 2, 62)]:
        data = (libraries / abi / 'libmpv.so').read_bytes()
        if len(data) < 20 or data[:4] != b'\x7fELF' or data[4:6] != bytes([elf_class, 1]) or int.from_bytes(data[18:20], 'little') != machine:
            raise ValueError('Replacement ELF architecture differs: ' + abi)
        replacements[f'lib/{abi}/libmpv.so'] = data
    with zipfile.ZipFile(apk) as original:
        if len(original.namelist()) != len(set(original.namelist())) or not set(replacements).issubset(original.namelist()):
            raise ValueError('APK is not a complete MPV edition')
        with zipfile.ZipFile(output, 'x') as changed:
            for info in original.infolist():
                if info.filename.startswith('META-INF/'): continue
                changed.writestr(info, replacements.get(info.filename, original.read(info.filename)))

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--apk', type=Path, required=True); p.add_argument('--libraries', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True); p.add_argument('--build-tools', type=Path, required=True)
    p.add_argument('--keystore', type=Path, required=True); p.add_argument('--alias', required=True)
    a = p.parse_args()
    if a.out.exists(): raise ValueError('Output exists')
    with tempfile.TemporaryDirectory() as folder:
        unsigned = Path(folder) / 'unsigned.apk'; aligned = Path(folder) / 'aligned.apk'
        replace(a.apk, a.libraries, unsigned)
        subprocess.run([str(a.build_tools/'zipalign'), '-f','-p','4',str(unsigned),str(aligned)],check=True)
        # apksigner prompts for passwords; no private key/password is included.
        subprocess.run([str(a.build_tools/'apksigner'),'sign','--ks',str(a.keystore),'--ks-key-alias',a.alias,'--out',str(a.out),str(aligned)],check=True)
        subprocess.run([str(a.build_tools/'apksigner'),'verify','--verbose',str(a.out)],check=True)
