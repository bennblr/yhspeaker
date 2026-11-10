package ru.la2speak.mobile

import android.net.Uri

object ServerUrl {
    private val schemePattern = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")

    // Приводим ввод к источнику (scheme://host:port): веб-клиент привязан
    // к своему origin, путь и query ему не нужны.
    fun normalize(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val withScheme = if (schemePattern.containsMatchIn(trimmed)) trimmed else "https://$trimmed"
        val uri = try {
            Uri.parse(withScheme)
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase() ?: return null
        if (!host.contains('.') && host != "localhost") return null
        val port = if (uri.port != -1) ":${uri.port}" else ""
        return "$scheme://$host$port"
    }

    fun host(value: String): String {
        return try {
            Uri.parse(value).authority ?: value
        } catch (_: Exception) {
            value
        }
    }
}
