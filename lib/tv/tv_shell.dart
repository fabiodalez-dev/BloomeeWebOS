import 'package:Bloomee/tv/ui/tv_screen_off_guard.dart';
import 'dart:async';

import 'package:Bloomee/blocs/media_player/bloomee_player_cubit.dart';
import 'package:Bloomee/blocs/mini_player/mini_player_cubit.dart';
import 'package:Bloomee/blocs/player_overlay/player_overlay_cubit.dart';
import 'package:Bloomee/screens/widgets/mini_player_widget.dart';
import 'package:Bloomee/screens/widgets/player_overlay_wrapper.dart';
import 'package:Bloomee/tv/screens/tv_jellyfin_screen.dart';
import 'package:Bloomee/tv/screens/tv_settings_screen.dart';
import 'package:Bloomee/tv/screens/tv_youtube_screen.dart';
import 'package:Bloomee/tv/tv_focus.dart';
import 'package:Bloomee/tv/ui/tv_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

/// Voce del menu laterale: o un ramo del router (indice) o una pagina TV.
class _MenuEntry {
  const _MenuEntry(this.icon, this.label, {this.branch, this.page});
  final IconData icon;
  final String label;
  final int? branch;
  final _TvPage? page;
}

enum _TvPage { jellyfin, youtube, settings }

/// Contenitore principale su TV: menu laterale che si allarga quando ha il
/// focus, contenuto a destra, mini player in basso. Il passaggio tra menu e
/// contenuto è gestito a mano (freccia sinistra al bordo → menu, destra →
/// contenuto), perché ogni ramo del router ha il suo scope di focus e la
/// navigazione direzionale di Flutter non lo attraversa.
class TvShell extends StatefulWidget {
  const TvShell({super.key, required this.navigationShell});
  final StatefulNavigationShell navigationShell;

  @override
  State<TvShell> createState() => _TvShellState();
}

class _TvShellState extends State<TvShell> {
  static const _entries = [
    _MenuEntry(Icons.home_rounded, 'Home', branch: 0),
    _MenuEntry(Icons.search_rounded, 'Cerca', branch: 2),
    _MenuEntry(Icons.library_music_rounded, 'La tua musica',
        page: _TvPage.jellyfin),
    _MenuEntry(Icons.smart_display_rounded, 'Il mio YouTube',
        page: _TvPage.youtube),
    _MenuEntry(Icons.favorite_rounded, 'Libreria', branch: 1),
    _MenuEntry(Icons.download_done_rounded, 'Scaricati', branch: 4),
    _MenuEntry(Icons.settings_rounded, 'Impostazioni', page: _TvPage.settings),
  ];

  final _menuScope = FocusScopeNode(debugLabel: 'tv-menu');
  final _contentScope = FocusScopeNode(debugLabel: 'tv-content');
  // Barra del brano in riproduzione: zona a sé, raggiungibile con giù dal
  // fondo della pagina o con destra da "In riproduzione" nel menu.
  final _barScope = FocusScopeNode(debugLabel: 'tv-bar');
  late final List<FocusNode> _itemNodes = List.generate(
      _entries.length + 1, (i) {
    final n = FocusNode(debugLabel: 'tv-menu-$i');
    tvMarkSelfHighlighted(n);
    return n;
  });
  final _navKeys = {
    _TvPage.jellyfin: GlobalKey<NavigatorState>(),
    _TvPage.youtube: GlobalKey<NavigatorState>(),
    _TvPage.settings: GlobalKey<NavigatorState>(),
  };

  int _selected = 0;
  bool _menuFocused = false;
  FocusNode? _lastContent;
  StreamSubscription? _nowPlayingSub;

  _TvPage? get _page => _entries[_selected].page;

  @override
  void initState() {
    super.initState();
    _menuScope.addListener(_onMenuFocus);
    tvFocusMenu = _focusMenu;
    FocusManager.instance.addListener(_trackContentFocus);
    _nowPlayingSub = context.read<BloomeePlayerCubit>().bloomeePlayer.mediaItem.listen((mi) => tvNowPlayingTitle.value = mi?.title);
    // Primo focus sul contenuto appena la home ha qualcosa da mostrare.
    for (final d in const [600, 1500, 3000]) {
      Future.delayed(Duration(milliseconds: d), () {
        final p = FocusManager.instance.primaryFocus;
        if (mounted && (p == null || p is FocusScopeNode || !_visibleElement(p))) {
          _focusContent(restore: false);
        }
      });
    }
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_trackContentFocus);
    _nowPlayingSub?.cancel();
    if (tvFocusMenu == _focusMenu) tvFocusMenu = null;
    _menuScope.dispose();
    _contentScope.dispose();
    _barScope.dispose();
    for (final n in _itemNodes) {
      n.dispose();
    }
    super.dispose();
  }

  void _onMenuFocus() {
    if (_menuFocused != _menuScope.hasFocus) {
      setState(() => _menuFocused = _menuScope.hasFocus);
    }
  }

  void _trackContentFocus() {
    final p = FocusManager.instance.primaryFocus;
    if (p != null &&
        p is! FocusScopeNode &&
        p.ancestors.contains(_contentScope)) {
      _lastContent = p;
    }
  }

  void _focusMenu() => _itemNodes[_selected].requestFocus();

  /// Elemento con il focus davvero visibile sullo schermo.
  bool _visibleElement(FocusNode n) {
    if (n.context == null) return false;
    final r = n.rect;
    final size = MediaQuery.sizeOf(context);
    return !r.isEmpty && r.overlaps(Offset.zero & size) && r.width > 8 && r.height > 8;
  }

  bool get _barVisible => context.read<MiniPlayerCubit>().state.isVisible;

  /// Porta il focus sul pulsante play/pausa della barra (o sul primo).
  bool _focusBar() {
    if (!_barVisible) return false;
    final nodes = _barScope.traversalDescendants
        .where((n) =>
            n.canRequestFocus && n is! FocusScopeNode && n.context != null)
        .toList();
    if (nodes.isEmpty) return false;
    // Il pulsante più largo vicino al centro è play/pausa; in mancanza, il primo.
    nodes.sort((a, b) => a.rect.left.compareTo(b.rect.left));
    final play = nodes.length >= 3 ? nodes[nodes.length - 3] : nodes.first;
    play.requestFocus();
    return true;
  }

  KeyEventResult _onBarKey(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent && e is! KeyRepeatEvent)
      return KeyEventResult.ignored;
    final p = FocusManager.instance.primaryFocus;
    if (e.logicalKey == LogicalKeyboardKey.arrowUp) {
      _focusContentFromBar();
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.arrowDown)
      return KeyEventResult.handled;
    if (p != null &&
        (e.logicalKey == LogicalKeyboardKey.arrowLeft ||
            e.logicalKey == LogicalKeyboardKey.arrowRight)) {
      final left = e.logicalKey == LogicalKeyboardKey.arrowLeft;
      if (!tvMoveHorizontally(p, left: left) && left) _focusMenu();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  /// Su dalla barra: l'ultimo elemento usato se è ancora sullo schermo,
  /// altrimenti l'elemento visibile più in basso (il più vicino alla barra).
  void _focusContentFromBar() {
    final last = _lastContent;
    if (last != null && last.context != null && last.canRequestFocus &&
        last.ancestors.contains(_contentScope) && _visibleElement(last)) {
      last.requestFocus();
      return;
    }
    final size = MediaQuery.sizeOf(context);
    final barTop = size.height - 90;
    FocusNode? best;
    for (final n in _contentScope.traversalDescendants) {
      if (n is FocusScopeNode || !n.canRequestFocus || n.skipTraversal || n.context == null) continue;
      if (!_visibleElement(n) || n.rect.bottom > barTop + 4) continue;
      if (best == null ||
          n.rect.bottom > best.rect.bottom + 4 ||
          ((n.rect.bottom - best.rect.bottom).abs() <= 4 && n.rect.left < best.rect.left)) {
        best = n;
      }
    }
    if (best != null) {
      best.requestFocus();
    } else {
      _focusContent(restore: false);
    }
  }

  void _focusContent({bool restore = true}) {
    final last = _lastContent;
    if (restore &&
        last != null &&
        last.context != null &&
        last.canRequestFocus &&
        last.ancestors.contains(_contentScope)) {
      last.requestFocus();
      return;
    }
    // Primo elemento visibile della pagina; se la pagina sta ancora
    // caricando, riprovo finché compare qualcosa.
    for (final ms in const [0, 250, 600, 1200, 2500]) {
      Future.delayed(Duration(milliseconds: ms), () {
        if (!mounted) return;
        final p = FocusManager.instance.primaryFocus;
        final onElement = p != null && p is! FocusScopeNode && p.ancestors.contains(_contentScope) && _visibleElement(p);
        if (onElement && ms > 0) return;
        if (ms > 0 && (_menuScope.hasFocus || _barScope.hasFocus)) return;
        tvFocusFirstIn(_contentScope);
      });
    }
  }

  void _select(int i) {
    final e = _entries[i];
    final reselect = i == _selected;
    setState(() => _selected = i);
    if (e.branch != null) {
      final b = e.branch!;
      // Riselezionare la sezione corrente chiude le pagine aperte sopra
      // (album, artista…) e torna alla sua pagina principale.
      if (reselect || b == widget.navigationShell.currentIndex) {
        widget.navigationShell.route.branches[b].navigatorKey.currentState
            ?.popUntil((r) => r.isFirst);
      }
      widget.navigationShell.goBranch(b,
          initialLocation: b == widget.navigationShell.currentIndex);
    } else if (reselect) {
      _navKeys[e.page]?.currentState?.popUntil((r) => r.isFirst);
    }
    _lastContent = null;
    Future.delayed(const Duration(milliseconds: 300), () {
      if (!mounted) return;
      _contentScope.requestFocus();
      _focusContent(restore: false);
    });
  }

  // ── Tasti ────────────────────────────────────────────────────────────

  KeyEventResult _onMenuKey(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent && e is! KeyRepeatEvent)
      return KeyEventResult.ignored;
    final cur = _itemNodes.indexWhere((n) => n.hasPrimaryFocus);
    final count = _visibleItemCount;
    if (e.logicalKey == LogicalKeyboardKey.arrowDown) {
      if (cur >= 0 && cur < count - 1) _itemNodes[cur + 1].requestFocus();
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.arrowUp) {
      if (cur > 0) _itemNodes[cur - 1].requestFocus();
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.arrowRight) {
      if (cur == _entries.length && _focusBar()) return KeyEventResult.handled;
      _focusContent();
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.arrowLeft)
      return KeyEventResult.handled;
    return KeyEventResult.ignored;
  }

  int get _visibleItemCount =>
      _entries.length +
      (context.read<MiniPlayerCubit>().state.isVisible ? 1 : 0);

  KeyEventResult _onContentKey(FocusNode node, KeyEvent e) {
    if ((e is KeyDownEvent || e is KeyRepeatEvent) &&
        e.logicalKey == LogicalKeyboardKey.arrowDown) {
      final p = FocusManager.instance.primaryFocus;
      if (p == null || p is FocusScopeNode) return KeyEventResult.ignored;
      if (p.context?.findAncestorStateOfType<EditableTextState>() != null)
        return KeyEventResult.ignored;
      if (tvVerticalBusy) return KeyEventResult.handled;
      // Giù: elemento sotto; in fondo alla pagina, la barra del brano.
      if (tvMoveVertically(p, down: true)) return KeyEventResult.handled;
      if (Scrollable.maybeOf(p.context!) == null &&
          p.focusInDirection(TraversalDirection.down)) {
        return KeyEventResult.handled;
      }
      // Niente sotto ma la pagina continua (righe non ancora costruite):
      // scorro e riprovo; alla barra solo quando la pagina è davvero finita.
      final sc = Scrollable.maybeOf(p.context!);
      if (sc != null && sc.position.extentAfter > 1) {
        final pos = sc.position;
        tvScrollThen(pos, pos.pixels + pos.viewportDimension * 0.5, () {
          if (p.hasPrimaryFocus) tvMoveVertically(p, down: true);
        });
        return KeyEventResult.handled;
      }
      if (e is KeyDownEvent && _focusBar()) return KeyEventResult.handled;
      return KeyEventResult.handled;
    }
    if (e is! KeyDownEvent || e.logicalKey != LogicalKeyboardKey.arrowLeft) {
      return KeyEventResult.ignored;
    }
    final before = FocusManager.instance.primaryFocus;
    if (before == null) return KeyEventResult.ignored;
    // Nei campi di testo la freccia sposta il cursore.
    final editable =
        before.context?.findAncestorStateOfType<EditableTextState>();
    if (editable != null && !editable.widget.readOnly) {
      return KeyEventResult.ignored;
    }
    // Il cambio di focus viene applicato in un microtask: conta l'esito
    // restituito, non primaryFocus (che qui non è ancora aggiornato).
    if (!tvMoveHorizontally(before, left: true)) _focusMenu();
    return KeyEventResult.handled;
  }

  // ── Indietro ─────────────────────────────────────────────────────────

  Future<bool> _onBack() async {
    // Un dialogo o un menu aperto si chiude per primo (sta sul navigatore
    // principale, sopra le pagine della sezione).
    final root = Navigator.of(context, rootNavigator: true);
    Route<dynamic>? top;
    root.popUntil((r) {
      top = r;
      return true;
    });
    if (top is PopupRoute) {
      root.pop();
      return true;
    }
    final overlay = context.read<PlayerOverlayCubit>();
    if (overlay.state && overlay.collapseUpNextPanel()) return true;
    if (overlay.state) {
      overlay.hidePlayer();
      return true;
    }
    final page = _page;
    if (page != null) {
      final nav = _navKeys[page]!.currentState;
      if (nav != null && nav.canPop()) {
        nav.pop();
        return true;
      }
    } else {
      final router = GoRouter.of(context);
      if (router.canPop()) {
        router.pop();
        return true;
      }
    }
    if (!_menuFocused) {
      _focusMenu();
      return true;
    }
    if (_selected != 0) {
      _select(0);
      return true;
    }
    await SystemNavigator.pop();
    return true;
  }

  // ── UI ───────────────────────────────────────────────────────────────

  Widget _pageNavigator(_TvPage p) => Navigator(
        key: _navKeys[p],
        onGenerateRoute: (_) => MaterialPageRoute(
          builder: (_) => switch (p) {
            _TvPage.jellyfin => const TvJellyfinScreen(),
            _TvPage.youtube => const TvYouTubeScreen(),
            _TvPage.settings => const TvSettingsScreen(),
          },
        ),
      );

  @override
  Widget build(BuildContext context) {
    final playerVisible = context.watch<PlayerOverlayCubit>().state;
    final page = _page;
    final stackIndex = page == null ? 0 : _TvPage.values.indexOf(page) + 1;

    return TvScreenOffGuard(child: PlayerOverlayWrapper(
      child: BlocListener<PlayerOverlayCubit, bool>(
        listener: (_, visible) {
          if (visible) {
            Future.delayed(const Duration(milliseconds: 450), () {
              final n = tvPlayerAnchor.descendants
                  .where((d) => d.canRequestFocus)
                  .firstOrNull;
              n?.requestFocus();
            });
          }
          if (!visible) {
            Future.delayed(const Duration(milliseconds: 350), () {
              if (mounted) _focusContent();
            });
          }
        },
        child: BackButtonListener(
          onBackButtonPressed: _onBack,
          child: Scaffold(
            backgroundColor: TvColors.bg,
            body: ExcludeFocus(
              excluding: playerVisible,
              child: Stack(
                children: [
                  Positioned.fill(
                    left: 92,
                    child: Column(children: [
                      Expanded(
                        child: Focus(
                          canRequestFocus: false,
                          skipTraversal: true,
                          onKeyEvent: _onContentKey,
                          child: FocusScope(
                            node: _contentScope,
                            child: Column(
                              children: [
                                Expanded(
                                  child: IndexedStack(
                                    index: stackIndex,
                                    children: [
                                      ExcludeFocus(
                                          excluding: stackIndex != 0,
                                          child: widget.navigationShell),
                                      ExcludeFocus(
                                          excluding: stackIndex != 1,
                                          child: _LazyPage(
                                              active: stackIndex == 1,
                                              builder: () => _pageNavigator(
                                                  _TvPage.jellyfin))),
                                      ExcludeFocus(
                                          excluding: stackIndex != 2,
                                          child: _LazyPage(
                                              active: stackIndex == 2,
                                              builder: () => _pageNavigator(
                                                  _TvPage.youtube))),
                                      ExcludeFocus(
                                          excluding: stackIndex != 3,
                                          child: _LazyPage(
                                              active: stackIndex == 3,
                                              builder: () => _pageNavigator(
                                                  _TvPage.settings))),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      FocusScope(
                        node: _barScope,
                        onKeyEvent: _onBarKey,
                        child: const Padding(
                          padding: EdgeInsets.fromLTRB(32, 0, 32, 12),
                          child: MiniPlayerWidget(),
                        ),
                      ),
                    ]),
                  ),
                  // Il menu si allarga sopra il contenuto quando ha il focus.
                  Positioned(
                    left: 0,
                    top: 0,
                    bottom: 0,
                    child: FocusScope(
                      node: _menuScope,
                      onKeyEvent: _onMenuKey,
                      child: _SideMenu(
                        entries: _entries,
                        nodes: _itemNodes,
                        selected: _selected,
                        expanded: _menuFocused,
                        onSelect: _select,
                        onNowPlaying: () =>
                            context.read<PlayerOverlayCubit>().showPlayer(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ));
  }
}

/// Costruisce la pagina solo la prima volta che diventa attiva, poi la tiene.
class _LazyPage extends StatefulWidget {
  const _LazyPage({required this.active, required this.builder});
  final bool active;
  final Widget Function() builder;

  @override
  State<_LazyPage> createState() => _LazyPageState();
}

class _LazyPageState extends State<_LazyPage> {
  Widget? _child;

  @override
  Widget build(BuildContext context) {
    if (widget.active) _child ??= widget.builder();
    return _child ?? const SizedBox.shrink();
  }
}

class _SideMenu extends StatelessWidget {
  const _SideMenu({
    required this.entries,
    required this.nodes,
    required this.selected,
    required this.expanded,
    required this.onSelect,
    required this.onNowPlaying,
  });

  final List<_MenuEntry> entries;
  final List<FocusNode> nodes;
  final int selected;
  final bool expanded;
  final ValueChanged<int> onSelect;
  final VoidCallback onNowPlaying;

  @override
  Widget build(BuildContext context) {
    final showNowPlaying =
        context.select<MiniPlayerCubit, bool>((c) => c.state.isVisible);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
      width: expanded ? 270 : 92,
      decoration: BoxDecoration(
        color: expanded ? const Color(0xF2120D19) : const Color(0x99120D19),
        boxShadow: expanded
            ? const [BoxShadow(color: Colors.black54, blurRadius: 40)]
            : const [],
      ),
      child: ClipRect(
        child: OverflowBox(
          alignment: Alignment.centerLeft,
          minWidth: 270,
          maxWidth: 270,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 6, bottom: 14),
                  child: Row(children: [
                    Image.asset('assets/icons/BloomeeLogoFG.png',
                        width: 42, height: 42),
                    const SizedBox(width: 14),
                    AnimatedOpacity(
                      opacity: expanded ? 1 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: const Text('Bloomee TV', style: TvText.title),
                    ),
                  ]),
                ),
                for (var i = 0; i < entries.length; i++)
                  _MenuItem(
                    icon: entries[i].icon,
                    label: entries[i].label,
                    node: nodes[i],
                    selected: i == selected,
                    expanded: expanded,
                    onTap: () => onSelect(i),
                  ),
                const Spacer(),
                if (showNowPlaying)
                  _MenuItem(
                    icon: Icons.graphic_eq_rounded,
                    label: 'In riproduzione',
                    node: nodes[entries.length],
                    selected: false,
                    expanded: expanded,
                    onTap: onNowPlaying,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuItem extends StatefulWidget {
  const _MenuItem({
    required this.icon,
    required this.label,
    required this.node,
    required this.selected,
    required this.expanded,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final FocusNode node;
  final bool selected;
  final bool expanded;
  final VoidCallback onTap;

  @override
  State<_MenuItem> createState() => _MenuItemState();
}

class _MenuItemState extends State<_MenuItem> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final fg = _focused
        ? TvColors.bg
        : (widget.selected ? TvColors.accent : TvColors.textDim);
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Focus(
        focusNode: widget.node,
        onFocusChange: (f) => setState(() => _focused = f),
        onKeyEvent: (n, e) {
          if (e is KeyUpEvent && kTvSelectKeys.contains(e.logicalKey)) {
            widget.onTap();
            return KeyEventResult.handled;
          }
          if (kTvSelectKeys.contains(e.logicalKey))
            return KeyEventResult.handled;
          return KeyEventResult.ignored;
        },
        child: GestureDetector(
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            width: 238,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: _focused
                  ? TvColors.text
                  : (widget.selected ? TvColors.surfaceHi : Colors.transparent),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                Icon(widget.icon, color: fg, size: 28),
                const SizedBox(width: 18),
                Expanded(
                  child: AnimatedOpacity(
                    opacity: widget.expanded ? 1 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: Text(widget.label,
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                        style: TvText.card.copyWith(fontSize: 18, color: fg)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
