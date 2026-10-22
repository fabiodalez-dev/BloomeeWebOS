#!/usr/bin/env python
"""Remove only Bloomee webOS and its private connection. Run as root on the TV."""
from __future__ import print_function
import os, json, signal, shutil, subprocess
root='/var/lib/bloomee-webos'
try:
    state=json.load(open(root+'/bridge.json'))
    pid=int(state.get('pid',0))
    command=open('/proc/%s/cmdline'%pid,'rb').read()
    if b'/org.bloomee.webos/bridge.py' in command:
        os.kill(pid,signal.SIGTERM)
except Exception:pass
for prefix in ['com.webos.service.tvpower/power/','com.webos.service.tvpower/power2/','com.webos.service.tv.power/']:
    try:
        out=subprocess.check_output(['luna-send','-n','1','luna://'+prefix+'turnOnScreen','{}'])
        if json.loads(out.decode('utf-8')).get('returnValue'):break
    except Exception:pass
subprocess.call(['luna-send','-n','1','luna://com.webos.applicationManager/closeByAppId','{"id":"org.bloomee.webos"}'])
if os.path.isdir(root):shutil.rmtree(root)
print('Private Bloomee state removed. Uninstall Bloomee from the normal LG app list.')
