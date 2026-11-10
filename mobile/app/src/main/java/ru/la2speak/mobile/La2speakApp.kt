package ru.la2speak.mobile

import android.app.Application

class La2speakApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannels(this)
    }
}
