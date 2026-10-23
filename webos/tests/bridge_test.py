import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('bridge',str(Path(__file__).parents[1]/'bridge.py'));bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class Routes(unittest.TestCase):
 def test_bounded_queries(self):
  path,args=bridge.route('/api/library',{'kind':['Audio'],'limit':['99999'],'start':['99999999']},'a'*32)
  self.assertEqual(args['Limit'],100);self.assertEqual(args['StartIndex'],100000);self.assertTrue(path.startswith('/Users/'))
 def test_no_upstream_urls_or_arbitrary_paths(self):
  for path in ['/api/http://example.com','/etc/passwd','/audio/../../foo','/api/item/notanid']:
   with self.assertRaises(ValueError):bridge.route(path,{},'a'*32)
 def test_invalid_kinds_and_parent_ids(self):
  for q in [{'kind':['Movie']},{'parent':['../foo']},{'artist':['bad']}]:
   with self.assertRaises(ValueError):bridge.route('/api/library',q,'a'*32)
 def test_media_urls_never_contain_the_server_credential(self):
  path,args=bridge.route('/audio/'+'b'*32,{},'a'*32)
  self.assertNotIn('api_key',args);self.assertNotIn('token',args);self.assertEqual(path,'/Audio/'+'b'*32+'/universal')
class YouTube(unittest.TestCase):
 def test_only_fixed_endpoints_and_fields_reach_youtube(self):
  body,query=bridge.yt_body('search',{'query':'pausini','context':{'client':{'clientName':'X'}},'evil':'1'},None)
  self.assertEqual(body['query'],'pausini');self.assertNotIn('evil',body);self.assertEqual(body['context']['client']['clientName'],'WEB_REMIX')
  for endpoint in ['player','../browse','browse/../../x','https://example.com']:
   with self.assertRaises(ValueError):bridge.yt_body(endpoint,{},None)
  for bad in [{'query':5},{'query':'x'*9000},[]]:
   with self.assertRaises(ValueError):bridge.yt_body('search',bad,None)
 def test_legacy_continuations_travel_in_the_query(self):
  body,query=bridge.yt_body('browse',{'continuation':'tok','legacy':True},None)
  self.assertNotIn('continuation',body);self.assertEqual((query['ctoken'],query['continuation'],query['type']),('tok','tok','next'))
  body,query=bridge.yt_body('browse',{'continuation':'tok'},None);self.assertEqual(body['continuation'],'tok');self.assertNotIn('ctoken',query)
 def test_account_requests_are_signed_and_delegated(self):
  account={'cookie':'A=1; SAPISID=secret; B=2','visitorData':'v','dataSyncId':'brand||user'}
  h=bridge.yt_headers(account,now=1700000000)
  self.assertEqual(h['Authorization'],'SAPISIDHASH 1700000000_'+bridge.hashlib.sha1(b'1700000000 secret https://music.youtube.com').hexdigest())
  self.assertEqual(h['Cookie'],account['cookie']);self.assertEqual(h['X-Goog-Visitor-Id'],'v')
  body,_=bridge.yt_body('browse',{'browseId':'FEmusic_home'},account);self.assertEqual(body['context']['user'],{'onBehalfOfUser':'brand'})
  self.assertNotIn('Cookie',bridge.yt_headers(None));self.assertNotIn('Authorization',bridge.yt_headers({'cookie':'NID=1'}))
 def test_audio_prefers_opus_and_skips_signed_formats(self):
  player={'streamingData':{'adaptiveFormats':[{'itag':251,'mimeType':'audio/webm','signatureCipher':'s'},{'itag':140,'mimeType':'audio/mp4','url':'aac'},{'itag':139,'mimeType':'audio/mp4','url':'low'},{'itag':137,'mimeType':'video/mp4','url':'v'}]}}
  self.assertEqual(bridge.pick_audio(player)['url'],'aac')
  player['streamingData']['adaptiveFormats'][0]['url']='o'
  self.assertEqual(bridge.pick_audio(player)['url'],'o');self.assertEqual(bridge.pick_audio(player,alt=True)['url'],'aac')
  self.assertIsNone(bridge.pick_audio({'streamingData':{'adaptiveFormats':[{'itag':137,'mimeType':'video/mp4','url':'v'}]}}))
 def test_cached_streams_are_reused_until_they_expire(self):
  bridge.streams.clear();bridge.streams[('abcdefghijk',False)]={'url':'u','ua':'x','client':'IOS','expire':bridge.time.time()+60}
  self.assertEqual(bridge.resolve('abcdefghijk')['url'],'u')
  bridge.forget('abcdefghijk');self.assertNotIn(('abcdefghijk',False),bridge.streams)
class HomeAndPairing(unittest.TestCase):
 def test_home_rows_use_fixed_sort_orders(self):
  _,args=bridge.route('/api/library',{'kind':['MusicAlbum'],'sort':['recent']},'a'*32);self.assertEqual((args['SortBy'],args['SortOrder']),('DateCreated','Descending'))
  _,args=bridge.route('/api/library',{'kind':['MusicAlbum'],'sort':['random']},'a'*32);self.assertEqual(args['SortBy'],'Random')
  with self.assertRaises(ValueError):bridge.route('/api/library',{'kind':['MusicAlbum'],'sort':['Name,Path']},'a'*32)
 def test_account_name_is_read_from_the_account_menu(self):
  self.assertEqual(bridge.account_name({'actions':[{'x':{'activeAccountHeaderRenderer':{'accountName':{'runs':[{'text':'Fabio'}]}}}}]}),'Fabio')
  self.assertIsNone(bridge.account_name({'actions':[]}))
 def test_pairing_needs_the_code_and_closes_after_five_wrong_codes(self):
  p=bridge.Pairing();p.server=object();p.code='123456';p.expires=bridge.time.time()+60
  p.close_locked=lambda:None
  for _ in range(4):self.assertFalse(p.submit('000000','SAPISID=x','')[0]);self.assertTrue(p.active())
  self.assertFalse(p.submit('000000','SAPISID=x','')[0]);self.assertFalse(p.active())
  self.assertIn('Troppi',p.status()['error'])
  self.assertFalse(p.submit('123456','SAPISID=x','')[0])
 def test_pairing_rejects_cookies_without_sapisid_and_saves_only_verified_ones(self):
  import tempfile,os,json
  d=tempfile.mkdtemp();old=bridge.YOUTUBE;bridge.YOUTUBE=os.path.join(d,'youtube.json');real=bridge.check_account
  try:
   p=bridge.Pairing();p.server=object();p.code='123456';p.expires=bridge.time.time()+60;p.close_locked=lambda:None
   self.assertFalse(p.submit('123456','NID=1','')[0]);self.assertFalse(os.path.exists(bridge.YOUTUBE))
   bridge.check_account=lambda account:None
   self.assertFalse(p.submit('123456','SAPISID=x','')[0]);self.assertFalse(os.path.exists(bridge.YOUTUBE))
   bridge.check_account=lambda account:'Fabio'
   ok,note=p.submit('123456','SAPISID=x; A=1','brand||u');self.assertTrue(ok)
   saved=json.load(open(bridge.YOUTUBE));self.assertEqual((saved['cookie'],saved['dataSyncId'],saved['name']),('SAPISID=x; A=1','brand||u','Fabio'))
   self.assertEqual(oct(os.stat(bridge.YOUTUBE).st_mode&0o777),oct(0o600));self.assertEqual(p.status()['name'],'Fabio');self.assertFalse(p.active())
  finally:bridge.YOUTUBE=old;bridge.check_account=real
class ReviewFixes(unittest.TestCase):
 def setUp(self):
  import tempfile,os
  self.d=tempfile.mkdtemp();self.old=bridge.YOUTUBE;bridge.YOUTUBE=os.path.join(self.d,'youtube.json');self.real=bridge.check_account
  self.real_visitor=bridge.visitor_data;bridge.visitor_data=lambda:'vd'
 def tearDown(self):bridge.YOUTUBE=self.old;bridge.check_account=self.real;bridge.visitor_data=self.real_visitor
 def pairing(self):
  p=bridge.Pairing();p.server=object();p.code='123456';p.expires=bridge.time.time()+60;p.close_locked=lambda:None;return p
 def test_the_code_can_be_typed_as_shown_on_the_tv(self):
  bridge.check_account=lambda account:'Fabio'
  p=self.pairing();self.assertTrue(p.submit('123 456','SAPISID=x','')[0]);self.assertEqual(p.attempts,0)
 def test_closing_on_the_tv_during_the_google_check_discards_the_cookie(self):
  import os
  p=self.pairing()
  def slow(account):p.close();return 'Fabio'
  bridge.check_account=slow
  ok,note=p.submit('123456','SAPISID=x','');self.assertFalse(ok);self.assertIn('chiuso',note);self.assertFalse(os.path.exists(bridge.YOUTUBE))
 def test_refused_videos_are_not_asked_again_for_ten_minutes(self):
  calls=[];real=bridge.urlopen
  class R(object):
   def read(self):return b'{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Conferma di non essere un bot"}}'
   def close(self):pass
  def fake(req,timeout=0):calls.append(1);return R()
  bridge.urlopen=fake;bridge.refused.clear();bridge.streams.clear()
  try:
   for alt in (False,True,False):
    with self.assertRaises(LookupError) as e:bridge.resolve('zzzzzzzzzzz',(),alt)
    self.assertIn('bot',e.exception.args[0])
   self.assertEqual(len(calls),len(bridge.YT_PLAYERS))
  finally:bridge.urlopen=real;bridge.refused.clear()
 def fake_players(self,answers):
  """urlopen that answers each player client from a table: an exception is raised, a dict is returned as JSON."""
  calls=[]
  class R(object):
   def __init__(self,data):self.data=data
   def read(self):return bridge.json.dumps(self.data).encode('utf-8')
   def close(self):pass
  def fake(req,timeout=0):
   name=bridge.json.loads(req.data.decode('utf-8'))['context']['client']['clientName'];calls.append(name)
   answer=answers[name]
   if isinstance(answer,Exception):raise answer
   return R(answer)
  return fake,calls
 def test_a_failed_client_does_not_mark_the_video_as_refused(self):
  bot={'playabilityStatus':{'status':'LOGIN_REQUIRED','reason':'Accedi per confermare di non essere un bot'}}
  ok={'playabilityStatus':{'status':'OK'},'streamingData':{'adaptiveFormats':[{'itag':140,'mimeType':'audio/mp4','url':'https://x/a?expire=%d'%(bridge.time.time()+7200)}]}}
  answers=dict((c['clientName'],bot) for c,_,_ in bridge.YT_PLAYERS);answers['IOS']=IOError('timed out');answers['ANDROID']=IOError('timed out')
  fake,calls=self.fake_players(answers);real=bridge.urlopen
  bridge.urlopen=fake;bridge.refused.clear();bridge.streams.clear()
  try:
   with self.assertRaises(LookupError) as e:bridge.resolve('yyyyyyyyyyy')
   self.assertIn('bot',e.exception.args[0]);self.assertNotIn('yyyyyyyyyyy',bridge.refused)
   answers['IOS']=ok;del calls[:]
   self.assertEqual(bridge.resolve('yyyyyyyyyyy')['client'],'IOS');self.assertEqual(calls,['VISIONOS','IOS'])
  finally:bridge.urlopen=real;bridge.refused.clear();bridge.streams.clear()
 def test_android_answers_when_ios_fails(self):
  names=[c['clientName'] for c,_,_ in bridge.YT_PLAYERS]
  self.assertEqual(names[:4],['VISIONOS','IOS','ANDROID','ANDROID_VR'])
  client,ua,number=bridge.YT_PLAYERS[2]
  self.assertEqual((client['clientVersion'],client['androidSdkVersion'],number),('20.10.38',30,'3'));self.assertIn('com.google.android.youtube/20.10.38',ua)
  ok={'playabilityStatus':{'status':'OK'},'streamingData':{'adaptiveFormats':[{'itag':140,'mimeType':'audio/mp4','url':'https://x/a?expire=%d'%(bridge.time.time()+7200)}]}}
  bot={'playabilityStatus':{'status':'LOGIN_REQUIRED','reason':'bot'}}
  answers=dict((n,bot) for n in names);answers['IOS']=IOError('timed out');answers['ANDROID']=ok
  fake,calls=self.fake_players(answers);real=bridge.urlopen
  bridge.urlopen=fake;bridge.refused.clear();bridge.streams.clear()
  try:
   hit=bridge.resolve('xxxxxxxxxxx');self.assertEqual(hit['client'],'ANDROID');self.assertEqual(hit['ua'],ua);self.assertEqual(calls,['VISIONOS','IOS','ANDROID'])
  finally:bridge.urlopen=real;bridge.refused.clear();bridge.streams.clear()
class Visitor(unittest.TestCase):
 def setUp(self):self.real=bridge.urlopen;bridge.visitor.update(value=None,at=0)
 def tearDown(self):bridge.urlopen=self.real;bridge.visitor.update(value=None,at=0)
 def test_visionos_comes_first_and_every_player_call_carries_the_visitor_id(self):
  self.assertEqual(bridge.YT_PLAYERS[0][0]['clientName'],'VISIONOS');self.assertEqual(bridge.YT_PLAYERS[0][2],'101')
  seen=[]
  class R(object):
   def __init__(self,data):self.data=data
   def read(self):return self.data
   def close(self):pass
  page=b'<script>ytcfg.set({"VISITOR_DATA":"Cgt2aXNpdG9y","X":1});</script>'
  ok=bridge.json.dumps({'playabilityStatus':{'status':'OK'},'streamingData':{'adaptiveFormats':[{'itag':140,'mimeType':'audio/mp4','url':'https://x/a?expire=%d'%(bridge.time.time()+7200)}]}}).encode('utf-8')
  def fake(req,timeout=0):
   if req.data is None:seen.append('page');return R(page)
   body=bridge.json.loads(req.data.decode('utf-8'));seen.append((body['context']['client']['clientName'],body['context']['client'].get('visitorData'),req.get_header('X-goog-visitor-id')))
   return R(ok)
  bridge.urlopen=fake;bridge.streams.clear();bridge.refused.clear()
  try:
   hit=bridge.resolve('vvvvvvvvvvv');self.assertEqual(hit['client'],'VISIONOS')
   self.assertEqual(seen,['page',('VISIONOS','Cgt2aXNpdG9y','Cgt2aXNpdG9y')])
   bridge.streams.clear();del seen[:];bridge.resolve('wwwwwwwwwww')
   self.assertEqual(seen,[('VISIONOS','Cgt2aXNpdG9y','Cgt2aXNpdG9y')])
  finally:bridge.streams.clear()
 def test_without_a_visitor_id_the_players_are_still_asked(self):
  def fail(req,timeout=0):raise IOError('offline')
  bridge.urlopen=fail
  self.assertIsNone(bridge.visitor_data())
class Network(unittest.TestCase):
 def test_connections_try_ipv4_before_ipv6(self):
  import socket,threading
  v6=(socket.AF_INET6,socket.SOCK_STREAM,6,'',('100::1',443,0,0))
  listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);port=listener.getsockname()[1]
  v4=(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',port))
  calls=[];real=bridge._getaddrinfo
  def fake(host,*a,**k):calls.append(host);return [v6,v4] if host=='rr1.googlevideo.test' else [v6]
  bridge._getaddrinfo=fake
  try:
   self.assertIs(socket.getaddrinfo,bridge.getaddrinfo)
   self.assertEqual(socket.getaddrinfo('rr1.googlevideo.test',443),[v4,v6])
   # An IPv6-only host keeps its address.
   self.assertEqual(socket.getaddrinfo('ipv6only.test',443),[v6])
   # urllib connects through socket.create_connection: it must reach IPv4 without waiting for IPv6.
   start=bridge.time.time();c=socket.create_connection(('rr1.googlevideo.test',port),timeout=5)
   self.assertEqual(c.getpeername(),('127.0.0.1',port));self.assertLess(bridge.time.time()-start,1);c.close()
   self.assertIn('rr1.googlevideo.test',calls)
  finally:bridge._getaddrinfo=real;listener.close()
if __name__=='__main__':unittest.main()
