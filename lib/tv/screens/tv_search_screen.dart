import 'dart:async';
import 'package:Bloomee/blocs/settings_cubit/cubit/settings_cubit.dart';
import 'package:Bloomee/core/di/service_locator.dart';
import 'package:Bloomee/core/models/exported.dart';
import 'package:Bloomee/plugins/blocs/plugin/plugin_bloc.dart';
import 'package:Bloomee/screens/widgets/snackbar.dart';
import 'package:Bloomee/services/db/dao/track_dao.dart';
import 'package:Bloomee/services/db/dao/download_dao.dart';
import 'package:Bloomee/services/db/dao/playlist_dao.dart';
import 'package:Bloomee/services/db/db_provider.dart';
import 'package:Bloomee/services/db/mappers/media_item_mapper.dart';
import 'package:Bloomee/src/rust/api/plugin/commands.dart';
import 'package:Bloomee/tv/screens/tv_control_center.dart';
import 'package:Bloomee/tv/services/tv_saved_library.dart';
import 'package:Bloomee/tv/services/tv_search_controller.dart';
import 'package:Bloomee/tv/services/tv_workspace.dart';
import 'package:Bloomee/tv/services/tv_diagnostics.dart';
import 'package:Bloomee/tv/connectors/ytmusic_account.dart'
    show kYtMusicPluginId;
import 'package:Bloomee/tv/tv_config.dart';
import 'package:Bloomee/tv/ui/tv_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

const _voice = MethodChannel('bloomee_tv/voice');

/// Ricerca vocale: mostra "Ti ascolto…" con le parole riconosciute mentre
/// parli; restituisce il testo finale, o null se annullata.
Future<String?> listenVoice(BuildContext context) async {
  final partial = ValueNotifier<String>('');
  final state = ValueNotifier<String>('ready');
  _voice.setMethodCallHandler((call) async {
    if (call.method == 'partial') partial.value = call.arguments as String;
    if (call.method == 'state') state.value = call.arguments as String;
  });
  var dialogOpen = true;
  var cancelled = false;
  final nav = Navigator.of(context, rootNavigator: true);
  showDialog<void>(
    context: context,
    builder: (_) => _ListeningDialog(partial: partial, state: state),
  ).then((_) {
    if (dialogOpen) {
      cancelled = true;
      dialogOpen = false;
      _voice.invokeMethod('cancel');
    }
  });
  String? text;
  try {
    text = await _voice.invokeMethod<String>('listen', {'lang': 'it-IT'});
  } on PlatformException catch (e) {
    SnackbarService.showMessage(e.message ?? 'Ricerca vocale non disponibile');
  } on MissingPluginException {
    text = null;
  }
  if (dialogOpen) {
    dialogOpen = false;
    nav.pop();
  }
  _voice.setMethodCallHandler(null);
  final result = (text == null || text.trim().isEmpty) ? partial.value : text;
  partial.dispose();
  state.dispose();
  return cancelled || result.trim().isEmpty ? null : result;
}

class _ListeningDialog extends StatelessWidget {
  const _ListeningDialog({required this.partial, required this.state});
  final ValueNotifier<String> partial;
  final ValueNotifier<String> state;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: TvColors.surface,
      content: SizedBox(
        width: 560,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: const BoxDecoration(
                  color: TvColors.accent, shape: BoxShape.circle),
              child:
                  const Icon(Icons.mic_rounded, size: 52, color: Colors.white),
            ),
            const SizedBox(height: 20),
            ValueListenableBuilder<String>(
              valueListenable: state,
              builder: (_, s, __) => Text(
                switch (s) {
                  'processing' => 'Un attimo…',
                  'speech' => 'Ti ascolto…',
                  _ => 'Parla ora: artista, album o brano',
                },
                style: TvText.body.copyWith(fontSize: 18),
              ),
            ),
            const SizedBox(height: 12),
            ValueListenableBuilder<String>(
              valueListenable: partial,
              builder: (_, p, __) => Text(p.isEmpty ? ' ' : p,
                  textAlign: TextAlign.center,
                  style: TvText.hero.copyWith(fontSize: 34)),
            ),
          ],
        ),
      ),
      actions: [
        TvPillButton(
            icon: Icons.close,
            label: 'Annulla',
            autofocus: true,
            onTap: () => Navigator.of(context).pop()),
      ],
    );
  }
}

class TvSearchScreen extends StatefulWidget {
  const TvSearchScreen({super.key, this.controller});
  final TvSearchController? controller;
  @override
  State<TvSearchScreen> createState() => _TvSearchScreenState();
}

class _TvSearchScreenState extends State<TvSearchScreen> {
  late final _search = widget.controller ?? TvSearchController();
  final _query = TextEditingController();
  final _mic = FocusNode(debugLabel: 'tv-search-voice');
  String _source = 'Tutte', _kind = 'Tutto', _version = '';
  bool _offline = false,
      _alphabetical = false,
      _group = true,
      _filtersOpen = false;
  int? _year;
  int _queryGeneration = 0;
  bool _allSongs = false;
  final Map<String, TvSearchProvider> _more = {};
  @override
  void initState() {
    super.initState();
    TvConfig.changes.addListener(_configurationChanged);
    final prefs = TvWorkspace.instance['searchFilters'] as Map? ?? {};
    _source = prefs['source'] as String? ?? 'Tutte';
    if (_source == 'Jellyfin' && !TvConfig.hasJellyfin) _source = 'Tutte';
    _kind = prefs['kind'] as String? ?? 'Tutto';
    _offline = prefs['offline'] == true;
    _alphabetical = prefs['alphabetical'] == true;
  }

  void _configurationChanged() {
    _queryGeneration++;
    _more.clear();
    if (_source == 'Jellyfin' && !TvConfig.hasJellyfin) _source = 'Tutte';
    _search.clear();
  }

  Future<void> _runSearch() async {
    final generation = ++_queryGeneration;
    _allSongs = false;
    _more.clear();
    final q = _query.text.trim();
    if (q.isEmpty) {
      _search.clear();
      return;
    }
    final source = _source, kind = _kind, offline = _offline;
    final providers = <String, TvSearchProvider>{};
    final deferred = <String, TvSearchProvider>{};
    bool current() => mounted && generation == _queryGeneration;
    // Una pagina arrivata dopo il limite di tempo (o superata da una nuova
    // richiesta) non deve spostare offset e token: la pagina successiva
    // salterebbe risultati mai mostrati.
    final calls = <String, int>{};
    int begin(String key) => calls[key] = (calls[key] ?? 0) + 1;
    bool accepted(String key, int call) =>
        current() && calls[key] == call && _search.loading.contains(key);
    TvSearchHit hit(MediaItem item, String source,
        [Set<String> downloads = const {}]) {
      final ref = TvReference.item(item);
      return TvSearchHit(ref, source, offline: downloads.contains(ref.id));
    }

    if (offline || source == 'Tutte' || source == 'Locale') {
      var offset = 0;
      final dao = TrackDAO(DBProvider.db);
      Future<List<TvSearchHit>> page(String query) async {
        final call = begin('Locale');
        final rows = await dao.searchTracks(query, limit: 60, offset: offset);
        final downloads = await DownloadDAO(
                DBProvider.db, dao, PlaylistDAO(DBProvider.db, dao))
            .getValidDownloads();
        if (!accepted('Locale', call)) return [];
        offset += rows.length;
        if (rows.length == 60) {
          _more['Locale'] = page;
        } else {
          _more.remove('Locale');
        }
        final ids = downloads.map((d) => d.mediaId).toSet();
        return [
          for (final t in rows)
            hit(MediaItem.track(trackDBToTrack(t)), 'Locale', ids)
        ];
      }

      providers['Locale'] = page;
    }
    if (!offline && (source == 'Tutte' || source == 'YouTube')) {
      final client = TvConfig.youtube;
      final kinds =
          kind == 'Tutto' ? ['Brani', 'Artisti', 'Album', 'Playlist'] : [kind];
      for (final type in kinds) {
        final key = 'YouTube · $type';
        String? token;
        final tokens = <String>{};
        Future<List<TvSearchHit>> page(String query) async {
          final call = begin(key);
          final result = await client.searchPage(query,
              kind: const {
                'Brani': 'song',
                'Artisti': 'artist',
                'Album': 'album',
                'Playlist': 'playlist'
              }[type],
              continuation: token);
          if (!accepted(key, call)) return [];
          token = result.next;
          if (token != null && tokens.add(token!)) {
            _more[key] = page;
          } else {
            _more.remove(key);
          }
          return [
            for (final item in result.items) hit(item.toMedia(), 'YouTube')
          ];
        }

        ((kind == 'Tutto' && (type == 'Album' || type == 'Playlist'))
            ? deferred
            : providers)[key] = page;
      }
    }
    final jf = TvConfig.jellyfin;
    if (!offline &&
        jf != null &&
        (source == 'Tutte' || source == 'Jellyfin') &&
        kind != 'Playlist') {
      final groups = kind == 'Tutto'
          ? {'Brani e artisti': 'Audio,MusicArtist', 'Album': 'MusicAlbum'}
          : {
              kind: const {
                'Brani': 'Audio',
                'Artisti': 'MusicArtist',
                'Album': 'MusicAlbum'
              }[kind]!
            };
      for (final group in groups.entries) {
        final key = 'Jellyfin · ${group.key}';
        var offset = 0;
        Future<List<TvSearchHit>> page(String query) async {
          final call = begin(key);
          final items = await jf.search(query,
              start: offset, limit: 20, types: group.value);
          if (!accepted(key, call)) return [];
          offset += items.length;
          if (items.length == 20) {
            _more[key] = page;
          } else {
            _more.remove(key);
          }
          return [for (final item in items) hit(item.toMedia(jf), 'Jellyfin')];
        }

        ((kind == 'Tutto' && group.key == 'Album')
            ? deferred
            : providers)[key] = page;
      }
    }
    final resolvers = context.read<PluginBloc>().state.loadedContentResolvers;
    final preferred = context.read<SettingsCubit>().state.searchPluginId;
    final pluginId = resolvers
            .where((p) => p.manifest.id == preferred)
            .firstOrNull
            ?.manifest
            .id ??
        resolvers.firstOrNull?.manifest.id;
    // The built-in YouTube path already queries this catalog. Running its WASM
    // plugin too duplicated requests and competed with the first useful page.
    if (!offline &&
        pluginId != null &&
        (source == 'Plugin' ||
            (source == 'Tutte' && pluginId != kYtMusicPluginId))) {
      final filter = const {
            'Brani': ContentSearchFilter.track,
            'Artisti': ContentSearchFilter.artist,
            'Album': ContentSearchFilter.album,
            'Playlist': ContentSearchFilter.playlist
          }[kind] ??
          ContentSearchFilter.track;
      final filters = kind == 'Tutto'
          ? {'Brani': filter, 'Altri': ContentSearchFilter.all}
          : {kind: filter};
      for (final entry in filters.entries) {
        final key = 'Plugin · ${entry.key}';
        String? token;
        final tokens = <String>{};
        Future<List<TvSearchHit>> page(String query) async {
          final call = begin(key);
          final result = await ServiceLocator.pluginService.execute(
              pluginId: pluginId,
              request: PluginRequest.contentResolver(
                  ContentResolverCommand.search(
                      query: query, filter: entry.value, pageToken: token)));
          if (result is! PluginResponse_Search)
            throw StateError('Risposta di ricerca non valida');
          if (!accepted(key, call)) return [];
          token = result.field0.nextPageToken;
          if (token != null && tokens.add(token!)) {
            _more[key] = page;
          } else {
            _more.remove(key);
          }
          return result.field0.items
              .map((item) => hit(item, 'Plugin'))
              .toList();
        }

        (entry.key == 'Altri' ? deferred : providers)[key] = page;
      }
    }
    final request = _search.search(q, providers, deferred: deferred);
    // Start network work before preferences or download validation can touch disk.
    unawaited(TvWorkspace.instance.set('searchFilters', {
      'source': source,
      'kind': kind,
      'offline': offline,
      'alphabetical': _alphabetical
    }).catchError((Object e) {
      TvDiagnostics.instance.record('Preferenze ricerca', e);
    }));
    await request;
  }

  Future<void> _voiceSearch() async {
    final text = await listenVoice(context);
    if (text != null && mounted) {
      _query.text = text;
      await _runSearch();
    }
  }

  Future<void> _openVariants(List<TvSearchHit> variants) async {
    if (variants.length == 1) {
      await openTvReference(context, variants.first.reference);
      return;
    }
    final selected = await showDialog<TvReference>(
        context: context,
        builder: (ctx) => SimpleDialog(
                title: Text(variants.first.reference.title),
                children: [
                  for (final hit in variants)
                    SimpleDialogOption(
                        onPressed: () => Navigator.pop(ctx, hit.reference),
                        child:
                            Text('${hit.source} · ${hit.reference.subtitle}'))
                ]));
    if (selected != null && mounted) await openTvReference(context, selected);
  }

  @override
  void dispose() {
    TvConfig.changes.removeListener(_configurationChanged);
    if (widget.controller == null) _search.dispose();
    _query.dispose();
    _mic.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: _search,
      builder: (_, __) {
        final shown = _search.filtered(
            kind: _kind,
            offlineOnly: _offline,
            year: _year,
            version: _version,
            alphabetical: _alphabetical);
        final groups = _group
            ? TvSearchController.variants(shown).values.toList()
            : shown.map((h) => [h]).toList();
        final songs = groups.where((g) => g.first.kind == 'Brani').toList();
        return Scaffold(
            backgroundColor: TvColors.bg,
            body: CustomScrollView(slivers: [
              SliverToBoxAdapter(
                  child: Padding(
                      padding: const EdgeInsets.fromLTRB(48, 28, 48, 16),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Cerca', style: TvText.hero),
                            const SizedBox(height: 16),
                            Row(children: [
                              TvPillButton(
                                  focusNode: _mic,
                                  autofocus: true,
                                  icon: Icons.mic,
                                  label: 'Parla',
                                  onTap: _voiceSearch),
                              const SizedBox(width: 12),
                              Expanded(
                                  child: TvTextField(
                                      controller: _query,
                                      label: 'Artista, album o brano',
                                      actionLabel: 'Cerca',
                                      onSubmitted: (_) => _runSearch())),
                              const SizedBox(width: 12),
                              TvPillButton(
                                  icon: Icons.search,
                                  label: 'Cerca',
                                  onTap: _runSearch)
                            ]),
                            const SizedBox(height: 16),
                            Wrap(spacing: 12, runSpacing: 12, children: [
                              for (final kind in [
                                'Tutto',
                                'Brani',
                                'Album',
                                'Artisti'
                              ])
                                TvPillButton(
                                    key: ValueKey('search-kind-$kind'),
                                    icon: kind == _kind
                                        ? Icons.check
                                        : Icons.filter_list,
                                    label: kind,
                                    primary: kind == _kind,
                                    onTap: () {
                                      setState(() => _kind = kind);
                                      _runSearch();
                                    }),
                              TvPillButton(
                                  icon: Icons.tune,
                                  label: _kind == 'Playlist'
                                      ? 'Filtri · $_source · Playlist'
                                      : 'Filtri · $_source',
                                  onTap: () => setState(
                                      () => _filtersOpen = !_filtersOpen)),
                            ]),
                            if (_filtersOpen) ...[
                              const SizedBox(height: 12),
                              Wrap(spacing: 12, runSpacing: 12, children: [
                                for (final source in TvSearchController.sources(
                                    jellyfin: TvConfig.hasJellyfin,
                                    plugin: context
                                        .read<PluginBloc>()
                                        .state
                                        .loadedContentResolvers
                                        .isNotEmpty))
                                  TvPillButton(
                                      icon: source == _source
                                          ? Icons.check
                                          : Icons.source,
                                      label: source,
                                      primary: source == _source,
                                      onTap: () {
                                        setState(() => _source = source);
                                        _runSearch();
                                      }),
                              ]),
                              const SizedBox(height: 12),
                              Wrap(spacing: 12, runSpacing: 12, children: [
                                TvPillButton(
                                    icon: Icons.queue_music,
                                    label: 'Playlist',
                                    primary: _kind == 'Playlist',
                                    onTap: () {
                                      setState(() => _kind = 'Playlist');
                                      _runSearch();
                                    }),
                                TvPillButton(
                                    icon: Icons.offline_pin,
                                    label: _offline
                                        ? '✓ Solo scaricati'
                                        : 'Solo scaricati',
                                    onTap: () {
                                      setState(() => _offline = !_offline);
                                      _runSearch();
                                    }),
                                TvPillButton(
                                    icon: Icons.sort_by_alpha,
                                    label: _alphabetical
                                        ? 'Ordine A–Z'
                                        : 'Ordine sorgente',
                                    onTap: () => setState(
                                        () => _alphabetical = !_alphabetical)),
                                TvPillButton(
                                    icon: Icons.calendar_today,
                                    label: 'Anno: ${_year ?? 'tutti'}',
                                    onTap: () async {
                                      final v = await showTvKeyboard(context,
                                          title: 'Anno (vuoto per tutti)',
                                          initial: _year?.toString() ?? '');
                                      if (v != null && mounted)
                                        setState(() => _year = int.tryParse(v));
                                    }),
                                TvPillButton(
                                    icon: Icons.tune,
                                    label: _version.isEmpty
                                        ? 'Versione: tutte'
                                        : 'Versione: $_version',
                                    onTap: () async {
                                      final v = await showTvKeyboard(context,
                                          title:
                                              'Testo nel titolo: live, remix, remaster…',
                                          initial: _version);
                                      if (v != null && mounted)
                                        setState(() => _version = v);
                                    }),
                                TvPillButton(
                                    icon: Icons.layers,
                                    label: _group
                                        ? '✓ Raggruppa versioni'
                                        : 'Mostra tutte le versioni',
                                    onTap: () =>
                                        setState(() => _group = !_group)),
                              ]),
                              if (_year != null)
                                const Padding(
                                    padding: EdgeInsets.only(top: 12),
                                    child: Text(
                                        'Il filtro anno include solo i risultati che dichiarano un anno.')),
                            ],
                            if (_search.loading.isNotEmpty)
                              Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Text(
                                      'Ricerca in corso: ${_search.loading.join(', ')}…')),
                            for (final error in _search.errors.entries)
                              Padding(
                                  padding: const EdgeInsets.only(top: 10),
                                  child: Row(children: [
                                    Expanded(
                                        child: Text(
                                            '${error.key}: ${error.value}')),
                                    TvPillButton(
                                        icon: Icons.refresh,
                                        label: 'Riprova',
                                        onTap: _runSearch)
                                  ])),
                            if (_source == 'Jellyfin' && !TvConfig.hasJellyfin)
                              const Text(
                                  'Collega Jellyfin dalle Impostazioni TV.'),
                          ]))),
              if (_search.query.isEmpty)
                const SliverToBoxAdapter(
                    child: Padding(
                        padding:
                            EdgeInsets.symmetric(horizontal: 48, vertical: 32),
                        child: Text(
                            'Premi Parla oppure OK sulla barra per scrivere.')))
              else if (groups.isEmpty && _search.loading.isEmpty)
                const SliverToBoxAdapter(
                    child: Padding(
                        padding:
                            EdgeInsets.symmetric(horizontal: 48, vertical: 32),
                        child: Text('Nessun risultato con questi filtri.'))),
              if (songs.isNotEmpty) ...[
                const SliverToBoxAdapter(
                    child: Padding(
                        padding: EdgeInsets.fromLTRB(48, 8, 48, 12),
                        child: Text('Brani', style: TvText.title))),
                SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 48),
                    sliver: SliverList.builder(
                        itemCount:
                            _allSongs ? songs.length : songs.length.clamp(0, 4),
                        itemBuilder: (_, i) {
                          final variants = songs[i];
                          final ref = variants.first.reference;
                          final track = (ref.item as MediaItem_Track).field0;
                          return TvTrackTile(
                              key: ValueKey(ref.id),
                              index: i + 1,
                              title: ref.title,
                              subtitle:
                                  '${ref.subtitle} · ${variants.map((h) => h.source).toSet().join(' / ')}',
                              duration: track.durationMs == null
                                  ? null
                                  : Duration(
                                      milliseconds: track.durationMs!.toInt()),
                              onTap: () => _openVariants(variants),
                              onLongPress: () =>
                                  showTvReferenceMenu(context, ref));
                        })),
                if (songs.length > 4)
                  SliverToBoxAdapter(
                      child: Padding(
                          padding: const EdgeInsets.fromLTRB(48, 8, 48, 20),
                          child: Align(
                              alignment: Alignment.centerLeft,
                              child: TvPillButton(
                                  icon: Icons.list,
                                  label: _allSongs
                                      ? 'Mostra meno brani'
                                      : 'Tutti i ${songs.length} brani',
                                  onTap: () => setState(
                                      () => _allSongs = !_allSongs))))),
              ],
              for (final kind in ['Artisti', 'Album', 'Playlist'])
                if (groups.any((g) => g.first.kind == kind))
                  SliverToBoxAdapter(
                      key: ValueKey('results-$kind'),
                      child: Builder(builder: (_) {
                        final row =
                            groups.where((g) => g.first.kind == kind).toList();
                        return TvRow(
                            title: kind,
                            itemCount: row.length,
                            itemBuilder: (_, i) {
                              final variants = row[i];
                              final ref = variants.first.reference;
                              return TvCard(
                                  key: ValueKey(ref.id),
                                  title: ref.title,
                                  subtitle:
                                      '${ref.subtitle} · ${variants.map((h) => h.source).toSet().join(' / ')}${variants.length > 1 ? ' · ${variants.length} versioni' : ''}',
                                  imageUrl: ref.image,
                                  onTap: () => _openVariants(variants),
                                  onLongPress: () =>
                                      showTvReferenceMenu(context, ref));
                            });
                      })),
              if (_more.isNotEmpty)
                SliverToBoxAdapter(
                    child: Padding(
                        padding: const EdgeInsets.fromLTRB(48, 16, 48, 24),
                        child: Wrap(spacing: 12, runSpacing: 12, children: [
                          for (final entry in _more.entries)
                            TvPillButton(
                                icon: Icons.expand_more,
                                label: 'Altri risultati · ${entry.key}',
                                onTap: _search.loading.contains(entry.key)
                                    ? null
                                    : () => _search.loadMore(
                                        entry.key, entry.value))
                        ]))),
              const SliverToBoxAdapter(child: SizedBox(height: 32)),
            ]));
      });
}
