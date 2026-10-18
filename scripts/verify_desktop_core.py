#!/usr/bin/env python3
"""Smoke-test the exact bundled native core without touching real accounts."""
from pathlib import Path
import json, os, secrets, subprocess, sys, tempfile, urllib.request

executable=Path(sys.argv[1]).resolve();expected_version=sys.argv[2];instance=secrets.token_hex(16)
with tempfile.TemporaryDirectory(prefix='hongguo-desktop-smoke-') as temp:
    env=dict(os.environ,MINIREEL_CACHE_DIR=str(Path(temp)/'cache'))
    process=subprocess.Popen([str(executable),'-port','0','-instance-id',instance,'-data-dir',str(Path(temp)/'data'),'-parent-pid',str(os.getpid())],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    try:
        ready=process.stdout.readline().strip().split()
        assert len(ready)==3 and ready[0]=='HONGGUO_TV_READY' and ready[2]==instance
        port=int(ready[1]);assert 0<port<65536
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base='http://127.0.0.1:'+str(port)
        with opener.open(base+'/api/v1/status',timeout=10) as response:status=json.load(response)
        assert status['ok'] and status['version']==expected_version and status['instance_id']==instance
        for route in ['/api/v1/account','/api/v1/library','/api/v1/search-history']:
            with opener.open(base+route,timeout=10) as response:data=json.load(response)
            assert data['ok'],route
        print('Bundled core verified:',expected_version,sys.platform)
    finally:
        process.kill();process.wait(timeout=10);process.stdout.close()
