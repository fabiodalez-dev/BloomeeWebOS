import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const source=path.dirname(fileURLToPath(import.meta.url));
const output=path.resolve(process.argv[2]||path.join(source,'../../release-webos'));
const packager=process.argv[3]||'ares-package';
const runtime=['appinfo.json','index.html','app.js','style.css','icon.png','placeholder.svg','bridge.py','BaseHTTPServer.py','SocketServer.py','PYTHON-LICENSE.txt','restore.py'];
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'bloomee-webos-'));
try{
 for(const file of runtime)fs.copyFileSync(path.join(source,file),path.join(staging,file));
 fs.mkdirSync(output,{recursive:true});
 execFileSync(packager,[staging,'-o',output],{stdio:'inherit'});
}finally{fs.rmSync(staging,{recursive:true,force:true});}
