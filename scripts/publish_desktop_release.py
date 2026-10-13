#!/usr/bin/env python3
"""Mirror only verified desktop ZIPs and update metadata into the public downloads repo."""
import argparse,base64,hashlib,json,re
from pathlib import Path
from datetime import datetime,timezone
from publish_public_release import REPOSITORY,api,gh,release_by_tag,upload_asset,verify_assets
from desktop_metadata import metadata
import subprocess,sys

CHANNEL='desktop-update-v2.json'

def generate(directory,version,code,notes):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version) or type(code)!=int or code<1:raise ValueError('Invalid desktop version')
    subprocess.run([sys.executable,str(Path(__file__).with_name('verify_desktop_packages.py')),str(directory)],check=True)
    packages={}
    for platform,suffix in [('macos-universal','macos-universal'),('windows-amd64','windows-x64')]:
        path=directory/f'hongguo-desktop-{version}-{suffix}.zip'
        if not path.exists() or not 0<path.stat().st_size<=300*1024*1024:raise ValueError('Invalid desktop archive')
        packages[platform]={'name':path.name,'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
             'download_url':f'https://github.com/{REPOSITORY}/releases/download/desktop-v{version}/{path.name}'}
    text=notes.read_text().strip()
    if len(text)>16000:raise ValueError('Release notes too long')
    result={'schema':1,'product':'hongguo-desktop','version_name':version,'version_code':code,'release_notes':text,'packages':packages}
    (directory/CHANNEL).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result

def previous_channel():
    result=gh('api',f'repos/{REPOSITORY}/contents/{CHANNEL}',required=False)
    if result.returncode==0:
        value=json.loads(result.stdout);old=json.loads(base64.b64decode(value['content']))
        if old.get('product')!='hongguo-desktop' or type(old['version_code'])!=int:raise ValueError('Invalid previous desktop channel')
        return value,old
    if '404' not in result.stderr:raise RuntimeError(result.stderr.strip() or 'Cannot read desktop channel')
    return None,None

def may_update(previous,current):
    if previous is None:return True
    if previous['version_code']>current['version_code']:return False
    if previous['version_code']==current['version_code'] and previous!=current:raise ValueError('Desktop version code cannot change its published bytes')
    return True

def put_content(name,content,message):
    result=gh('api',f'repos/{REPOSITORY}/contents/{name}',required=False)
    old=None
    if result.returncode==0:old=json.loads(result.stdout)
    elif '404' not in result.stderr:raise RuntimeError(result.stderr.strip())
    if old and base64.b64decode(old['content'])==content:return
    payload={'message':message,'content':base64.b64encode(content).decode()}
    if old:payload['sha']=old['sha']
    api(f'repos/{REPOSITORY}/contents/{name}',method='PUT',payload=payload)

def publish(directory,notes,readme):
    version,code=metadata(Path(__file__).resolve().parents[1]);manifest=generate(directory,version,code,notes)
    repo=api(f'repos/{REPOSITORY}')
    if repo['private'] or repo['default_branch']!='main':raise ValueError('Downloads repo must be public/main')
    old,previous=previous_channel();may_update(previous,manifest)
    files=tuple(sorted(directory.glob('*.zip'))+sorted(directory.glob('*.sha256'))+[directory/CHANNEL])
    assert len(files)==5
    tag='desktop-v'+version;release=release_by_tag(tag)
    if release:
        allowed={p.name for p in files}
        if any(a['name'] not in allowed for a in release['assets']):raise ValueError('Unexpected existing desktop assets; preserving release')
        for p in files:
            if any(a['name']==p.name for a in release['assets']):verify_assets(release,(p,))
    else:
        release=api(f'repos/{REPOSITORY}/releases',payload={'tag_name':tag,'target_commitish':'main','draft':True,
           'name':f'红果短剧桌面版 {version}（macOS / Windows）','body':notes.read_text(),'make_latest':'false'})
    if release['draft']:
        for p in files:
            if not any(a['name']==p.name for a in release['assets']):verify_assets({'assets':[upload_asset(release['id'],p)]},(p,))
        uploaded=api(f'repos/{REPOSITORY}/releases/{release["id"]}');verify_assets(uploaded,files)
        release=api(f'repos/{REPOSITORY}/releases/{release["id"]}',method='PATCH',payload={'draft':False,'prerelease':False,'make_latest':'false'})
    verify_assets(release,files)
    if release['draft']:raise ValueError('Desktop release remains draft')
    old,previous=previous_channel()
    if may_update(previous,manifest):
        put_content(CHANNEL,(directory/CHANNEL).read_bytes(),'Publish desktop update '+tag)
        put_content('README.md',readme.read_bytes(),'Document macOS and Windows desktop downloads')
    print('Published public desktop release:',f'https://github.com/{REPOSITORY}/releases/tag/{tag}')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,required=True);p.add_argument('--notes',type=Path,required=True);p.add_argument('--readme',type=Path);p.add_argument('--generate-only',action='store_true');a=p.parse_args()
    if a.generate_only:
        version,code=metadata(Path(__file__).resolve().parents[1]);generate(a.directory,version,code,a.notes)
    else:
        if not a.readme:p.error('--readme required for publication')
        publish(a.directory,a.notes,a.readme)
