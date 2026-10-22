import 'dart:async';
import 'dart:io';
import 'package:Bloomee/blocs/media_player/bloomee_player_cubit.dart';
import 'package:Bloomee/tv/services/tv_screen_idle.dart';
import 'package:Bloomee/tv/tv_config.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

/// Android's public APIs cannot power off a TV panel while keeping its activity
/// alive. Use an opaque black native view and minimum window brightness instead.
/// No device-admin permission, hidden API, standby command or audio interruption.
class TvScreenOffGuard extends StatefulWidget {
  const TvScreenOffGuard({super.key, required this.child});
  final Widget child;
  @override
  State<TvScreenOffGuard> createState() => _TvScreenOffGuardState();
}

class _TvScreenOffGuardState extends State<TvScreenOffGuard>
    with WidgetsBindingObserver {
  static const _channel = MethodChannel('bloomee_tv/screen');
  late final TvScreenIdle _idle;
  StreamSubscription<bool>? _playing;
  bool _blank = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _idle = TvScreenIdle(
      hide: () async {
        if (Platform.isAndroid)
          await _channel.invokeMethod<void>('black', true);
        if (mounted) setState(() => _blank = true);
      },
      show: () async {
        if (mounted) setState(() => _blank = false);
        if (Platform.isAndroid)
          await _channel.invokeMethod<void>('black', false);
      },
    );
    _idle.configure(TvConfig.screenOffSeconds);
    TvConfig.changes.addListener(_settingsChanged);
    _playing = context
        .read<BloomeePlayerCubit>()
        .bloomeePlayer
        .engine
        .playingStream
        .listen(_idle.playing);
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'wake') {
        if (mounted) setState(() => _blank = false);
        _idle.nativeWake();
      } else if (call.method == 'activity') {
        _idle.activity();
      }
    });
    HardwareKeyboard.instance.addHandler(_key);
  }

  void _settingsChanged() => _idle.configure(TvConfig.screenOffSeconds);
  bool _key(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return false;
    if (_blank) {
      _idle.wake();
      return true;
    }
    _idle.activity();
    return false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      _idle.active(state == AppLifecycleState.resumed);
  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_key);
    WidgetsBinding.instance.removeObserver(this);
    TvConfig.changes.removeListener(_settingsChanged);
    _playing?.cancel();
    _channel.setMethodCallHandler(null);
    _idle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Listener(
    onPointerDown: (_) {
      if (_blank)
        _idle.wake();
      else
        _idle.activity();
    },
    onPointerSignal: (_) => _idle.activity(),
    child: Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (_blank)
          const Positioned.fill(child: ColoredBox(color: Colors.black)),
      ],
    ),
  );
}
