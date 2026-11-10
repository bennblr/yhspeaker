package ru.la2speak.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationHelper {
    const val CHANNEL_VOICE = "voice"
    const val CHANNEL_DM = "dm"
    const val VOICE_NOTIFICATION_ID = 4101

    private fun pendingFlags(): Int =
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val voice = NotificationChannel(
            CHANNEL_VOICE,
            "Голосовой канал",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Текущий звонок и управление микрофоном"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        val dm = NotificationChannel(
            CHANNEL_DM,
            "Личные сообщения",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Сообщения в личных чатах"
            enableVibration(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannels(listOf(voice, dm))
    }

    // Уведомление foreground-службы видно и на заблокированном экране: по нему
    // можно выключить микрофон или выйти из канала, не разблокируя телефон.
    fun voiceNotification(
        context: Context,
        channelName: String,
        micOn: Boolean,
        muted: Boolean,
        broadcasting: Boolean,
    ): Notification {
        val open = Intent(context, WebAppActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val contentIntent = PendingIntent.getActivity(context, 0, open, pendingFlags())

        val toggleIntent = PendingIntent.getService(
            context,
            1,
            Intent(context, VoiceService::class.java).setAction(VoiceService.ACTION_TOGGLE_MIC),
            pendingFlags(),
        )
        val leaveIntent = PendingIntent.getService(
            context,
            2,
            Intent(context, VoiceService::class.java).setAction(VoiceService.ACTION_LEAVE),
            pendingFlags(),
        )

        val title = if (channelName.isBlank()) "LA2Speak" else "LA2Speak · $channelName"
        val state = when {
            muted -> "Микрофон выключен"
            broadcasting -> "Вещание · микрофон включён"
            micOn -> "Микрофон включён"
            else -> "Микрофон выключен"
        }

        return NotificationCompat.Builder(context, CHANNEL_VOICE)
            .setSmallIcon(R.drawable.ic_stat_la2speak)
            .setContentTitle(title)
            .setContentText(state)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(
                0,
                if (muted) "Включить микрофон" else "Выключить микрофон",
                toggleIntent,
            )
            .addAction(0, "Выйти из канала", leaveIntent)
            .build()
    }

    fun showDirectMessage(context: Context, userId: String, title: String, body: String) {
        ensureChannels(context)
        val intent = Intent(context, PushRouterActivity::class.java)
            .setAction(PushRouterActivity.ACTION_OPEN_DM)
            .putExtra(EXTRA_DM, userId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(
            context,
            100 + (userId.hashCode() and 0x7fff),
            intent,
            pendingFlags(),
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_DM)
            .setSmallIcon(R.drawable.ic_stat_la2speak)
            .setContentTitle(title.ifBlank { "Новое сообщение" })
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

        val id = 1000 + (userId.ifEmpty { title }.hashCode() and 0x7fff)
        context.getSystemService(NotificationManager::class.java).notify(id, notification)
    }

    fun supportsNotificationPermission(): Boolean = Build.VERSION.SDK_INT >= 33
}
