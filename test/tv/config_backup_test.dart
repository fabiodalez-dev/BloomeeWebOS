import 'package:Bloomee/tv/services/tv_image_privacy.dart';
import 'dart:convert';
import 'dart:io';
import 'package:Bloomee/services/db/db_provider.dart';
import 'package:Bloomee/services/db/dao/settings_dao.dart';
import 'package:Bloomee/tv/tv_config.dart';
import 'package:Bloomee/tv/services/tv_secret_store.dart';
import 'package:Bloomee/tv/services/tv_workspace.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class Vault extends TvSecretStore {
  final Map<String, Map<String, String>> values = {};
  bool fail = false;
  @override
  Future<Map<String, String>> read(String id) async => {...?values[id]};
  @override
  Future<void> write(String id, Map<String, String> next) async {
    if (fail) throw StateError('vault unavailable');
    values[id] = {...next};
  }
}

void main() {
  late Directory root;
  late Vault vault;
  late SettingsDAO dao;
  late Future<void> Function() oldImagePurge;
  final oldVault = TvConfig.secretStore;
  late http.Client oldHttp;
  setUp(() async {
    root = await Directory.systemTemp.createTemp('bloomee-config-');
    await DBProvider.init(
        appSupportPath: root.path, appDocumentsPath: root.path);
    await TvWorkspace.instance.open(root);
    oldImagePurge = TvImagePrivacy.emptyDiskCache;
    TvImagePrivacy.emptyDiskCache = () async {};
    oldHttp = TvConfig.httpClient;
    dao = SettingsDAO(DBProvider.db);
    vault = Vault();
    TvConfig.secretStore = vault;
    TvConfig.profileId = 'default';
    TvConfig.httpClient = MockClient((request) async => http.Response(
        request.url.path.endsWith('/Users')
            ? '[{"Id":"user","Name":"Fabio"}]'
            : '{}',
        200));
    await TvConfig.load();
  });
  tearDown(() async {
    TvImagePrivacy.emptyDiskCache = oldImagePurge;
    TvConfig.secretStore = oldVault;
    TvConfig.httpClient.close();
    TvConfig.httpClient = oldHttp;
    final db = await DBProvider.db;
    if (db.isOpen) await db.close();
    await root.delete(recursive: true);
  });
  test('screen idle preference survives a configuration reload and accepts Mai', () async {
    await TvConfig.saveScreenOffSeconds(60);
    expect(await dao.getSettingStr('tv.screenOffSeconds'), '60');
    TvConfig.screenOffSeconds = 0;
    await TvConfig.load();
    expect(TvConfig.screenOffSeconds, 60);
    await TvConfig.saveScreenOffSeconds(0);
    await TvConfig.load();
    expect(TvConfig.screenOffSeconds, 0);
  });
  test('legacy plaintext is erased only after a successful encrypted write',
      () async {
    await dao.putSettingStr('tv.yt.cookie', 'SAPISID=PRIVATE');
    vault.fail = true;
    await expectLater(TvConfig.load(), throwsStateError);
    expect(await dao.getSettingStr('tv.yt.cookie'), 'SAPISID=PRIVATE');
    vault.fail = false;
    await TvConfig.load();
    expect(await dao.getSettingStr('tv.yt.cookie'), isNull);
    expect(vault.values['default']!['tv.yt.cookie'], 'SAPISID=PRIVATE');
  });
  test(
      'tokens are bound to a server and cannot leak after metadata replacement',
      () async {
    await TvConfig.saveJellyfin(
        url: 'http://server.test',
        user: 'Fabio',
        token: 'SECRET',
        userId: 'user');
    expect(await dao.getSettingStr('tv.jellyfin.token'), isNull);
    await dao.putSettingStr('tv.jellyfin.url', 'http://other.test');
    await TvConfig.load();
    expect(TvConfig.hasJellyfin, isFalse);
  });
  test('invalid imports preserve both file and existing credentials', () async {
    await TvConfig.saveLidarr(url: 'http://server.test', key: 'PREVIOUS');
    final file = await File('${root.path}/tv-config.json').writeAsString(
        jsonEncode({'lidarrUrl': 'javascript:bad', 'lidarrKey': 'NEW'}));
    expect(await TvConfig.importFile(file), isFalse);
    expect(await file.exists(), isTrue);
    expect(TvConfig.lidarrKey, 'PREVIOUS');
  });
  test('valid import applies all data before deleting the input file',
      () async {
    final file =
        await File('${root.path}/tv-config.json').writeAsString(jsonEncode({
      'jellyfinUrl': 'http://server.test/',
      'jellyfinUser': 'Fabio',
      'jellyfinToken': 'SECRET'
    }));
    expect(await TvConfig.importFile(file), isTrue);
    expect(await file.exists(), isFalse);
    expect(TvConfig.jellyfinUserId, 'user');
    expect(await dao.getSettingStr('tv.jellyfin.token'), isNull);
  });
  test('binary backup excludes credentials while live settings remain intact',
      () async {
    await dao.putSettings({
      'tv.yt.cookie': 'SUPER_PRIVATE_COOKIE',
      'lastFMSession': 'SUPER_PRIVATE_SESSION',
      'theme': 'dark'
    });
    final target = '${root.path}/safe.isar';
    expect(await DBProvider.createBackUp(destination: target), target);
    final bytes = await File(target).readAsBytes();
    final text = latin1.decode(bytes);
    expect(text, isNot(contains('SUPER_PRIVATE_COOKIE')));
    expect(text, isNot(contains('SUPER_PRIVATE_SESSION')));
    expect(await dao.getSettingStr('tv.yt.cookie'), 'SUPER_PRIVATE_COOKIE');
    await dao.putSettingStr('theme', 'light');
    expect((await DBProvider.restoreDB(target))['success'], isTrue);
    expect(await dao.getSettingStr('theme'), 'dark');
    expect(await dao.getSettingStr('tv.yt.cookie'), isNull);
  });
  test('failed restore rolls back live data', () async {
    await dao.putSettingStr('marker', 'original');
    final file =
        await File('${root.path}/corrupt.isar').writeAsBytes([1, 2, 3]);
    expect((await DBProvider.restoreDB(file.path))['success'], isFalse);
    expect(await dao.getSettingStr('marker'), 'original');
  });
  test('failed rollback retains recovery copy for a later recovery', () async {
    await dao.putSettingStr('marker', 'original');
    final target = '${root.path}/valid.isar';
    await DBProvider.createBackUp(destination: target);
    final result = await DBProvider.restoreDB(target,
        checkpoint: (_) async => throw StateError('simulated open failure'));
    expect(result['success'], isFalse);
    expect(
        await File('${root.path}/dbv3.restore_rollback.isar').exists(), isTrue);
  });
  test('URL validation rejects credentials, parameters and unknown schemes',
      () {
    for (final url in [
      'file:///tmp/db',
      'ftp://server',
      'http://user:pass@host',
      'http://host/?ApiKey=secret',
      'wrong'
    ]) {
      expect(() => TvConfig.validateUrl(url), throwsArgumentError);
    }
    expect(TvConfig.validateUrl(' http://server:8096/ '), 'http://server:8096');
  });
}
