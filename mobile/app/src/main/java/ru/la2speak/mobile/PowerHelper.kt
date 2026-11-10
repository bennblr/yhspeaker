package ru.la2speak.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast

object PowerHelper {
    fun requestIgnoreBatteryOptimizations(activity: Activity) {
        val manager = activity.getSystemService(PowerManager::class.java)
        if (manager.isIgnoringBatteryOptimizations(activity.packageName)) {
            Toast.makeText(activity, "Работа в фоне уже разрешена", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            activity.startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${activity.packageName}"),
                ),
            )
        } catch (_: Exception) {
            try {
                activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
                Toast.makeText(activity, "Не удалось открыть настройки батареи", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
