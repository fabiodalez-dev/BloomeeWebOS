import 'dart:async';

/// One idle timer shared by the UI guard. Never stops playback or enters standby.
class TvScreenIdle {
  TvScreenIdle({required this.hide, required this.show});
  final Future<void> Function() hide;
  final Future<void> Function() show;
  Timer? _timer;
  int seconds = 0;
  bool _playing = false, _active = true, _blank = false;
  bool get blank => _blank;
  void configure(int value) {
    seconds = value.clamp(0, 3600);
    activity();
  }

  void playing(bool value) {
    if (_playing == value) return;
    _playing = value;
    if (!value)
      wake();
    else
      activity();
  }

  void active(bool value) {
    _active = value;
    if (!value)
      wake();
    else
      activity();
  }

  void activity() {
    _timer?.cancel();
    if (!_active || !_playing || seconds == 0 || _blank) return;
    _timer = Timer(Duration(seconds: seconds), () async {
      if (!_active || !_playing) return;
      _blank = true;
      try {
        await hide();
      } catch (_) {
        _blank = false;
      }
    });
  }

  void nativeWake() {
    _blank = false;
    activity();
  }

  Future<void> wake() async {
    _timer?.cancel();
    if (_blank) {
      _blank = false;
      try {
        await show();
      } catch (_) {
        /* Unsupported desktop platform. */
      }
    }
    activity();
  }

  Future<void> dispose() async {
    _active = false;
    await wake();
  }
}
