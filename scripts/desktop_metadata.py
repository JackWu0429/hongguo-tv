#!/usr/bin/env python3
"""Desktop-only release identity; never advances Android APK channels."""
import argparse,json,os,re
from pathlib import Path

def metadata(root):
    value=json.loads((root/'desktop/release.json').read_text())
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',value['version_name']) or type(value['version_code'])!=int or value['version_code']<1:
        raise ValueError('Invalid desktop release identity')
    return value['version_name'],value['version_code']

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--github-env',type=Path,required=True);a=p.parse_args()
    version,code=metadata(Path(__file__).resolve().parents[1]);sha=os.environ['GITHUB_SHA'];assert re.fullmatch('[a-f0-9]{40}',sha)
    with a.github_env.open('a') as f:f.write(f'APP_VERSION={version}\nDESKTOP_VERSION_CODE={code}\nHONGGUO_CORE_VERSION={version}-{sha}\n')
    print('Desktop version',version,'code',code)
