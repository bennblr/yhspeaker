package ru.la2speak.mobile

import android.webkit.WebView
import org.json.JSONObject
import java.lang.ref.WeakReference

// Службы (уведомление звонка, FCM) живут вне Activity, но события должен
// получать веб-клиент. Держим только слабую ссылку: после закрытия окна
// отправлять некому.
object NativeEvents {
    @Volatile
    private var reference: WeakReference<WebView>? = null

    fun attach(webView: WebView) {
        reference = WeakReference(webView)
    }

    fun detach(webView: WebView) {
        if (reference?.get() === webView) reference = null
    }

    fun isAttached(): Boolean = reference?.get() != null

    fun emit(type: String, payload: JSONObject = JSONObject()) {
        val webView = reference?.get() ?: return
        val event = JSONObject(payload.toString()).put("type", type)
        webView.post {
            webView.evaluateJavascript(
                "window.__la2speakNative && window.__la2speakNative($event);",
                null,
            )
        }
    }
}
