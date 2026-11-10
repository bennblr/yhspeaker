package ru.la2speak.mobile

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

// Невидимая переадресация: уведомление ведёт в конкретную переписку, а не
// просто открывает приложение.
class PushRouterActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Своё уведомление кладёт EXTRA_DM, а FCM из серверного payload
        // открывает активность с data-полем «userId».
        val dm = intent.getStringExtra(EXTRA_DM) ?: intent.getStringExtra("userId")
        val server = AppPrefs.server(this)

        if (server != null) {
            val target = Intent(this, WebAppActivity::class.java).putExtra(EXTRA_SERVER, server)
            if (!dm.isNullOrEmpty()) target.putExtra(EXTRA_DM, dm)
            startActivity(target)
        } else {
            if (!dm.isNullOrEmpty()) AppPrefs.setPendingDm(this, dm)
            startActivity(Intent(this, MainActivity::class.java))
        }
        finish()
    }

    companion object {
        const val ACTION_OPEN_DM = "ru.la2speak.mobile.OPEN_DM"
    }
}
