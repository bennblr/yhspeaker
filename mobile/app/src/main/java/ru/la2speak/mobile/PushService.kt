package ru.la2speak.mobile

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        AppPrefs.setFcmToken(this, token)
        NativeEvents.emit("push-token", JSONObject().put("token", token))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Приложение открыто: личное сообщение уже пришло по сокету, системное
        // уведомление только задвоило бы его.
        if (NativeEvents.isAttached()) return

        val data = message.data
        if (data["type"] != "dm") return
        val userId = data["userId"].orEmpty()
        val title = message.notification?.title ?: "Новое сообщение"
        val body = message.notification?.body.orEmpty()
        NotificationHelper.showDirectMessage(this, userId, title, body)
    }
}
