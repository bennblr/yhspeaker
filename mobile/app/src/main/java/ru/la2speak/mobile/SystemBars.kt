package ru.la2speak.mobile

import android.os.Build
import android.view.View
import android.view.Window
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

// С Android 15 окно всегда рисуется под системными панелями (edge-to-edge):
// без явных отступов статус-бар и панель навигации перекрывают интерфейс.
// На более старых версиях отступы по-прежнему расставляет система.
fun applySystemBarInsets(window: Window, root: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    WindowCompat.setDecorFitsSystemWindows(window, false)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
        val bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        view.updatePadding(
            left = bars.left,
            top = bars.top,
            right = bars.right,
            bottom = maxOf(bars.bottom, ime),
        )
        WindowInsetsCompat.CONSUMED
    }
}
