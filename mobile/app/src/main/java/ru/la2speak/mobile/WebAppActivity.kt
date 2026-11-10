package ru.la2speak.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class WebAppActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var serverUrl: String
    private var pageReady = false
    private var pendingDm: String? = null
    private var pendingAudioPermission: PermissionRequest? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val micPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingAudioPermission
            pendingAudioPermission = null
            if (request == null) return@registerForActivityResult
            if (granted) request.grant(request.resources) else request.deny()
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback
            fileChooserCallback = null
            callback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
            )
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NotificationHelper.ensureChannels(this)

        val resolved = intent.getStringExtra(EXTRA_SERVER) ?: AppPrefs.server(this)
        if (resolved == null) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }
        serverUrl = resolved
        AppPrefs.setServer(this, serverUrl)
        intent.getStringExtra(EXTRA_DM)?.let { AppPrefs.setPendingDm(this, it) }
        pendingDm = AppPrefs.takePendingDm(this)

        webView = WebView(this)
        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.bg))
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString LA2SpeakAndroid"
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.addJavascriptInterface(MobileBridge(this), "La2speakAndroid")
        webView.webViewClient = createWebViewClient()
        webView.webChromeClient = createChromeClient()
        webView.loadUrl(serverUrl)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else finish()
                }
            },
        )
    }

    override fun onResume() {
        super.onResume()
        if (!::webView.isInitialized) return
        NativeEvents.attach(webView)
        if (pageReady) NativeEvents.emit("resume")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(EXTRA_DM)?.let {
            pendingDm = it
            deliverPendingDm()
        }
        if (pageReady) NativeEvents.emit("resume")
    }

    override fun onDestroy() {
        pendingDm?.let { AppPrefs.setPendingDm(this, it) }
        if (::webView.isInitialized) {
            NativeEvents.detach(webView)
            // Без Activity нет и страницы с WebRTC: звонок продолжать некому.
            VoiceService.stop(this)
            webView.destroy()
        }
        super.onDestroy()
    }

    fun onBridgeMessage(json: String) {
        runOnUiThread { handleBridgeCommand(json) }
    }

    private fun handleBridgeCommand(json: String) {
        val command = try {
            JSONObject(json)
        } catch (_: Exception) {
            return
        }
        when (command.optString("type")) {
            "ready" -> {
                pageReady = true
                deliverPendingDm()
                sendPushToken()
            }
            "call-state" -> {
                val state = command.optJSONObject("state") ?: return
                if (state.optBoolean("inCall")) VoiceService.start(this, state)
                else VoiceService.stop(this)
            }
            "request-notifications" -> requestNotificationPermission()
            "request-battery-optimization" -> PowerHelper.requestIgnoreBatteryOptimizations(this)
            "request-push-token" -> requestPushToken()
            "open-url" -> openExternal(command.optString("url"))
        }
    }

    private fun sendPushToken() {
        val stored = AppPrefs.fcmToken(this)
        if (stored != null) {
            NativeEvents.emit("push-token", JSONObject().put("token", stored))
            return
        }
        requestPushToken()
    }

    private fun requestPushToken() {
        if (FirebaseApp.getApps(this).isEmpty()) return
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) return@addOnCompleteListener
            val token = task.result ?: return@addOnCompleteListener
            AppPrefs.setFcmToken(this, token)
            if (pageReady) NativeEvents.emit("push-token", JSONObject().put("token", token))
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun deliverPendingDm() {
        if (!pageReady) return
        val userId = pendingDm ?: return
        pendingDm = null
        NativeEvents.emit("open-dm", JSONObject().put("userId", userId))
    }

    private fun openExternal(value: String) {
        val uri = try {
            Uri.parse(value)
        } catch (_: Exception) {
            return
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https" && scheme != "mailto" && scheme != "tg") return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            /* подходящего приложения нет */
        }
    }

    private fun createWebViewClient() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme?.lowercase()
            if ((scheme == "http" || scheme == "https") &&
                ServerUrl.normalize(uri.toString()) == serverUrl
            ) {
                return false
            }
            openExternal(uri.toString())
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            pageReady = false
            view.evaluateJavascript(BOOTSTRAP_JS, null)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            view.evaluateJavascript(BOOTSTRAP_JS, null)
        }
    }

    private fun createChromeClient() = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                request.deny()
                return
            }
            if (ContextCompat.checkSelfPermission(
                    this@WebAppActivity,
                    Manifest.permission.RECORD_AUDIO,
                ) == PackageManager.PERMISSION_GRANTED
            ) {
                request.grant(request.resources)
                return
            }
            pendingAudioPermission = request
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = callback
            return try {
                fileChooserLauncher.launch(params.createIntent())
                true
            } catch (_: Exception) {
                fileChooserCallback = null
                false
            }
        }
    }

    private companion object {
        const val BOOTSTRAP_JS =
            "(function(){window.__la2speakNativeQueue=window.__la2speakNativeQueue||[];" +
                "window.__la2speakNative=window.__la2speakNative||" +
                "function(e){window.__la2speakNativeQueue.push(e);};" +
                "if(document.documentElement){" +
                "document.documentElement.classList.add('la2speak-mobile-app');}})();"
    }
}
