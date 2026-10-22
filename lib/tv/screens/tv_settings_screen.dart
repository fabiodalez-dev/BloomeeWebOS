import 'package:Bloomee/screens/screen/home_views/setting_view.dart';
import 'package:Bloomee/screens/screen/plugin_manager_screen.dart';
import 'package:Bloomee/tv/connectors/jellyfin_client.dart';
import 'package:Bloomee/tv/connectors/lidarr_client.dart';
import 'package:Bloomee/tv/tv_config.dart';
import 'package:Bloomee/tv/screens/tv_youtube_screen.dart';
import 'package:Bloomee/screens/widgets/snackbar.dart';
import 'package:Bloomee/tv/ui/tv_widgets.dart';
import 'package:flutter/material.dart';
import 'package:Bloomee/tv/screens/tv_control_center.dart';
import 'package:Bloomee/tv/services/tv_diagnostics.dart';

/// Stato di un collegamento, mostrato come etichetta colorata.
enum _Link { off, checking, ok, error }

/// Impostazioni TV: collegamento a Jellyfin, Lidarr e YouTube Music, più
/// accesso alle impostazioni complete dell'app.
///
/// Ogni servizio collegato mostra un riepilogo (indirizzo, utente, chiave
/// mascherata) e viene verificato dal vivo all'apertura; "Modifica" apre i
/// campi, dove i segreti già salvati restano tali se il campo è lasciato vuoto.
class TvSettingsScreen extends StatefulWidget {
  const TvSettingsScreen({super.key});

  @override
  State<TvSettingsScreen> createState() => _TvSettingsScreenState();
}

class _TvSettingsScreenState extends State<TvSettingsScreen> {
  late final _jfUrl = TextEditingController(text: TvConfig.jellyfinUrl);
  late final _jfUser = TextEditingController(text: TvConfig.jellyfinUser);
  final _jfPass = TextEditingController();
  final _jfKey = TextEditingController();
  late final _ldUrl = TextEditingController(text: TvConfig.lidarrUrl);
  final _ldKey = TextEditingController();

  final _jfFirst = FocusNode(debugLabel: 'jf-first');
  final _jfMain = FocusNode(debugLabel: 'jf-main');
  final _ldFirst = FocusNode(debugLabel: 'ld-first');
  final _ldMain = FocusNode(debugLabel: 'ld-main');
  final _ytMain = FocusNode(debugLabel: 'yt-main');

  late bool _jfEditing = !TvConfig.hasJellyfin;
  late bool _ldEditing = !TvConfig.hasLidarr;

  _Link _jfLink = _Link.off;
  _Link _ldLink = _Link.off;
  _Link _ytLink = _Link.off;
  String? _jfMsg;
  String? _ldMsg;
  String? _ytMsg;

  @override
  void initState() {
    super.initState();
    if (TvConfig.hasJellyfin) _checkJellyfin();
    if (TvConfig.hasLidarr) _checkLidarr();
    if (TvConfig.hasYouTube) _checkYouTube();
  }

  @override
  void dispose() {
    for (final c in [_jfUrl, _jfUser, _jfPass, _jfKey, _ldUrl, _ldKey]) {
      c.dispose();
    }
    for (final f in [_jfFirst, _jfMain, _ldFirst, _ldMain, _ytMain]) {
      f.dispose();
    }
    super.dispose();
  }

  /// Indirizzo senza schema, così entra nella riga di riepilogo.
  static String _host(String url) =>
      url.replaceFirst(RegExp(r'^https?://'), '');

  void _focusLater(FocusNode n) =>
      WidgetsBinding.instance.addPostFrameCallback((_) => n.requestFocus());

  // ---------- Jellyfin ----------

  Future<void> _checkJellyfin() async {
    final c = TvConfig.jellyfin;
    if (c == null) return;
    setState(() {
      _jfLink = _Link.checking;
      _jfMsg = 'Verifico il collegamento…';
    });
    try {
      final name = await c.serverName();
      await c.recentAlbums(limit: 1);
      if (!mounted) return;
      setState(() {
        _jfLink = _Link.ok;
        _jfMsg = 'Server "$name" raggiungibile';
      });
    } on JellyfinAuthException {
      if (!mounted) return;
      setState(() {
        _jfLink = _Link.error;
        _jfMsg = 'Credenziali non più valide: premi Modifica e ricollegati';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _jfLink = _Link.error;
        _jfMsg = 'Server non raggiungibile: $e';
      });
    }
  }

  Future<void> _connectJellyfin() async {
    final url = _jfUrl.text.trim();
    final user = _jfUser.text.trim();
    final pass = _jfPass.text;
    final key = _jfKey.text.trim();
    final sameServer =
        url.replaceAll(RegExp(r'/+$'), '') == TvConfig.jellyfinUrl &&
            user == TvConfig.jellyfinUser;
    final keepToken = sameServer &&
        pass.isEmpty &&
        key.isEmpty &&
        TvConfig.jellyfinToken.isNotEmpty;
    if (url.isEmpty ||
        user.isEmpty ||
        (pass.isEmpty && key.isEmpty && !keepToken)) {
      setState(() {
        _jfLink = _Link.error;
        _jfMsg = 'Servono indirizzo, utente e password (oppure la chiave API)';
      });
      return;
    }
    setState(() {
      _jfLink = _Link.checking;
      _jfMsg = 'Collegamento…';
    });
    try {
      TvConfig.validateUrl(url);
      final c = JellyfinClient(baseUrl: url);
      String userId;
      if (pass.isNotEmpty) {
        await c.login(user, pass);
        userId = c.userId!;
      } else {
        c.token = key.isNotEmpty ? key : TvConfig.jellyfinToken;
        final id = await c.userIdByName(user);
        if (id == null) throw Exception('utente "$user" non trovato');
        userId = id;
      }
      c.userId = userId;
      final name = await c.serverName();
      if (!mounted) return;
      await TvConfig.saveJellyfin(
          url: url, user: user, token: c.token!, userId: userId);
      if (!mounted) return;
      _jfPass.clear();
      _jfKey.clear();
      setState(() {
        _jfEditing = false;
        _jfLink = _Link.ok;
        _jfMsg = 'Server "$name" raggiungibile';
      });
      _focusLater(_jfMain);
    } on JellyfinAuthException {
      if (!mounted) return;
      setState(() {
        _jfLink = _Link.error;
        _jfMsg = 'Utente o password non validi';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _jfLink = _Link.error;
        _jfMsg = TvDiagnostics.redact('Errore: $e');
      });
    }
  }

  // ---------- Lidarr ----------

  Future<void> _checkLidarr() async {
    final c = TvConfig.lidarr;
    if (c == null) return;
    setState(() {
      _ldLink = _Link.checking;
      _ldMsg = 'Verifico il collegamento…';
    });
    try {
      final v = await c.ping();
      if (!mounted) return;
      setState(() {
        _ldLink = _Link.ok;
        _ldMsg = '$v raggiungibile';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _ldLink = _Link.error;
        _ldMsg = 'Lidarr non risponde: $e';
      });
    }
  }

  Future<void> _connectLidarr() async {
    final url = _ldUrl.text.trim();
    final key = _ldKey.text.trim().isNotEmpty
        ? _ldKey.text.trim()
        : (url.replaceAll(RegExp(r'/+$'), '') == TvConfig.lidarrUrl
            ? TvConfig.lidarrKey
            : '');
    if (url.isEmpty || key.isEmpty) {
      setState(() {
        _ldLink = _Link.error;
        _ldMsg = 'Servono indirizzo e chiave API';
      });
      return;
    }
    setState(() {
      _ldLink = _Link.checking;
      _ldMsg = 'Verifica…';
    });
    try {
      TvConfig.validateUrl(url);
      final v = await LidarrClient(baseUrl: url, apiKey: key).ping();
      if (!mounted) return;
      await TvConfig.saveLidarr(url: url, key: key);
      if (!mounted) return;
      _ldKey.clear();
      setState(() {
        _ldEditing = false;
        _ldLink = _Link.ok;
        _ldMsg = '$v raggiungibile';
      });
      _focusLater(_ldMain);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _ldLink = _Link.error;
        _ldMsg = TvDiagnostics.redact('Errore: $e');
      });
    }
  }

  // ---------- YouTube ----------

  Future<void> _checkYouTube() async {
    if (!TvConfig.hasYouTube) return;
    final c = TvConfig.youtube;
    setState(() {
      _ytLink = _Link.checking;
      _ytMsg = 'Verifico l\'accesso…';
    });
    try {
      final name = await c.accountName();
      if (!mounted) return;
      setState(() {
        _ytLink = name == null ? _Link.error : _Link.ok;
        _ytMsg = name == null
            ? 'Sessione scaduta: accedi di nuovo'
            : 'Cronologia, Mi piace, playlist, album e artisti seguiti sincronizzati';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _ytLink = _Link.error;
        _ytMsg = 'YouTube non risponde: $e';
      });
    }
  }

  Future<void> _loginYouTube() async {
    final ok = await loginYouTube();
    if (!mounted) return;
    setState(() {});
    if (ok) {
      SnackbarService.showMessage(
          'YouTube Music collegato: ${TvConfig.ytName}');
      _checkYouTube();
    }
    _focusLater(_ytMain);
  }

  // ---------- comuni ----------

  Future<bool> _confirm(String title, String text) async {
    final r = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: TvColors.surface,
        title: Text(title, style: TvText.title),
        content: SizedBox(
            width: 480,
            child: Text(text, style: TvText.body.copyWith(fontSize: 18))),
        actions: [
          TextButton(
              autofocus: true,
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Annulla')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Scollega')),
        ],
      ),
    );
    return r == true;
  }

  Widget _field(String label, TextEditingController c,
      {String? placeholder,
      bool secret = false,
      bool tail = false,
      FocusNode? focusNode}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TvTextField(
        controller: c,
        label: label,
        placeholder: placeholder,
        obscure: secret,
        revealTail: tail,
        showFilled: true,
        focusNode: focusNode,
      ),
    );
  }

  Widget _buttons(List<Widget> b) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(spacing: 14, runSpacing: 14, children: b),
      );

  Widget _jellyfinCard() {
    final has = TvConfig.hasJellyfin;
    final link = has || _jfEditing ? _jfLink : _Link.off;
    return _ServiceCard(
      icon: Icons.dns_rounded,
      title: 'Jellyfin',
      link: link,
      message: _jfMsg,
      hint: 'La tua musica dal server di casa.',
      children: _jfEditing
          ? [
              _field('Indirizzo server', _jfUrl,
                  placeholder: 'es. https://casa.example/jellyfin',
                  focusNode: _jfFirst),
              _field('Utente', _jfUser, placeholder: 'Nome utente Jellyfin'),
              _field('Password', _jfPass,
                  secret: true,
                  placeholder:
                      has ? 'Accesso già salvato: non serve' : 'Non inserita'),
              _field('Oppure chiave API', _jfKey,
                  secret: true,
                  tail: true,
                  placeholder: 'Non inserita (facoltativa)'),
              Text('Basta la password oppure la chiave API.',
                  style: TvText.body.copyWith(fontSize: 14)),
              _buttons([
                TvPillButton(
                    focusNode: _jfMain,
                    icon: Icons.link_rounded,
                    label: 'Collega',
                    primary: true,
                    onTap: _jfLink == _Link.checking ? null : _connectJellyfin),
                if (has)
                  TvPillButton(
                      icon: Icons.close_rounded,
                      label: 'Annulla',
                      onTap: () {
                        _jfUrl.text = TvConfig.jellyfinUrl;
                        _jfUser.text = TvConfig.jellyfinUser;
                        _jfPass.clear();
                        _jfKey.clear();
                        setState(() => _jfEditing = false);
                        _checkJellyfin();
                        _focusLater(_jfMain);
                      }),
              ]),
            ]
          : [
              _InfoRow(
                  icon: Icons.public_rounded,
                  label: 'Server',
                  value: _host(TvConfig.jellyfinUrl)),
              _InfoRow(
                  icon: Icons.person_rounded,
                  label: 'Utente',
                  value: TvConfig.jellyfinUser),
              _InfoRow(
                  icon: Icons.key_rounded,
                  label: 'Token',
                  value: maskSecret(TvConfig.jellyfinToken),
                  mono: true),
              _buttons([
                TvPillButton(
                    focusNode: _jfMain,
                    icon: Icons.refresh_rounded,
                    label: 'Verifica',
                    primary: true,
                    onTap: _jfLink == _Link.checking ? null : _checkJellyfin),
                TvPillButton(
                    icon: Icons.edit_rounded,
                    label: 'Modifica',
                    onTap: () {
                      setState(() => _jfEditing = true);
                      _focusLater(_jfFirst);
                    }),
                TvPillButton(
                    icon: Icons.link_off_rounded,
                    label: 'Scollega',
                    onTap: () async {
                      if (!await _confirm('Scollegare Jellyfin?',
                          'La tua musica sparirà dalla Home finché non ti ricolleghi con utente e password.')) {
                        return;
                      }
                      await TvConfig.clearJellyfin();
                      if (!mounted) return;
                      setState(() {
                        _jfEditing = true;
                        _jfLink = _Link.off;
                        _jfMsg = null;
                      });
                      _focusLater(_jfFirst);
                    }),
              ]),
            ],
    );
  }

  Widget _lidarrCard() {
    final has = TvConfig.hasLidarr;
    return _ServiceCard(
      icon: Icons.cloud_download_rounded,
      title: 'Lidarr',
      link: has || _ldEditing ? _ldLink : _Link.off,
      message: _ldMsg,
      hint: 'Per "Scarica questo album".',
      children: _ldEditing
          ? [
              _field('Indirizzo Lidarr', _ldUrl,
                  placeholder: 'es. http://192.168.1.10:8686',
                  focusNode: _ldFirst),
              _field('Chiave API', _ldKey,
                  secret: true,
                  tail: true,
                  placeholder: has
                      ? 'Salvata ${maskSecret(TvConfig.lidarrKey)}: lascia vuoto per tenerla'
                      : 'Non inserita'),
              Text('La chiave è in Lidarr → Settings → General → API Key.',
                  style: TvText.body.copyWith(fontSize: 14)),
              _buttons([
                TvPillButton(
                    focusNode: _ldMain,
                    icon: Icons.check_rounded,
                    label: 'Verifica e salva',
                    primary: true,
                    onTap: _ldLink == _Link.checking ? null : _connectLidarr),
                if (has)
                  TvPillButton(
                      icon: Icons.close_rounded,
                      label: 'Annulla',
                      onTap: () {
                        _ldUrl.text = TvConfig.lidarrUrl;
                        _ldKey.clear();
                        setState(() => _ldEditing = false);
                        _checkLidarr();
                        _focusLater(_ldMain);
                      }),
              ]),
            ]
          : [
              _InfoRow(
                  icon: Icons.public_rounded,
                  label: 'Server',
                  value: _host(TvConfig.lidarrUrl)),
              _InfoRow(
                  icon: Icons.key_rounded,
                  label: 'Chiave API',
                  value: maskSecret(TvConfig.lidarrKey),
                  mono: true),
              _buttons([
                TvPillButton(
                    focusNode: _ldMain,
                    icon: Icons.refresh_rounded,
                    label: 'Verifica',
                    primary: true,
                    onTap: _ldLink == _Link.checking ? null : _checkLidarr),
                TvPillButton(
                    icon: Icons.edit_rounded,
                    label: 'Modifica',
                    onTap: () {
                      setState(() => _ldEditing = true);
                      _focusLater(_ldFirst);
                    }),
                TvPillButton(
                    icon: Icons.link_off_rounded,
                    label: 'Scollega',
                    onTap: () async {
                      if (!await _confirm('Scollegare Lidarr?',
                          '"Scarica questo album" non funzionerà finché non inserisci di nuovo la chiave.')) {
                        return;
                      }
                      await TvConfig.clearLidarr();
                      if (!mounted) return;
                      setState(() {
                        _ldEditing = true;
                        _ldLink = _Link.off;
                        _ldMsg = null;
                      });
                      _focusLater(_ldFirst);
                    }),
              ]),
            ],
    );
  }

  Widget _youtubeCard() {
    final has = TvConfig.hasYouTube;
    final name = TvConfig.ytName;
    return _ServiceCard(
      icon: Icons.smart_display_rounded,
      title: 'Account YouTube Music',
      link: has ? _ytLink : _Link.off,
      message: has ? _ytMsg : null,
      hint: has
          ? null
          : 'Accedi con Google per avere cronologia, Mi piace, playlist e artisti seguiti nel menu "Il mio YouTube" e nella Home.',
      children: [
        if (has)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: TvColors.accent,
                child: Text(
                    name.isEmpty ? '?' : name.characters.first.toUpperCase(),
                    style: TvText.title.copyWith(color: Colors.white)),
              ),
              const SizedBox(width: 16),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name.isEmpty ? 'Account Google' : name,
                    style: TvText.title),
                Text('Accesso salvato su questo dispositivo',
                    style: TvText.body.copyWith(fontSize: 14)),
              ]),
            ]),
          ),
        _buttons([
          TvPillButton(
            focusNode: _ytMain,
            icon: Icons.login_rounded,
            label: has ? 'Cambia account' : 'Accedi con Google',
            primary: true,
            onTap: _loginYouTube,
          ),
          if (has) ...[
            TvPillButton(
                icon: Icons.refresh_rounded,
                label: 'Verifica',
                onTap: _ytLink == _Link.checking ? null : _checkYouTube),
            TvPillButton(
              icon: Icons.logout_rounded,
              label: 'Esci',
              onTap: () async {
                if (!await _confirm('Uscire da YouTube Music?',
                    'Cronologia e playlist del tuo account non saranno più visibili finché non accedi di nuovo.')) {
                  return;
                }
                await logoutYouTube();
                if (!mounted) return;
                setState(() {
                  _ytLink = _Link.off;
                  _ytMsg = null;
                });
                _focusLater(_ytMain);
              },
            ),
          ],
        ]),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: TvColors.bg,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(48, 40, 48, 180),
        children: [
          const Text('Impostazioni', style: TvText.hero),
          const SizedBox(height: 24),
          const Text('Schermo durante l’ascolto', style: TvText.card),
          const SizedBox(height: 12),
          const Text(
            'Oscura dopo un periodo senza interazioni, solo mentre ascolti musica. '
            'La scelta viene salvata. Su Android mostra nero e riduce la luminosità: '
            'lo spegnimento fisico del pannello dipende dal televisore. '
            'Premi OK o una freccia per tornare all’app.',
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<int>(
            value: TvConfig.screenOffSeconds,
            decoration: const InputDecoration(
              labelText: 'Spegni / oscura schermo dopo',
            ),
            items: const [
              DropdownMenuItem(value: 0, child: Text('Mai')),
              DropdownMenuItem(value: 15, child: Text('15 secondi')),
              DropdownMenuItem(value: 30, child: Text('30 secondi')),
              DropdownMenuItem(value: 60, child: Text('1 minuto')),
              DropdownMenuItem(value: 120, child: Text('2 minuti')),
              DropdownMenuItem(value: 300, child: Text('5 minuti')),
            ],
            onChanged: (value) async {
              if (value == null) return;
              try {
                await TvConfig.saveScreenOffSeconds(value);
                if (mounted) setState(() {});
              } catch (_) {
                if (mounted)
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Impossibile salvare la preferenza'),
                    ),
                  );
              }
            },
          ),
          const SizedBox(height: 32),
          TvPillButton(
              icon: Icons.dashboard_customize,
              label: 'Centro TV: profili, Home, download e accessibilità',
              onTap: () => openTvControlCenter(context)),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _jellyfinCard()),
              const SizedBox(width: 24),
              Expanded(child: _lidarrCard()),
            ],
          ),
          _youtubeCard(),
          Wrap(spacing: 16, runSpacing: 16, children: [
            TvPillButton(
              icon: Icons.tune_rounded,
              label: 'Impostazioni avanzate dell\'app',
              onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SettingsView())),
            ),
            TvPillButton(
              icon: Icons.extension_rounded,
              label: 'Sorgenti (plugin)',
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const PluginManagerScreen())),
            ),
          ]),
        ],
      ),
    );
  }
}

/// Riquadro di un servizio: icona, titolo, etichetta di stato, descrizione,
/// contenuto e messaggio dell'ultima verifica.
class _ServiceCard extends StatelessWidget {
  const _ServiceCard({
    required this.icon,
    required this.title,
    required this.link,
    required this.children,
    this.hint,
    this.message,
  });

  final IconData icon;
  final String title;
  final _Link link;
  final String? hint;
  final String? message;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final color = _StatusChip.colorOf(link);
    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: TvColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, color: TvColors.accent, size: 28),
            const SizedBox(width: 12),
            Flexible(
                child: Text(title,
                    style: TvText.title, overflow: TextOverflow.ellipsis)),
            const SizedBox(width: 14),
            _StatusChip(link),
          ]),
          if (hint != null) ...[
            const SizedBox(height: 8),
            Text(hint!, style: TvText.body),
          ],
          const SizedBox(height: 16),
          ...children,
          if (message != null && link != _Link.off) ...[
            const SizedBox(height: 12),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(
                  link == _Link.ok
                      ? Icons.check_circle_rounded
                      : link == _Link.error
                          ? Icons.error_rounded
                          : Icons.hourglass_top_rounded,
                  color: color,
                  size: 20),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(message!,
                      style: TvText.body.copyWith(color: color, fontSize: 15))),
            ]),
          ],
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.link);
  final _Link link;

  static Color colorOf(_Link l) => switch (l) {
        _Link.ok => TvColors.ok,
        _Link.error => TvColors.error,
        _Link.checking => TvColors.warn,
        _Link.off => TvColors.textDim,
      };

  @override
  Widget build(BuildContext context) {
    final color = colorOf(link);
    final label = switch (link) {
      _Link.ok => 'Collegato',
      _Link.error => 'Problema',
      _Link.checking => 'Verifica…',
      _Link.off => 'Non collegato',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 7),
        Text(label,
            style: TvText.body.copyWith(
                color: color, fontSize: 14, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

/// Riga di riepilogo non modificabile: icona, etichetta, valore.
class _InfoRow extends StatelessWidget {
  const _InfoRow(
      {required this.icon,
      required this.label,
      required this.value,
      this.mono = false});
  final IconData icon;
  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
          color: TvColors.surfaceHi, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        Icon(icon, color: TvColors.textDim, size: 22),
        const SizedBox(width: 14),
        SizedBox(
            width: 84,
            child: Text(label, style: TvText.body.copyWith(fontSize: 15))),
        Expanded(
          child: Text(
            value.isEmpty ? '—' : value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TvText.card
                .copyWith(fontSize: 17, letterSpacing: mono ? 1.2 : null),
          ),
        ),
      ]),
    );
  }
}
