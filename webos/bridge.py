#!/usr/bin/env python
"""Local Jellyfin audio proxy and panel control for rooted LG webOS (Python 2/3).
Server credentials remain in a mode-0600 root file, never in media URLs.
"""
from __future__ import print_function
import os, sys, json, re, time, socket, subprocess, threading, ssl, base64, shutil
try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
    from urllib.request import Request, urlopen
    from urllib.parse import urlsplit, parse_qs, urlencode
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
    from SocketServer import ThreadingMixIn
    from urllib2 import Request, urlopen
    from urlparse import urlsplit, parse_qs
    from urllib import urlencode
ROOT=os.environ.get('BLOOMEE_STATE','/var/lib/bloomee-webos')
STATE=os.path.join(ROOT,'bridge.json')
CONNECTION=os.path.join(ROOT,'connection.json')
PORT=18791
HEX=re.compile(r'^[a-fA-F0-9]{32}$')

def read(path):
    with open(path) as f:return json.load(f)

def save(path,data):
    tmp=path+'.tmp'
    with open(tmp,'w') as f:json.dump(data,f)
    os.chmod(tmp,0o600);os.rename(tmp,path)

def panel(on):
    method='turnOnScreen' if on else 'turnOffScreen'
    for prefix in ['com.webos.service.tvpower/power/','com.webos.service.tvpower/power2/','com.webos.service.tv.power/']:
        try:
            p=subprocess.Popen(['luna-send','-n','1','luna://'+prefix+method,'{}'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            timer=threading.Timer(3,p.kill);timer.start()
            out=p.communicate()[0];timer.cancel()
            result=json.loads(out.decode('utf-8'))
            if result.get('returnValue'):return {'ok':True,'screenOn':on}
        except Exception:pass
    return {'ok':False,'error':'Controllo pannello non disponibile su questo firmware'}

def route(path,query,user):
    """Return fixed Jellyfin path and bounded query; no arbitrary upstream URLs."""
    defaults={'Fields':'Overview,PrimaryImageAspectRatio','EnableImages':'true','ImageTypeLimit':'1','EnableUserData':'true'}
    limit=min(100,max(1,int(query.get('limit',['60'])[0])))
    start=min(100000,max(0,int(query.get('start',['0'])[0])))
    if path=='/api/library':
        kind=query.get('kind',['MusicAlbum'])[0]
        if kind not in ('MusicAlbum','MusicArtist','Audio','Playlist'):raise ValueError('Tipo non valido')
        defaults.update({'IncludeItemTypes':kind,'Recursive':'true','Limit':limit,'StartIndex':start,'SortBy':'SortName','SortOrder':'Ascending'})
        if query.get('search'):defaults['SearchTerm']=query['search'][0][:160]
        if query.get('favorite')==['true']:defaults['Filters']='IsFavorite'
        if query.get('parent'):
            if not HEX.match(query['parent'][0]):raise ValueError('ID non valido')
            defaults['ParentId']=query['parent'][0];defaults['SortBy']='ParentIndexNumber,IndexNumber,SortName'
        if query.get('artist'):
            if not HEX.match(query['artist'][0]):raise ValueError('ID non valido')
            defaults['ArtistIds']=query['artist'][0]
        return '/Users/'+user+'/Items',defaults
    m=re.match(r'^/api/item/([a-fA-F0-9]{32})$',path)
    if m:return '/Users/'+user+'/Items/'+m.group(1),{}
    m=re.match(r'^/image/([a-fA-F0-9]{32})$',path)
    if m:return '/Items/'+m.group(1)+'/Images/Primary',{'maxWidth':600,'quality':85}
    m=re.match(r'^/audio/([a-fA-F0-9]{32})$',path)
    if m:return '/Audio/'+m.group(1)+'/universal',{'UserId':user,'DeviceId':'bloomee-webos','Container':'mp3,aac,flac','AudioCodec':'mp3','TranscodingContainer':'mp3','TranscodingProtocol':'http','MaxStreamingBitrate':320000,'StartTimeTicks':0}
    raise ValueError('Percorso non consentito')

class Server(ThreadingMixIn,HTTPServer):
    daemon_threads=True
    allow_reuse_address=True

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.0'
    def log_message(self,*args):pass  # URLs include the local capability, so never log them.
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','null')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Cache-Control','no-store')
    def reply(self,status,data):
        raw=json.dumps(data).encode('utf-8');self.send_response(status);self.cors();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def authorized(self,query):return query.get('key',[''])[0]==self.server.key
    def do_OPTIONS(self):
        self.send_response(204);self.cors();self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.end_headers()
    def do_POST(self):
        u=urlsplit(self.path);q=parse_qs(u.query)
        if not self.authorized(q):return self.reply(403,{'error':'Accesso negato'})
        if u.path not in ('/panel/off','/panel/on'):return self.reply(404,{'error':'Percorso non valido'})
        r=panel(u.path.endswith('/on'));self.reply(200 if r['ok'] else 503,r)
    def do_GET(self):
        u=urlsplit(self.path);q=parse_qs(u.query)
        if not self.authorized(q):return self.reply(403,{'error':'Accesso negato'})
        if u.path=='/health':return self.reply(200,{'ok':True,'connected':os.path.exists(CONNECTION)})
        try:
            c=read(CONNECTION)
            if not HEX.match(c['userId']):raise ValueError('Utente non valido')
            path,args=route(u.path,q,c['userId'])
            auth='MediaBrowser Client="Bloomee webOS", Device="LG TV", DeviceId="bloomee-webos", Version="0.1.0", Token="'+c['token']+'"'
            headers={'Authorization':auth}
            if self.headers.get('Range') and u.path.startswith('/audio/'):headers['Range']=self.headers['Range'][:80]
            request=Request(c['server'].rstrip('/')+path+'?'+urlencode(args),headers=headers)
            response=urlopen(request,timeout=20)
        except Exception as e:
            status=getattr(e,'code',502)
            return self.reply(status if status in (401,403,404) else 502,{'error':'Jellyfin non disponibile. Controlla server e collegamento.'})
        try:
            self.send_response(response.getcode());self.cors()
            for name in ['Content-Type','Content-Length','Content-Range','Accept-Ranges']:
                if response.headers.get(name):self.send_header(name,response.headers[name])
            self.end_headers()
            while True:
                data=response.read(65536)
                if not data:break
                self.wfile.write(data)
        except (IOError,socket.error):pass
        finally:response.close()

def ensure():
    if not os.path.isdir(ROOT):os.makedirs(ROOT,0o700)
    os.chmod(ROOT,0o700)
    source='/var/lib/launch-home-cinema/jellyfin.json'
    if not os.path.exists(CONNECTION) and os.path.exists(source):
        shutil.copyfile(source,CONNECTION);os.chmod(CONNECTION,0o600)
    try:
        s=read(STATE)
        data=json.loads(urlopen('http://127.0.0.1:%s/health?key=%s'%(s['port'],s['key']),timeout=2).read().decode('utf-8'))
        if data.get('ok'):print(json.dumps(s));return
    except Exception:pass
    log=open(os.devnull,'wb')
    subprocess.Popen([sys.executable,os.path.abspath(__file__),'--serve'],stdin=open(os.devnull),stdout=log,stderr=log,close_fds=True,preexec_fn=os.setsid)
    for _ in range(40):
        time.sleep(.1)
        try:
            s=read(STATE)
            json.loads(urlopen('http://127.0.0.1:%s/health?key=%s'%(s['port'],s['key']),timeout=1).read().decode('utf-8'))
            print(json.dumps(s));return
        except Exception:pass
    raise RuntimeError('Bridge non avviato')

if __name__=='__main__':
    if '--serve' in sys.argv:
        server=Server(('127.0.0.1',PORT),Handler)
        server.key=base64.urlsafe_b64encode(os.urandom(24)).decode('ascii').rstrip('=')
        save(STATE,{'port':PORT,'key':server.key,'pid':os.getpid()})
        server.serve_forever()
    else:ensure()
