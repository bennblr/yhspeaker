package ru.la2speak.mobile

import android.webkit.JavascriptInterface

// Единственный канал «веб → нативное приложение». Интерфейс доступен только
// странице сервера: WebAppActivity не выпускает WebView за пределы origin.
class MobileBridge(private val activity: WebAppActivity) {
    @JavascriptInterface
    fun postMessage(json: String) {
        activity.onBridgeMessage(json)
    }
}
