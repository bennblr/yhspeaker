package ru.la2speak.mobile

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatButton
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var serverList: LinearLayout
    private lateinit var serverInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_servers)
        serverList = findViewById(R.id.serverList)
        serverInput = findViewById(R.id.serverInput)

        findViewById<Button>(R.id.connectButton).setOnClickListener { connect() }
        findViewById<Button>(R.id.batteryButton).setOnClickListener {
            PowerHelper.requestIgnoreBatteryOptimizations(this)
        }
        serverInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                connect()
                true
            } else {
                false
            }
        }

        renderServers()

        // Уведомление привело в приложение, а сервер уже выбран раньше.
        if (intent.getStringExtra(EXTRA_DM) != null) {
            AppPrefs.server(this)?.let { openServer(it) }
        }
    }

    override fun onResume() {
        super.onResume()
        renderServers()
    }

    private fun connect() {
        val url = ServerUrl.normalize(serverInput.text.toString())
        if (url == null) {
            Toast.makeText(this, "Введите адрес сервера, например la2speak.com", Toast.LENGTH_SHORT).show()
            return
        }
        openServer(url)
    }

    private fun openServer(url: String) {
        AppPrefs.setServer(this, url)
        serverInput.setText("")
        startActivity(
            Intent(this, WebAppActivity::class.java)
                .putExtra(EXTRA_SERVER, url),
        )
        renderServers()
    }

    private fun renderServers() {
        serverList.removeAllViews()
        val servers = AppPrefs.servers(this)
        if (servers.isEmpty()) {
            serverList.addView(
                TextView(this).apply {
                    text = "Сохранённых серверов пока нет."
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
                    textSize = 13f
                    setPadding(0, dp(8), 0, dp(8))
                },
            )
            return
        }

        for (url in servers) {
            val row = AppCompatButton(this, null, android.R.attr.borderlessButtonStyle).apply {
                text = ServerUrl.host(url)
                isAllCaps = false
                textSize = 16f
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text))
                setPadding(dp(12), dp(10), dp(12), dp(10))
                setOnClickListener { openServer(url) }
                setOnLongClickListener {
                    confirmRemove(url)
                    true
                }
            }
            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            params.bottomMargin = dp(4)
            serverList.addView(row, params)
        }

        serverList.addView(
            TextView(this).apply {
                text = "Долгое нажатие на сервер — удалить."
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
                textSize = 11f
                setPadding(dp(12), dp(4), 0, 0)
            },
        )
    }

    private fun confirmRemove(url: String) {
        AlertDialog.Builder(this)
            .setTitle("Удалить сервер?")
            .setMessage(ServerUrl.host(url))
            .setPositiveButton("Удалить") { _, _ ->
                AppPrefs.forgetServer(this, url)
                renderServers()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
