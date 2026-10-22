package ls.bloomee.musicplayer

import android.app.Activity
import android.graphics.Color
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import io.flutter.plugin.common.MethodChannel

/** Reversible black screen. Android doesn't expose TV panel-off to normal apps. */
class TvScreenBlank(private val activity: Activity, private val channel: MethodChannel) {
    private var curtain: View? = null
    private var brightness = -1f
    private var keptAwake = false
    private var wakeKey = -1
    fun setBlack(value: Boolean) {
        if (!value) { wake(false); return }
        if (curtain != null) return
        brightness = activity.window.attributes.screenBrightness
        keptAwake = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        activity.window.attributes = activity.window.attributes.apply { screenBrightness = 0f }
        curtain = View(activity).apply {
            setBackgroundColor(Color.BLACK)
            setOnTouchListener { _, _ -> wake(true); true }
        }
        activity.addContentView(curtain, android.view.ViewGroup.LayoutParams(-1, -1))
    }
    fun wake(notify: Boolean) {
        val view = curtain ?: return
        (view.parent as? android.view.ViewGroup)?.removeView(view)
        curtain = null
        activity.window.attributes = activity.window.attributes.apply { screenBrightness = brightness }
        if (!keptAwake) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (notify) channel.invokeMethod("wake", null)
    }
    fun key(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_UP && event.keyCode == wakeKey) {
            wakeKey = -1
            return true
        }
        if (curtain == null) {
            if (event.action == KeyEvent.ACTION_DOWN) channel.invokeMethod("activity", null)
            return false
        }
        if (event.keyCode in listOf(KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_VOLUME_MUTE, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_PREVIOUS)) return false
        if (event.action == KeyEvent.ACTION_DOWN) { wakeKey = event.keyCode; wake(true) }
        return true
    }
}
