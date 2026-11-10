package ru.la2speak.mobile

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

// Пока пользователь в голосовом канале, служба держит процесс, микрофон и
// wakelock. Это то, что не даёт Android усыпить WebRTC при погашенном экране.
class VoiceService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var audioFocus: AudioFocusRequest? = null
    private var channelName = ""
    private var micOn = false
    private var muted = false
    private var broadcasting = false
    private var inForeground = false

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannels(this)
        acquireLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE_MIC -> {
                NativeEvents.emit("mic-toggle")
                return START_NOT_STICKY
            }
            ACTION_LEAVE -> {
                NativeEvents.emit("voice-leave")
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }

        channelName = intent?.getStringExtra(EXTRA_CHANNEL) ?: channelName
        micOn = intent?.getBooleanExtra(EXTRA_MIC, micOn) ?: micOn
        muted = intent?.getBooleanExtra(EXTRA_MUTED, muted) ?: muted
        broadcasting = intent?.getBooleanExtra(EXTRA_BROADCASTING, broadcasting) ?: broadcasting
        startForegroundCompat()
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        val notification = NotificationHelper.voiceNotification(
            this,
            channelName,
            micOn,
            muted,
            broadcasting,
        )
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startForeground(
                    NotificationHelper.VOICE_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } catch (_: Exception) {
                // Микрофон мог быть запрещён в настройках — звук канала всё
                // равно нужно удержать.
                startForeground(
                    NotificationHelper.VOICE_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            }
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NotificationHelper.VOICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(NotificationHelper.VOICE_NOTIFICATION_ID, notification)
        }
        inForeground = true
    }

    private fun acquireLocks() {
        val power = getSystemService(PowerManager::class.java)
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "la2speak:voice").apply {
            setReferenceCounted(false)
            acquire()
        }

        val wifi = applicationContext.getSystemService(WifiManager::class.java)
        @Suppress("DEPRECATION")
        val wifiMode = WifiManager.WIFI_MODE_FULL_HIGH_PERF
        wifiLock = wifi?.createWifiLock(wifiMode, "la2speak:voice")?.apply {
            setReferenceCounted(false)
            acquire()
        }

        val audio = getSystemService(AudioManager::class.java)
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { }
            .build()
        audioFocus = request
        audio.requestAudioFocus(request)
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
    }

    private fun releaseLocks() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        val audio = getSystemService(AudioManager::class.java)
        audioFocus?.let { audio.abandonAudioFocusRequest(it) }
        audioFocus = null
        audio.mode = AudioManager.MODE_NORMAL
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (inForeground) stopForeground(STOP_FOREGROUND_REMOVE)
        inForeground = false
        releaseLocks()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_UPDATE = "ru.la2speak.mobile.UPDATE"
        const val ACTION_TOGGLE_MIC = "ru.la2speak.mobile.TOGGLE_MIC"
        const val ACTION_LEAVE = "ru.la2speak.mobile.LEAVE"
        const val ACTION_STOP = "ru.la2speak.mobile.STOP"
        private const val EXTRA_CHANNEL = "channel"
        private const val EXTRA_MIC = "mic"
        private const val EXTRA_MUTED = "muted"
        private const val EXTRA_BROADCASTING = "broadcasting"

        fun start(context: Context, state: JSONObject) {
            val intent = Intent(context, VoiceService::class.java)
                .setAction(ACTION_UPDATE)
                .putExtra(EXTRA_CHANNEL, state.optString("channelName"))
                .putExtra(EXTRA_MIC, state.optBoolean("on"))
                .putExtra(EXTRA_MUTED, state.optBoolean("muted"))
                .putExtra(EXTRA_BROADCASTING, state.optBoolean("broadcasting"))
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, VoiceService::class.java))
        }
    }
}
