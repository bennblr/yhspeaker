package ru.la2speak.mobile

import android.content.Context
import org.json.JSONArray

// Небольшое хранилище настроек оболочки: список серверов, последний сервер,
// токен FCM и отложенный переход к переписке из уведомления.
object AppPrefs {
    private const val FILE = "la2speak"
    private const val KEY_SERVER = "server_url"
    private const val KEY_SERVERS = "servers"
    private const val KEY_FCM = "fcm_token"
    private const val KEY_PENDING_DM = "pending_dm"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun server(context: Context): String? = prefs(context).getString(KEY_SERVER, null)

    fun setServer(context: Context, url: String) {
        prefs(context).edit().putString(KEY_SERVER, url).apply()
        rememberServer(context, url)
    }

    fun servers(context: Context): List<String> {
        val raw = prefs(context).getString(KEY_SERVERS, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            val result = mutableListOf<String>()
            for (index in 0 until array.length()) {
                val value = array.optString(index, "")
                if (value.isNotBlank()) result.add(value)
            }
            result
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun rememberServer(context: Context, url: String) {
        val next = (listOf(url) + servers(context).filterNot { it == url }).take(10)
        val array = JSONArray()
        next.forEach { array.put(it) }
        prefs(context).edit().putString(KEY_SERVERS, array.toString()).apply()
    }

    fun forgetServer(context: Context, url: String) {
        val array = JSONArray()
        servers(context).filterNot { it == url }.forEach { array.put(it) }
        val editor = prefs(context).edit().putString(KEY_SERVERS, array.toString())
        if (server(context) == url) editor.remove(KEY_SERVER)
        editor.apply()
    }

    fun fcmToken(context: Context): String? =
        prefs(context).getString(KEY_FCM, null)?.takeIf { it.isNotBlank() }

    fun setFcmToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_FCM, token).apply()
    }

    fun setPendingDm(context: Context, userId: String) {
        prefs(context).edit().putString(KEY_PENDING_DM, userId).apply()
    }

    fun takePendingDm(context: Context): String? {
        val value = prefs(context).getString(KEY_PENDING_DM, null)?.takeIf { it.isNotBlank() }
            ?: return null
        prefs(context).edit().remove(KEY_PENDING_DM).apply()
        return value
    }
}
