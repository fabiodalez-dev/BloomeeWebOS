import 'package:Bloomee/tv/services/tv_screen_idle.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
void main() {
  test('only blanks during playback, after the full idle interval', () {
    fakeAsync((clock) {
      var hidden = 0;
      final timer = TvScreenIdle(hide: () async { hidden++; }, show: () async {});
      timer.configure(15);
      clock.elapse(const Duration(seconds: 20));
      expect(hidden, 0);
      timer.playing(true);
      clock.elapse(const Duration(seconds: 14));
      expect(hidden, 0);
      clock.elapse(const Duration(seconds: 1));
      expect(hidden, 1);
      expect(timer.blank, true);
    });
  });
  test('activity resets the deadline and pause cancels it', () {
    fakeAsync((clock) {
      var hidden = 0;
      final timer = TvScreenIdle(hide: () async { hidden++; }, show: () async {});
      timer.configure(15); timer.playing(true);
      clock.elapse(const Duration(seconds: 10)); timer.activity();
      clock.elapse(const Duration(seconds: 10)); expect(hidden, 0);
      timer.playing(false); clock.elapse(const Duration(seconds: 30));
      expect(hidden, 0);
    });
  });
  test('wakes on pause and never blanks in the background or with Mai', () {
    fakeAsync((clock) {
      var shown = 0, hidden = 0;
      final timer = TvScreenIdle(hide: () async { hidden++; }, show: () async { shown++; });
      timer.configure(15); timer.playing(true);
      clock.elapse(const Duration(seconds: 15));clock.flushMicrotasks();
      timer.playing(false);clock.flushMicrotasks();expect(shown, 1);
      timer.playing(true);timer.active(false);clock.elapse(const Duration(minutes: 1));expect(hidden, 1);
      timer.active(true);timer.configure(0);clock.elapse(const Duration(hours: 1));expect(hidden, 1);
    });
  });
  test('dispose clears the timer and restores an obscured screen', () {
    fakeAsync((clock) {
      var shown = 0;
      final timer = TvScreenIdle(hide: () async {}, show: () async { shown++; });
      timer.configure(15); timer.playing(true);
      clock.elapse(const Duration(seconds: 15));clock.flushMicrotasks();
      timer.dispose();clock.flushMicrotasks();expect(shown, 1);
      clock.elapse(const Duration(hours: 1));expect(timer.blank, false);
    });
  });
}
