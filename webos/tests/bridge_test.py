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
if __name__=='__main__':unittest.main()
