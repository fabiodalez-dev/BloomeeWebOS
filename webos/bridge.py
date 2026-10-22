#!/usr/bin/env python
"""Local Jellyfin and YouTube Music proxy and panel control for rooted LG webOS (Python 2/3).
Server credentials and Google cookies remain in mode-0600 root files, never in media URLs.
"""
from __future__ import print_function
import os, sys, json, re, time, socket, subprocess, threading, ssl, base64, shutil, hashlib, signal
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
YOUTUBE=os.path.join(ROOT,'youtube.json')
PORT=18791
VERSION=2
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

# YouTube Music: the same InnerTube web protocol as the Android TV client.
YT_ORIGIN='https://music.youtube.com'
YT_VERSION='1.20261020.10.00'
YT_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
YT_ENDPOINTS=('search','browse','next','account/account_menu')
YT_FIELDS=('query','params','continuation','browseId','videoId','playlistId')
# Clients whose player responses carry direct, unsigned audio URLs. The first
# one that answers is used; a refused stream falls through to the next.
YT_PLAYERS=[
    ({'clientName':'IOS','clientVersion':'20.10.4','deviceMake':'Apple','deviceModel':'iPhone16,2','osName':'iPhone','osVersion':'18.3.2.22D82'},
     'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)','5'),
    ({'clientName':'ANDROID_VR','clientVersion':'1.65.10','deviceMake':'Oculus','deviceModel':'Quest 3','androidSdkVersion':32,'osName':'Android','osVersion':'12L'},
     'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip','28'),
]
# AAC first: every webOS media pipeline plays it. The alternative order, Opus
# first, is requested by the app when the TV refuses the AAC stream.
YT_ITAGS=(140,141,251,250,249,139)
YT_ITAGS_ALT=(251,250,249,140,141,139)
streams={}
streams_lock=threading.Lock()

def youtube_account():
    try:
        a=read(YOUTUBE)
        return a if isinstance(a,dict) and a.get('cookie') else None
    except Exception:return None

def sapisid(cookie):
    for part in cookie.split(';'):
        kv=part.strip().split('=',1)
        if len(kv)==2 and kv[0] in ('SAPISID','__Secure-3PAPISID'):return kv[1]
    return None

def yt_body(endpoint,data,account):
    """Bounded InnerTube body: fixed endpoints and fields, context set here."""
    if endpoint not in YT_ENDPOINTS:raise ValueError('Percorso non consentito')
    if not isinstance(data,dict):raise ValueError('Richiesta non valida')
    body={}
    for k in YT_FIELDS:
        v=data.get(k)
        if v is None:continue
        if not isinstance(v,type(u'')) and not isinstance(v,str):raise ValueError('Richiesta non valida')
        if len(v)>8000:raise ValueError('Richiesta non valida')
        body[k]=v
    client={'clientName':'WEB_REMIX','clientVersion':YT_VERSION,'hl':'it','gl':'IT'}
    account=account or {}
    if account.get('visitorData'):client['visitorData']=account['visitorData']
    body['context']={'client':client}
    delegated=(account.get('dataSyncId') or '').split('||')[0]
    if delegated:body['context']['user']={'onBehalfOfUser':delegated}
    query={'prettyPrint':'false'}
    # Legacy "nextContinuationData" tokens travel in the query string.
    if data.get('legacy') and body.get('continuation'):
        token=body.pop('continuation');query.update({'ctoken':token,'continuation':token,'type':'next'})
    return body,query

def yt_headers(account,now=None):
    h={'Content-Type':'application/json','User-Agent':YT_UA,'Origin':YT_ORIGIN,'X-Origin':YT_ORIGIN,'Referer':YT_ORIGIN+'/',
       'X-Goog-AuthUser':'0','X-YouTube-Client-Name':'67','X-YouTube-Client-Version':YT_VERSION}
    account=account or {}
    if account.get('visitorData'):h['X-Goog-Visitor-Id']=account['visitorData']
    sap=sapisid(account.get('cookie',''))
    if sap:
        ts=str(int(now or time.time()))
        h['Cookie']=account['cookie']
        h['Authorization']='SAPISIDHASH '+ts+'_'+hashlib.sha1((ts+' '+sap+' '+YT_ORIGIN).encode('utf-8')).hexdigest()
    return h

def yt_api(endpoint,data):
    account=youtube_account()
    body,query=yt_body(endpoint,data,account)
    request=Request(YT_ORIGIN+'/youtubei/v1/'+endpoint+'?'+urlencode(query),data=json.dumps(body).encode('utf-8'),headers=yt_headers(account))
    response=urlopen(request,timeout=25)
    try:return response.read()
    finally:response.close()

def pick_audio(player,alt=False):
    formats=[f for f in (player.get('streamingData') or {}).get('adaptiveFormats') or [] if f.get('url') and str(f.get('mimeType','')).startswith('audio/')]
    for itag in (YT_ITAGS_ALT if alt else YT_ITAGS):
        for f in formats:
            if f.get('itag')==itag:return f
    return formats[0] if formats else None

def resolve(video,skip=(),alt=False):
    """Direct audio URL for a video, cached until shortly before it expires."""
    key=(video,alt)
    with streams_lock:
        hit=streams.get(key)
        if hit and hit['expire']>time.time() and hit['client'] not in skip:return hit
    reason=None
    for client,ua,number in YT_PLAYERS:
        if client['clientName'] in skip:continue
        c=dict(client);c.update({'hl':'it','gl':'IT'})
        body={'context':{'client':c},'videoId':video,'contentCheckOk':True,'racyCheckOk':True}
        try:
            r=urlopen(Request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false',data=json.dumps(body).encode('utf-8'),
                headers={'Content-Type':'application/json','User-Agent':ua,'X-YouTube-Client-Name':number,'X-YouTube-Client-Version':client['clientVersion']}),timeout=20)
            try:player=json.loads(r.read().decode('utf-8'))
            finally:r.close()
        except Exception:continue
        status=player.get('playabilityStatus') or {}
        if status.get('status')!='OK':
            reason=status.get('reason') or reason;continue
        f=pick_audio(player,alt)
        if not f:continue
        m=re.search(r'[?&]expire=(\d+)',f['url'])
        hit={'url':f['url'],'ua':ua,'client':client['clientName'],'expire':(int(m.group(1)) if m else time.time()+3600)-300}
        with streams_lock:
            if len(streams)>60:streams.clear()
            streams[key]=hit
        return hit
    raise LookupError(reason or 'Brano YouTube non disponibile')

def forget(video,alt=False):
    with streams_lock:streams.pop((video,alt),None)

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
        if u.path.startswith('/yt/api/'):return self.youtube_api(u.path[len('/yt/api/'):])
        if u.path not in ('/panel/off','/panel/on'):return self.reply(404,{'error':'Percorso non valido'})
        r=panel(u.path.endswith('/on'));self.reply(200 if r['ok'] else 503,r)
    def youtube_api(self,endpoint):
        try:
            size=int(self.headers.get('Content-Length') or 0)
            if size<0 or size>32768:raise ValueError('Richiesta troppo grande')
            data=json.loads(self.rfile.read(size).decode('utf-8') or '{}')
            raw=yt_api(endpoint,data)
        except ValueError:return self.reply(400,{'error':'Richiesta non valida'})
        except Exception as e:
            if getattr(e,'code',0) in (401,403) and youtube_account():return self.reply(401,{'error':'Sessione YouTube scaduta: aggiorna i cookie del tuo account'})
            return self.reply(502,{'error':'YouTube Music non disponibile. Controlla la connessione a Internet.'})
        self.send_response(200);self.cors();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def youtube_audio(self,video,alt):
        """Stream a YouTube audio file, re-resolving once if Google refuses the URL."""
        tried=[]
        while True:
            try:
                hit=resolve(video,tried,alt)
                headers={'User-Agent':hit['ua']}
                headers['Range']=(self.headers.get('Range') or 'bytes=0-')[:80]
                response=urlopen(Request(hit['url'],headers=headers),timeout=20)
                break
            except LookupError as e:return self.reply(404,{'error':e.args[0]})
            except Exception as e:
                if getattr(e,'code',0) in (403,410) and len(tried)<len(YT_PLAYERS):
                    forget(video,alt);tried.append(hit['client']);continue
                return self.reply(502,{'error':'YouTube non riesce a riprodurre questo brano.'})
        self.relay(response)
    def relay(self,response):
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
    def do_GET(self):
        u=urlsplit(self.path);q=parse_qs(u.query)
        if not self.authorized(q):return self.reply(403,{'error':'Accesso negato'})
        if u.path=='/health':return self.reply(200,{'ok':True,'version':VERSION,'connected':os.path.exists(CONNECTION),'youtube':youtube_account() is not None})
        m=re.match(r'^/yt/audio/([A-Za-z0-9_-]{11})$',u.path)
        if m:return self.youtube_audio(m.group(1),q.get('alt')==['1'])
        m=re.match(r'^/yt/stream/([A-Za-z0-9_-]{11})$',u.path)
        if m:
            # The media element cannot read error bodies: the app asks here why a stream failed.
            try:resolve(m.group(1));return self.reply(200,{'ok':True})
            except LookupError as e:return self.reply(404,{'error':e.args[0]})
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
        self.relay(response)

def stop(state):
    try:
        pid=int(state.get('pid',0))
        if b'bridge.py' not in open('/proc/%s/cmdline'%pid,'rb').read():return
        os.kill(pid,signal.SIGTERM)
        for _ in range(30):
            time.sleep(.1)
            if not os.path.exists('/proc/%s'%pid):return
    except Exception:pass

def ensure():
    if not os.path.isdir(ROOT):os.makedirs(ROOT,0o700)
    os.chmod(ROOT,0o700)
    source='/var/lib/launch-home-cinema/jellyfin.json'
    if not os.path.exists(CONNECTION) and os.path.exists(source):
        shutil.copyfile(source,CONNECTION);os.chmod(CONNECTION,0o600)
    try:
        s=read(STATE)
        data=json.loads(urlopen('http://127.0.0.1:%s/health?key=%s'%(s['port'],s['key']),timeout=2).read().decode('utf-8'))
        if data.get('ok') and data.get('version')==VERSION:print(json.dumps(s));return
        # A bridge left running by an older Bloomee keeps the port: replace it.
        if data.get('ok'):stop(s)
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
