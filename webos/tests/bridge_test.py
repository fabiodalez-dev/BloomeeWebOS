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
 def test_audio_prefers_aac_and_skips_signed_formats(self):
  player={'streamingData':{'adaptiveFormats':[{'itag':251,'mimeType':'audio/webm','url':'o'},{'itag':140,'mimeType':'audio/mp4','signatureCipher':'s'},{'itag':139,'mimeType':'audio/mp4','url':'low'},{'itag':137,'mimeType':'video/mp4','url':'v'}]}}
  self.assertEqual(bridge.pick_audio(player)['url'],'o')
  player['streamingData']['adaptiveFormats'][1]['url']='aac'
  self.assertEqual(bridge.pick_audio(player)['url'],'aac');self.assertEqual(bridge.pick_audio(player,alt=True)['url'],'o')
  self.assertIsNone(bridge.pick_audio({'streamingData':{'adaptiveFormats':[{'itag':137,'mimeType':'video/mp4','url':'v'}]}}))
 def test_cached_streams_are_reused_until_they_expire(self):
  bridge.streams.clear();bridge.streams[('abcdefghijk',False)]={'url':'u','ua':'x','client':'IOS','expire':bridge.time.time()+60}
  self.assertEqual(bridge.resolve('abcdefghijk')['url'],'u')
  bridge.forget('abcdefghijk');self.assertNotIn(('abcdefghijk',False),bridge.streams)
if __name__=='__main__':unittest.main()
