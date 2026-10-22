import 'package:Bloomee/tv/services/tv_image_privacy.dart';
import 'package:Bloomee/tv/services/tv_workspace.dart';
import 'package:Bloomee/tv/connectors/tv_http.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:Bloomee/core/models/exported.dart';
import 'package:Bloomee/services/db/dao/settings_dao.dart';
import 'package:Bloomee/services/db/db_provider.dart';
import 'package:Bloomee/tv/connectors/jellyfin_client.dart';
import 'package:Bloomee/tv/connectors/lidarr_client.dart';
import 'package:Bloomee/tv/connectors/ytmusic_account.dart';
import 'package:Bloomee/tv/services/tv_secret_store.dart';
import 'package:Bloomee/tv/services/tv_diagnostics.dart';
import 'package:Bloomee/tv/services/tv_catalog_cache.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

const String kJellyfinPluginId = 'jellyfin';

class TvConfig {
  TvConfig._();
  static TvSecretStore secretStore = AndroidTvSecretStore();
  static http.Client httpClient = tvHttpClient;
  static String profileId = 'default';
  static int screenOffSeconds = 0;
  static Future<void> saveScreenOffSeconds(int value) async {
    final bounded = value.clamp(0, 3600);
    await _dao.putSettings({'tv.screenOffSeconds': bounded.toString()});
    screenOffSeconds = bounded;
    changes.value++;
  }
  static String ytCookie = '', ytVisitor = '', ytDataSync = '', ytName = '';
  static String jellyfinUrl = '',
      jellyfinUser = '',
      jellyfinToken = '',
      jellyfinUserId = '';
  static String lidarrUrl = '', lidarrKey = '';
  static final changes = ValueNotifier<int>(0);
  static SettingsDAO get _dao => SettingsDAO(DBProvider.db);
  static bool get hasYouTube => youtube.loggedIn;
  static bool get hasJellyfin =>
      jellyfinUrl.isNotEmpty &&
      jellyfinToken.isNotEmpty &&
      jellyfinUserId.isNotEmpty;
  static bool get hasLidarr => lidarrUrl.isNotEmpty && lidarrKey.isNotEmpty;
  static YtMusicClient get youtube => YtMusicClient(
      cookie: ytCookie,
      visitorData: ytVisitor,
      dataSyncId: ytDataSync,
      client: httpClient);
  static JellyfinClient? get jellyfin => hasJellyfin
      ? JellyfinClient(
          baseUrl: jellyfinUrl,
          token: jellyfinToken,
          userId: jellyfinUserId,
          client: httpClient)
      : null;
  static LidarrClient? get lidarr => hasLidarr
      ? LidarrClient(baseUrl: lidarrUrl, apiKey: lidarrKey, client: httpClient)
      : null;
  static Map<String, String>? artworkHeaders(String? imageUrl) {
    final image = Uri.tryParse(imageUrl ?? '');
    final server = Uri.tryParse(jellyfinUrl);
    return hasJellyfin &&
            image != null &&
            server != null &&
            image.hasAuthority &&
            image.origin == server.origin
        ? jellyfin!.imageHeaders
        : null;
  }

  static String validateUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw ArgumentError(
          'Inserisci un indirizzo http:// o https:// completo, senza credenziali o parametri');
    }
    return uri.toString().replaceAll(RegExp(r'/+$'), '');
  }

  static Map<String, String> get _secrets => {
        'tv.jellyfin.token': jellyfinToken,
        'tv.lidarr.key': lidarrKey,
        'tv.yt.cookie': ytCookie,
        'tv.yt.visitor': ytVisitor,
        'tv.yt.datasync': ytDataSync
      };
  static Future<void> _writes = Future.value();
  static Future<void> _commit(
      Map<String, String> secrets, Map<String, String> metadata) {
    final profile = profileId;
    final dao = _dao;
    final operation = _writes.then((_) async {
      if (profileId != profile)
        throw StateError('Profilo cambiato durante il salvataggio');
      final previous = await secretStore.read(profile);
      final next = {...previous, ..._secrets, ...secrets};
      await secretStore.write(profile, next);
      try {
        await dao.putSettings(metadata);
      } catch (_) {
        await secretStore.write(profile, previous);
        rethrow;
      }
    });
    _writes = operation.catchError((Object _) {});
    return operation;
  }

  static Future<void> flush() => _writes;
  static Future<void> load() async {
    await _writes;
    final d = _dao;
    screenOffSeconds =
        (int.tryParse(await d.getSettingStr('tv.screenOffSeconds') ?? '') ?? 0)
            .clamp(0, 3600);
    final secure = await secretStore.read(profileId);
    var migrated = false;
    for (final key in [
      'tv.jellyfin.token',
      'tv.lidarr.key',
      'tv.yt.cookie',
      'tv.yt.visitor',
      'tv.yt.datasync'
    ]) {
      final legacy = await d.getSettingStr(key);
      if (legacy != null && legacy.isNotEmpty && !secure.containsKey(key)) {
        secure[key] = legacy;
        migrated = true;
      }
    }
    if (migrated) await secretStore.write(profileId, secure);
    // Erase legacy plaintext only after a successful durable secure write.
    for (final key in secure.keys) {
      await d.removeSettingStr(key);
    }
    jellyfinUrl = await d.getSettingStr('tv.jellyfin.url') ?? '';
    jellyfinUser = await d.getSettingStr('tv.jellyfin.user') ?? '';
    jellyfinUserId = await d.getSettingStr('tv.jellyfin.userId') ?? '';
    lidarrUrl = await d.getSettingStr('tv.lidarr.url') ?? '';
    ytName = await d.getSettingStr('tv.yt.name') ?? '';
    jellyfinToken = !secure.containsKey('tv.jellyfin.boundUrl') ||
            (secure['tv.jellyfin.boundUrl'] == jellyfinUrl &&
                secure['tv.jellyfin.boundUserId'] == jellyfinUserId)
        ? secure['tv.jellyfin.token'] ?? ''
        : '';
    lidarrKey = !secure.containsKey('tv.lidarr.boundUrl') ||
            secure['tv.lidarr.boundUrl'] == lidarrUrl
        ? secure['tv.lidarr.key'] ?? ''
        : '';
    ytCookie = secure['tv.yt.cookie'] ?? '';
    ytVisitor = secure['tv.yt.visitor'] ?? '';
    ytDataSync = secure['tv.yt.datasync'] ?? '';
    changes.value++;
  }

  static Future<void> saveYouTube(
      {required String cookie,
      required String visitor,
      required String dataSync,
      required String name}) async {
    final profile = profileId;
    final generation = TvWorkspace.instance.generation;
    await _commit({
      'tv.yt.cookie': cookie,
      'tv.yt.visitor': visitor,
      'tv.yt.datasync': dataSync
    }, {
      'tv.yt.name': name
    });
    await TvCatalogCache.instance.clearSource('youtube');
    await TvImagePrivacy.clear();
    if (profile != profileId || generation != TvWorkspace.instance.generation)
      return;
    ytCookie = cookie;
    ytVisitor = visitor;
    ytDataSync = dataSync;
    ytName = name;
    changes.value++;
  }

  static Future<void> saveJellyfin(
      {required String url,
      required String user,
      required String token,
      required String userId}) async {
    final profile = profileId;
    final generation = TvWorkspace.instance.generation;
    final clean = validateUrl(url);
    await _commit({
      'tv.jellyfin.token': token,
      'tv.jellyfin.boundUrl': clean,
      'tv.jellyfin.boundUserId': userId
    }, {
      'tv.jellyfin.url': clean,
      'tv.jellyfin.user': user,
      'tv.jellyfin.userId': userId
    });
    await TvCatalogCache.instance.clearSource('jellyfin');
    await TvImagePrivacy.clear();
    if (profile != profileId || generation != TvWorkspace.instance.generation)
      return;
    jellyfinUrl = clean;
    jellyfinUser = user;
    jellyfinToken = token;
    jellyfinUserId = userId;
    changes.value++;
  }

  static Future<void> saveLidarr(
      {required String url, required String key}) async {
    final profile = profileId;
    final generation = TvWorkspace.instance.generation;
    final clean = validateUrl(url);
    await _commit({'tv.lidarr.key': key, 'tv.lidarr.boundUrl': clean},
        {'tv.lidarr.url': clean});
    if (profile != profileId || generation != TvWorkspace.instance.generation)
      return;
    lidarrUrl = clean;
    lidarrKey = key;
    changes.value++;
  }

  static Future<void> clearJellyfin() =>
      saveJellyfin(url: jellyfinUrl, user: jellyfinUser, token: '', userId: '');
  static Future<void> clearLidarr() => saveLidarr(url: lidarrUrl, key: '');
  static Future<void> importFromFile() async {
    final directory = await getExternalStorageDirectory();
    if (directory == null) return;
    final file = File('${directory.path}/tv-config.json');
    if (!await file.exists()) return;
    await importFile(file);
  }

  static Future<bool> importFile(File file) async {
    try {
      final value = jsonDecode(await file.readAsString());
      if (value is! Map<String, dynamic>)
        throw const FormatException('Configurazione non valida');
      final m = Map<String, String>.from(value);
      if (m.keys.any((key) => ![
                'lidarrUrl',
                'lidarrKey',
                'jellyfinUrl',
                'jellyfinUser',
                'jellyfinToken'
              ].contains(key)) ||
          (!m.containsKey('lidarrKey') && !m.containsKey('jellyfinToken')))
        throw const FormatException('Campi di configurazione non validi');
      final ldUrl = m.containsKey('lidarrKey')
          ? validateUrl(m['lidarrUrl'] ?? lidarrUrl)
          : null;
      final jfUrl = m.containsKey('jellyfinToken')
          ? validateUrl(m['jellyfinUrl'] ?? jellyfinUrl)
          : null;
      String? jfId;
      if (ldUrl != null)
        await LidarrClient(
                baseUrl: ldUrl, apiKey: m['lidarrKey']!, client: httpClient)
            .ping();
      if (jfUrl != null) {
        final c = JellyfinClient(
            baseUrl: jfUrl, token: m['jellyfinToken'], client: httpClient);
        jfId = await c.userIdByName(m['jellyfinUser'] ?? '');
        if (jfId == null)
          throw const FormatException('Utente Jellyfin non trovato');
      }
      // All fields and remote checks are validated before changing anything.
      final newSecrets = {
        ..._secrets,
        if (ldUrl != null) ...{
          'tv.lidarr.key': m['lidarrKey']!,
          'tv.lidarr.boundUrl': ldUrl
        },
        if (jfUrl != null) ...{
          'tv.jellyfin.token': m['jellyfinToken']!,
          'tv.jellyfin.boundUrl': jfUrl,
          'tv.jellyfin.boundUserId': jfId!
        }
      };
      await _commit(newSecrets, {
        if (ldUrl != null) 'tv.lidarr.url': ldUrl,
        if (jfUrl != null) ...{
          'tv.jellyfin.url': jfUrl,
          'tv.jellyfin.user': m['jellyfinUser'] ?? '',
          'tv.jellyfin.userId': jfId!
        }
      });
      await TvCatalogCache.instance.clearAll();
      await load();
      await file.delete();
      return true;
    } catch (e) {
      TvDiagnostics.instance.record('Configurazione', e);
      return false;
    }
  }
}

/// Conversioni da elementi Jellyfin ai modelli dell'app, così i brani
/// Jellyfin passano dallo stesso player, coda, testi e cronologia.
extension JfItemToTrack on JfItem {
  Artwork artwork(JellyfinClient c) {
    final img = imageItemId;
    final url = img == null ? '' : c.imageUrl(img, maxSize: 400);
    return Artwork(
      url: url,
      urlLow: img == null ? null : c.imageUrl(img, maxSize: 200),
      urlHigh: img == null ? null : c.imageUrl(img, maxSize: 900),
      layout: ImageLayout.square,
    );
  }

  Track toTrack(JellyfinClient c) => Track(
        id: '$kJellyfinPluginId::$id',
        title: name,
        artists: [
          ArtistSummary(
              id: '$kJellyfinPluginId::artist:$albumArtist', name: albumArtist)
        ],
        album: albumId == null
            ? null
            : AlbumSummary(
                id: '$kJellyfinPluginId::$albumId',
                title: album,
                artists: [
                  ArtistSummary(
                      id: '$kJellyfinPluginId::artist:$albumArtist',
                      name: albumArtist)
                ],
                year: year,
              ),
        durationMs: BigInt.from(duration.inMilliseconds),
        thumbnail: artwork(c),
        isExplicit: false,
      );
}

/// Conversioni da YouTube Music ai modelli dell'app (riproduzione col plugin
/// ytmusic già installato).
extension YtItemToModels on YtItem {
  Artwork get artwork => Artwork(
        url: thumbnail ?? '',
        urlHigh: thumbnail,
        urlLow: thumbnail?.replaceAll(RegExp(r'=w544-h544'), '=w226-h226'),
        layout: ImageLayout.square,
      );

  List<ArtistSummary> get artistSummaries => [
        for (final a in artists)
          ArtistSummary(
              id: '$kYtMusicPluginId::${a.id ?? a.name}', name: a.name),
      ];

  Track toTrack() => Track(
        id: '$kYtMusicPluginId::$videoId',
        title: title,
        artists: artistSummaries,
        album: album == null
            ? null
            : AlbumSummary(
                id: '$kYtMusicPluginId::${album!.id ?? album!.name}',
                title: album!.name,
                artists: artistSummaries),
        durationMs:
            duration == null ? null : BigInt.from(duration!.inMilliseconds),
        thumbnail: artwork,
        isExplicit: false,
      );

  ArtistSummary toArtist() => ArtistSummary(
      id: '$kYtMusicPluginId::$browseId', name: title, thumbnail: artwork);
}

extension YtItemToSavedMedia on YtItem {
  MediaItem toMedia() => switch (kind) {
        'song' => MediaItem.track(toTrack()),
        'artist' => MediaItem.artist(toArtist()),
        'album' => MediaItem.album(AlbumSummary(
            id: '$kYtMusicPluginId::$browseId',
            title: title,
            artists: artistSummaries,
            thumbnail: artwork)),
        _ => MediaItem.playlist(PlaylistSummary(
            id: '$kYtMusicPluginId::$browseId',
            title: title,
            owner: artistNames,
            thumbnail: artwork)),
      };
}

extension JfItemToSavedMedia on JfItem {
  MediaItem toMedia(JellyfinClient client) => switch (type) {
        'Audio' => MediaItem.track(toTrack(client)),
        'MusicArtist' => MediaItem.artist(ArtistSummary(
            id: '$kJellyfinPluginId::$id',
            name: name,
            thumbnail: artwork(client))),
        _ => MediaItem.album(AlbumSummary(
            id: '$kJellyfinPluginId::$id',
            title: name,
            artists: [ArtistSummary(id: '', name: albumArtist)],
            year: year,
            thumbnail: artwork(client))),
      };
}
