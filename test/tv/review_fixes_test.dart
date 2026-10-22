import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:Bloomee/core/models/exported.dart';
import 'package:Bloomee/services/db/db_provider.dart';
import 'package:Bloomee/services/player/player_engine.dart';
import 'package:Bloomee/services/player/related_songs_manager.dart';
import 'package:Bloomee/services/plugin/plugin_service.dart';
import 'package:Bloomee/src/rust/api/plugin/commands.dart';
import 'package:Bloomee/tv/connectors/ytmusic_account.dart';
import 'package:Bloomee/tv/screens/tv_control_center.dart';
import 'package:Bloomee/tv/services/tv_saved_library.dart';
import 'package:Bloomee/tv/services/tv_search_controller.dart';
import 'package:Bloomee/tv/tv_focus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../support/tracks.dart';

void main() {
  Map<String, dynamic> runs(List<Object> parts) => {
        'runs': [
          for (final p in parts) p is String ? {'text': p} : p,
        ]
      };
  Map<String, dynamic> channel(String name, String id) => {
        'text': name,
        'navigationEndpoint': {
          'browseEndpoint': {'browseId': id}
        }
      };
  Map<String, dynamic> bareSong(String id) => {
        'musicResponsiveListItemRenderer': {
          'playlistItemData': {'videoId': id},
          'flexColumns': [
            {
              'musicResponsiveListItemFlexColumnRenderer': {
                'text': runs(['Brano $id'])
              }
            }
          ]
        }
      };

  group('album artist', () {
    Future<List<YtItem>> tracksOf(Map<String, dynamic> header) async {
      final transport = MockClient((_) async => http.Response.bytes(
          utf8.encode(jsonEncode({
            'header': header,
            'contents': [bareSong('a1')]
          })),
          200));
      addTearDown(transport.close);
      return (await YtMusicClient(client: transport)
              .collection('MPREb_${header.hashCode}'))
          .tracks;
    }

    test('comes from the strapline, not from "Album • 2006"', () async {
      final tracks = await tracksOf({
        'musicResponsiveHeaderRenderer': {
          'title': runs(['Io canto']),
          'straplineTextOne': runs(['Laura Pausini']),
          'subtitle': runs(['Album', ' • ', '2006']),
        }
      });
      expect(tracks.single.artistNames, 'Laura Pausini');
    });

    test('uses the channel link in the subtitle when there is one', () async {
      final tracks = await tracksOf({
        'musicDetailHeaderRenderer': {
          'title': runs(['Io canto']),
          'subtitle': runs(
              ['Album', ' • ', channel('Laura Pausini', 'UCp'), ' • ', '2006']),
        }
      });
      expect(tracks.single.artists.single.id, 'UCp');
      expect(tracks.single.album?.name, 'Io canto');
    });
  });

  testWidgets(
      'holding OK opens the menu and key repeats do not choose its first option',
      (tester) async {
    final item = TvReference.item(MediaItem.track(track('yt::a')));
    await tester.pumpWidget(MaterialApp(
        home: Builder(
            builder: (context) => Scaffold(
                body: TvFocusable(
                    autofocus: true,
                    onTap: () {},
                    onLongPress: () => showTvReferenceMenu(context, item),
                    child: const Text('Copertina'))))));
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.select);
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 60));
      await tester.sendKeyRepeatEvent(LogicalKeyboardKey.select);
    }
    await tester.pump(const Duration(milliseconds: 100));
    await tester.sendKeyUpEvent(LogicalKeyboardKey.select);
    await tester.pumpAndSettle();
    expect(find.text('Fissa / rimuovi dalla Home'), findsOneWidget,
        reason: 'the menu must stay open after a long press with repeats');
  });

  test('a search page that arrives after the time limit is not the current one',
      () async {
    // La ricerca TV accetta una pagina solo mentre il controller la aspetta:
    // dopo il limite di tempo la sorgente non risulta più in caricamento, così
    // la pagina in ritardo non sposta offset e token.
    final search =
        TvSearchController(timeout: const Duration(milliseconds: 20));
    addTearDown(search.dispose);
    final late = Completer<List<TvSearchHit>>();
    bool? waitedFor;
    await search.search('q', {
      'YouTube · Brani': (_) async {
        final hits = await late.future;
        waitedFor = search.loading.contains('YouTube · Brani');
        return hits;
      }
    });
    expect(search.errors.keys, ['YouTube · Brani']);
    late.complete([]);
    await Future<void>.delayed(Duration.zero);
    expect(waitedFor, isFalse);
  });

  test('autoplay radio that arrives after the queue changed is not appended',
      () async {
    final root = await Directory.systemTemp.createTemp('bloomee_radio_test_');
    addTearDown(() async {
      final db = await DBProvider.db;
      if (db.isOpen) await db.close();
      root.deleteSync(recursive: true);
    });
    await DBProvider.init(
        appSupportPath: root.path,
        appDocumentsPath: root.path,
        allowLegacyRecovery: false);
    final radio = Completer<PluginResponse>();
    final manager = RelatedSongsManager(_PendingPlugins(radio.future));
    final added = <Track>[];
    manager.onAddQueueItems =
        (items, {bool atLast = false}) => added.addAll(items);
    final playing = track('plugin::a');
    final pending = manager.checkForRelatedSongs(
        currentMedia: playing,
        queue: [playing],
        currentPlayingIdx: 0,
        loopMode: LoopMode.off);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    // L'utente avvia un'altra coda: loadPlaylist svuota la radio.
    manager.clearRelatedSongs();
    radio.complete(PluginResponse.moreTracks(
        PagedTracks(items: [track('plugin::b'), track('plugin::c')])));
    await pending;
    expect(added, isEmpty);
    expect(manager.relatedSongs.value, isEmpty);
  });
}

class _PendingPlugins extends PluginService {
  _PendingPlugins(this.response);
  final Future<PluginResponse> response;
  @override
  Future<PluginResponse> execute(
          {required String pluginId, required PluginRequest request}) =>
      response;
}
