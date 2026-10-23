#!/usr/bin/env python
"""Local Jellyfin and YouTube Music proxy and panel control for rooted LG webOS (Python 2/3).
Server credentials and Google cookies remain in mode-0600 root files, never in media URLs.
"""
from __future__ import print_function
import os, sys, json, re, time, socket, subprocess, threading, ssl, base64, shutil, hashlib, signal, random, hmac
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
VERSION=5
PAIR_PORT=18793
HEX=re.compile(r'^[a-fA-F0-9]{32}$')

# googlevideo.com answers with an IPv6 address first, but on home networks
# without an IPv6 route every connection waited the whole 20 s timeout before
# trying IPv4. Connections try IPv4 addresses first and IPv6 after them.
_getaddrinfo=getattr(socket.getaddrinfo,'original',socket.getaddrinfo)
def getaddrinfo(*args,**kwargs):
    return sorted(_getaddrinfo(*args,**kwargs),key=lambda a:a[0]!=socket.AF_INET)
getaddrinfo.original=_getaddrinfo
socket.getaddrinfo=getaddrinfo

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
        # Righe della Home: aggiunti di recente e scelti a caso.
        sort=query.get('sort',[''])[0]
        if sort=='recent':defaults.update({'SortBy':'DateCreated','SortOrder':'Descending'})
        elif sort=='random':defaults['SortBy']='Random'
        elif sort:raise ValueError('Ordine non valido')
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
    ({'clientName':'ANDROID','clientVersion':'20.10.38','androidSdkVersion':30,'osName':'Android','osVersion':'11'},
     'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip','3'),
    ({'clientName':'ANDROID_VR','clientVersion':'1.65.10','deviceMake':'Oculus','deviceModel':'Quest 3','androidSdkVersion':32,'osName':'Android','osVersion':'12L'},
     'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip','28'),
]
# AAC first: every webOS media pipeline plays it. The alternative order, Opus
# first, is requested by the app when the TV refuses the AAC stream.
YT_ITAGS=(140,141,251,250,249,139)
YT_ITAGS_ALT=(251,250,249,140,141,139)
streams={}
# Videos YouTube refuses (region, age, bot check): remembered for ten minutes
# so the Opus retry and the error report do not repeat every player call.
refused={}
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

def yt_api(endpoint,data,account=None):
    account=youtube_account() if account is None else account
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
        no=refused.get(video)
        if no and no[0]>time.time() and not skip:raise LookupError(no[1])
    reason=None
    # Remembered as refused only when every client said no: a timeout or an
    # answer without a usable stream says nothing about the video itself.
    certain=True
    for client,ua,number in YT_PLAYERS:
        if client['clientName'] in skip:continue
        c=dict(client);c.update({'hl':'it','gl':'IT'})
        body={'context':{'client':c},'videoId':video,'contentCheckOk':True,'racyCheckOk':True}
        try:
            r=urlopen(Request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false',data=json.dumps(body).encode('utf-8'),
                headers={'Content-Type':'application/json','User-Agent':ua,'X-YouTube-Client-Name':number,'X-YouTube-Client-Version':client['clientVersion']}),timeout=20)
            try:player=json.loads(r.read().decode('utf-8'))
            finally:r.close()
        except Exception:
            certain=False;continue
        status=player.get('playabilityStatus') or {}
        if status.get('status')!='OK':
            reason=status.get('reason') or reason;continue
        f=pick_audio(player,alt)
        if not f:
            certain=False;continue
        m=re.search(r'[?&]expire=(\d+)',f['url'])
        hit={'url':f['url'],'ua':ua,'client':client['clientName'],'expire':(int(m.group(1)) if m else time.time()+3600)-300}
        with streams_lock:
            if len(streams)>60:streams.clear()
            streams[key]=hit
        return hit
    if reason and certain and not skip:
        with streams_lock:
            if len(refused)>200:refused.clear()
            refused[video]=(time.time()+600,reason)
    raise LookupError(reason or 'Brano YouTube non disponibile')

def forget(video,alt=False):
    with streams_lock:streams.pop((video,alt),None)

def account_name(data):
    """Name in the account menu, or None when the cookie is not signed in."""
    stack=[data]
    while stack:
        n=stack.pop()
        if isinstance(n,dict):
            h=n.get('activeAccountHeaderRenderer')
            if isinstance(h,dict):
                t=h.get('accountName') or {}
                name=t.get('simpleText') or ''.join(r.get('text','') for r in t.get('runs',[]))
                if name:return name
            stack.extend(n.values())
        elif isinstance(n,list):stack.extend(n)
    return None

def check_account(account):
    return account_name(json.loads(yt_api('account/account_menu',{},account).decode('utf-8')))

def lan_address():
    s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
    try:
        s.connect(('192.0.2.1',9));return s.getsockname()[0]
    except Exception:return '127.0.0.1'
    finally:s.close()

PAIR_PAGE=u"""<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bloomee: accesso YouTube Music</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;background:#141116;color:#f5eef6}input,textarea,button{font:inherit;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:12px;border-radius:10px;border:1px solid #57445d;background:#201a22;color:#f5eef6}textarea{height:160px}button{background:#ef88ba;color:#24131e;border:0;font-weight:700}ol{padding-left:20px}code{background:#302733;padding:1px 5px;border-radius:5px}</style></head><body>
<h1>Accesso YouTube Music per Bloomee</h1>{note}
<ol><li>Su un computer apri <b>music.youtube.com</b> con il tuo account.</li><li>Apri gli strumenti per sviluppatori (F12), scheda <b>Rete</b>, e scegli una richiesta a <code>youtubei/v1</code>.</li><li>Nelle intestazioni della richiesta copia tutto il valore di <code>cookie</code> e incollalo qui.</li></ol>
<form method="post" action="/"><label>Codice mostrato sulla TV<input name="code" inputmode="numeric" autocomplete="off" required></label><label>Cookie<textarea name="cookie" required></textarea></label>
<label>DATASYNC_ID (solo per account brand, facoltativo)<input name="dataSyncId" autocomplete="off"></label><button>Collega la TV</button></form>
<p>Il cookie viaggia sulla rete di casa senza cifratura e sulla TV resta in un file leggibile solo da root. Per scollegarti usa Esci nelle impostazioni di Bloomee.</p></body></html>"""

class Pairing(object):
    """One-shot LAN page that hands a YouTube cookie to the TV, guarded by a code."""
    def __init__(self):
        self.lock=threading.Lock();self.server=None;self.code=None;self.expires=0;self.attempts=0;self.result={};self.session=0
    def start(self):
        with self.lock:
            self.close_locked();self.session+=1
            self.code='%06d'%random.SystemRandom().randint(0,999999)
            self.expires=time.time()+300;self.attempts=0;self.result={}
            pairing=self
            class PairHandler(BaseHTTPRequestHandler):
                protocol_version='HTTP/1.0'
                def log_message(self,*args):pass
                def page(self,status,note):
                    raw=PAIR_PAGE.replace(u'{note}',note).encode('utf-8')
                    self.send_response(status);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
                def do_GET(self):
                    if not pairing.active():return self.page(410,u'<p><b>Abbinamento scaduto.</b> Avvialo di nuovo dalla TV.</p>')
                    self.page(200,u'')
                def do_POST(self):
                    size=int(self.headers.get('Content-Length') or 0)
                    if size<=0 or size>16384:return self.page(400,u'<p><b>Richiesta non valida.</b></p>')
                    form=parse_qs(self.rfile.read(size).decode('utf-8'))
                    ok,note=pairing.submit(form.get('code',[''])[0].strip(),form.get('cookie',[''])[0].strip(),form.get('dataSyncId',[''])[0].strip())
                    self.page(200 if ok else 400,note)
            server=Server(('0.0.0.0',PAIR_PORT),PairHandler)
            threading.Thread(target=server.serve_forever).start()
            self.server=server
            return {'url':'http://%s:%d/'%(lan_address(),PAIR_PORT),'code':self.code,'seconds':300}
    def active(self):
        return self.server is not None and time.time()<self.expires
    def submit(self,code,cookie,data_sync):
        # The TV shows the code as "123 456": spaces and dashes are not part of it.
        code=re.sub(r'[^0-9]','',code)
        with self.lock:
            if not self.active():return False,u'<p><b>Abbinamento scaduto.</b> Avvialo di nuovo dalla TV.</p>'
            session=self.session
            if not hmac.compare_digest(code.encode('utf-8'),self.code.encode('utf-8')):
                self.attempts+=1
                if self.attempts>=5:self.expires=0;self.result={'error':'Troppi codici errati: abbinamento chiuso'}
                return False,u'<p><b>Codice errato.</b></p>'
        account={'cookie':cookie[:12000]}
        if data_sync:account['dataSyncId']=data_sync[:200]
        if not sapisid(cookie):return False,u'<p><b>Nel cookie manca SAPISID:</b> copia tutto il valore dell\u2019intestazione cookie.</p>'
        try:name=check_account(account)
        except Exception:name=None
        if not name:return False,u'<p><b>Google non riconosce questo cookie.</b> Riprova dopo un nuovo accesso a music.youtube.com.</p>'
        account['name']=name
        with self.lock:
            # Chiudi abbinamento or Esci on the TV during the Google check wins.
            if self.session!=session or not self.active():return False,u'<p><b>Abbinamento chiuso dalla TV.</b> Il cookie non \u00e8 stato salvato.</p>'
            save(YOUTUBE,account)
            self.result={'name':name};self.expires=0
        return True,u'<p><b>Fatto: la TV \u00e8 collegata come %s.</b> Puoi chiudere questa pagina.</p>'%name.replace('<','&lt;')
    def status(self):
        with self.lock:
            out={'active':self.active()}
            out.update(self.result)
            if not out['active'] and self.server is not None:self.close_locked()
            return out
    def close_locked(self):
        # Called from the main bridge threads only, never from a pairing request.
        if self.server is not None:
            server=self.server;self.server=None
            server.shutdown();server.server_close()
    def close(self):
        with self.lock:self.expires=0;self.session+=1;self.close_locked()

pairing=Pairing()

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
        if u.path=='/yt/pair/start':
            try:return self.reply(200,pairing.start())
            except Exception:return self.reply(503,{'error':'Abbinamento non disponibile: porta %d occupata'%PAIR_PORT})
        if u.path=='/yt/pair/stop':pairing.close();return self.reply(200,{'ok':True})
        if u.path=='/yt/logout':
            pairing.close()
            if os.path.exists(YOUTUBE):os.remove(YOUTUBE)
            return self.reply(200,{'ok':True})
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
        if u.path=='/yt/pair/status':return self.reply(200,pairing.status())
        if u.path=='/health':return self.reply(200,{'ok':True,'version':VERSION,'connected':os.path.exists(CONNECTION),'youtube':youtube_account() is not None})
        m=re.match(r'^/yt/audio/([A-Za-z0-9_-]{11})$',u.path)
        if m:return self.youtube_audio(m.group(1),q.get('alt')==['1'])
        m=re.match(r'^/yt/stream/([A-Za-z0-9_-]{11})$',u.path)
        if m:
            # The media element cannot read error bodies: the app asks here why a stream failed.
            try:resolve(m.group(1),(),q.get('alt')==['1']);return self.reply(200,{'ok':True})
            except LookupError as e:return self.reply(404,{'error':e.args[0]})
            except Exception:return self.reply(502,{'error':'YouTube non risponde'})
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
        for sig in (signal.SIGTERM,signal.SIGKILL):
            os.kill(pid,sig)
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
            data=json.loads(urlopen('http://127.0.0.1:%s/health?key=%s'%(s['port'],s['key']),timeout=1).read().decode('utf-8'))
            # Only this version: an old bridge that is still answering lacks the YouTube routes.
            if data.get('version')==VERSION:print(json.dumps(s));return
        except Exception:pass
    raise RuntimeError('Bridge non avviato')

if __name__=='__main__':
    if '--serve' in sys.argv:
        server=Server(('127.0.0.1',PORT),Handler)
        server.key=base64.urlsafe_b64encode(os.urandom(24)).decode('ascii').rstrip('=')
        save(STATE,{'port':PORT,'key':server.key,'pid':os.getpid()})
        server.serve_forever()
    else:ensure()
