package ls.bloomee.musicplayer

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Activity principale di Bloomee TV: ricerca vocale dentro l'app con
 * SpeechRecognizer (l'ascolto vocale di Google TV non restituisce il testo
 * alle altre app). Le parole parziali vengono mandate a Flutter mentre parli.
 */
class TvActivity : AudioServiceActivity() {
    private var channel: MethodChannel? = null
    private var pending: MethodChannel.Result? = null
    private var recognizer: SpeechRecognizer? = null
    private var lang = "it-IT"
    private var screenBlank: TvScreenBlank? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val screenChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bloomee_tv/screen")
        screenBlank = TvScreenBlank(this, screenChannel)
        screenChannel.setMethodCallHandler { call, result ->
            if (call.method == "black") {
                screenBlank?.setBlack(call.arguments == true)
                result.success(null)
            } else result.notImplemented()
        }
        TvCastBridge.attach(MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bloomee_tv/cast"))
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bloomee_tv/storage").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "freeBytes" -> result.success(android.os.StatFs(call.argument<String>("path") ?: filesDir.path).availableBytes)
                    else -> result.notImplemented()
                }
            } catch (_: Exception) { result.error("storage", "Spazio non leggibile", null) }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bloomee_tv/device").setMethodCallHandler { call, result ->
            if (call.method == "baseBuild") {
                @Suppress("DEPRECATION")
                val info = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
                result.success(info.metaData.getInt("bloomee_tv.BASE_VERSION_CODE").toString())
            } else result.notImplemented()
        }
        val vault = TvSecureStore(this)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bloomee_tv/secure").setMethodCallHandler { call, result ->
            try {
                val profile = call.argument<String>("profile") ?: "default"
                when (call.method) {
                    "read" -> result.success(vault.read(profile))
                    "write" -> { vault.write(profile, call.argument<String>("value") ?: "{}"); result.success(null) }
                    else -> result.notImplemented()
                }
            } catch (_: Exception) { result.error("secure_storage", "Archivio credenziali non disponibile", null) }
        }
        val ch = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bloomee_tv/voice")
        channel = ch
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "listen" -> {
                    finish(null)
                    pending = result
                    lang = call.argument<String>("lang") ?: "it-IT"
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        startListening()
                    } else {
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MIC_REQUEST)
                    }
                }
                "ytLogin" -> {
                    ytPending?.success(null)
                    ytPending = result
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent(this, YtLoginActivity::class.java), YT_LOGIN)
                }
                "openWeb" -> {
                    startActivity(Intent(this, WebActivity::class.java).putExtra("url", call.argument<String>("url")))
                    result.success(null)
                }
                "ytLogout" -> {
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent(this, YtLoginActivity::class.java).putExtra("logout", true), YT_LOGOUT)
                    result.success(null)
                }
                "stop" -> {
                    recognizer?.stopListening()
                    result.success(null)
                }
                "cancel" -> {
                    finish(null)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private var ytPending: MethodChannel.Result? = null

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == YT_LOGIN) {
            val r = ytPending
            ytPending = null
            if (resultCode == RESULT_OK && data?.getStringExtra("cookie") != null) {
                r?.success(mapOf(
                    "cookie" to data.getStringExtra("cookie"),
                    "visitorData" to data.getStringExtra("visitorData"),
                    "dataSyncId" to data.getStringExtra("dataSyncId"),
                ))
            } else {
                r?.success(null)
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != MIC_REQUEST) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startListening()
        } else {
            pending?.error("permission", "Permesso microfono negato", null)
            pending = null
        }
    }

    private fun finish(text: String?) {
        screenBlank?.wake(false)
        recognizer?.destroy()
        recognizer = null
        pending?.success(text)
        pending = null
    }

    private fun startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            pending?.error("unavailable", "Riconoscimento vocale non disponibile", null)
            pending = null
            return
        }
        screenBlank?.wake(false)
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { channel?.invokeMethod("state", "ready") }
            override fun onBeginningOfSpeech() { channel?.invokeMethod("state", "speech") }
            override fun onRmsChanged(rmsdB: Float) { channel?.invokeMethod("level", rmsdB.toDouble()) }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { channel?.invokeMethod("state", "processing") }
            override fun onError(error: Int) {
                val msg = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> null
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permesso microfono negato"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Errore di rete"
                    else -> "Errore riconoscimento ($error)"
                }
                if (msg == null) finish(null) else {
                    screenBlank?.wake(false)
        recognizer?.destroy(); recognizer = null
                    pending?.error("error", msg, null); pending = null
                }
            }
            override fun onResults(results: Bundle?) {
                finish(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull())
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!t.isNullOrBlank()) channel?.invokeMethod("partial", t)
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        r.startListening(intent)
    }

    override fun onStart() { super.onStart(); TvCastBridge.start(intent) }
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (screenBlank?.key(event) == true) return true
        return super.dispatchKeyEvent(event)
    }
    override fun onPause() { screenBlank?.wake(true); super.onPause() }

    override fun onStop() { TvCastBridge.background(); super.onStop() }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); TvCastBridge.handleIntent(intent) }

    override fun onDestroy() {
        screenBlank?.wake(false)
        recognizer?.destroy()
        super.onDestroy()
    }

    companion object {
        private const val MIC_REQUEST = 4712
        private const val YT_LOGIN = 4713
        private const val YT_LOGOUT = 4714
    }
}
