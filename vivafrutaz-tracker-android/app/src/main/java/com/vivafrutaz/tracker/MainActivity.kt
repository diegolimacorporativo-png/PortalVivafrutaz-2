package com.vivafrutaz.tracker

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.vivafrutaz.tracker.data.SecureStore
import com.vivafrutaz.tracker.network.LoginResult
import com.vivafrutaz.tracker.network.SessionResult
import com.vivafrutaz.tracker.network.TrackerApi
import com.vivafrutaz.tracker.tracking.TrackingService
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var api: TrackerApi
    private lateinit var store: SecureStore
    private lateinit var content: LinearLayout
    private var pendingSessionName = "Motorista"
    private var pendingSessionRole = ""

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        if (hasForegroundLocationPermission()) {
            startTracking()
            showTracking(pendingSessionName)
        } else {
            showMessage(
                "A permissão de localização é obrigatória para manter o rastreamento ativo.",
                isError = true,
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = TrackerApi(this)
        store = api.secureStore()
        buildShell()
        restoreSessionOrLogin()
    }

    private fun buildShell() {
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(24))
            setBackgroundColor(Color.rgb(247, 250, 246))
        }
        setContentView(content)
    }

    private fun restoreSessionOrLogin() {
        if (!store.hasSession() || store.baseUrl().isBlank()) {
            showLogin()
            return
        }
        showLoading("Validando sessão segura…")
        lifecycleScope.launch {
            when (val result = api.me()) {
                is SessionResult.Success -> {
                    if (isDriverRole(result.session.role)) {
                        pendingSessionName = result.session.name
                        pendingSessionRole = result.session.role
                        requestPermissionsAndStart()
                    } else {
                        store.clearSession()
                        showLogin("Esta conta não possui perfil de motorista.")
                    }
                }
                is SessionResult.Failure -> {
                    if (result.error.retryable) {
                        // Keep the persisted session usable while offline. The
                        // service can keep capturing into Room and will stop
                        // itself later if the server rejects the session.
                        pendingSessionName = "Motorista"
                        requestPermissionsAndStart()
                    } else {
                        store.clearSession()
                        showLogin("Sua sessão precisa ser renovada.", isError = true)
                    }
                }
            }
        }
    }

    private fun showLogin(message: String? = null, isError: Boolean = false) {
        content.removeAllViews()
        addTitle("VivaFrutaz Tracker")
        addSubtitle("Rastreamento seguro para motoristas")

        val server = addInput(
            hint = "Endereço do servidor",
            value = store.baseUrl().ifBlank { BuildConfig.API_BASE_URL },
        )
        val email = addInput("Email ou usuário")
        val password = addInput("Senha").apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val status = addStatus(message, isError)
        val login = Button(this).apply {
            text = "Entrar e iniciar rastreamento"
            isAllCaps = false
            setOnClickListener {
                val url = server.text.toString().trim().trimEnd('/')
                val identifier = email.text.toString().trim()
                val secret = password.text.toString()
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    status.text = "Informe uma URL http:// ou https:// válida."
                    status.setTextColor(Color.rgb(183, 28, 28))
                    return@setOnClickListener
                }
                if (identifier.isBlank() || secret.isBlank()) {
                    status.text = "Informe usuário e senha."
                    status.setTextColor(Color.rgb(183, 28, 28))
                    return@setOnClickListener
                }
                isEnabled = false
                status.text = "Autenticando…"
                status.setTextColor(Color.DKGRAY)
                lifecycleScope.launch {
                    store.saveBaseUrl(url)
                    when (val result = api.login(identifier, secret)) {
                        is LoginResult.Success -> {
                            if (!isDriverRole(result.session.role)) {
                                store.clearSession()
                                status.text = "Esta conta não possui perfil de motorista."
                                status.setTextColor(Color.rgb(183, 28, 28))
                                isEnabled = true
                            } else {
                                pendingSessionName = result.session.name
                                pendingSessionRole = result.session.role
                                requestPermissionsAndStart()
                            }
                        }
                        is LoginResult.Failure -> {
                            status.text = result.error.message
                            status.setTextColor(Color.rgb(183, 28, 28))
                            isEnabled = true
                        }
                    }
                }
            }
        }
        content.addView(login, marginParams(top = 18))

        val securityNote = TextView(this).apply {
            text = "A senha não é armazenada. A sessão e o identificador do dispositivo ficam protegidos pelo Android."
            textSize = 12f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(18), 0, 0)
        }
        content.addView(securityNote)
    }

    private fun requestPermissionsAndStart() {
        val permissions = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (hasForegroundLocationPermission() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED)
        ) {
            startTracking()
            showTracking(pendingSessionName)
        } else {
            permissionLauncher.launch(permissions.toTypedArray())
        }
    }

    private fun showTracking(name: String) {
        content.removeAllViews()
        addTitle("Rastreamento ativo")
        addSubtitle("VivaFrutaz • $name")

        val card = TextView(this).apply {
            text = "O serviço de localização está protegido e continuará funcionando enquanto o Android permitir.\\n\\n" +
                "• coleta por Foreground Service\\n" +
                "• envio para o endpoint GPS existente\\n" +
                "• fila local durante perda de internet\\n" +
                "• reenvio automático ao reconectar\\n\\n" +
                "Não existe um botão comum para desligar o rastreamento."
            textSize = 16f
            setTextColor(Color.rgb(35, 55, 38))
            setBackgroundColor(Color.WHITE)
            setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        content.addView(card, marginParams(top = 22))

        val authNote = TextView(this).apply {
            text = "Sessão revalidada automaticamente quando o aplicativo é aberto. A renovação silenciosa após a validade atual do servidor depende de uma extensão específica de autenticação do Tracker."
            textSize = 12f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(18), 0, 0)
        }
        content.addView(authNote)
    }

    private fun startTracking() {
        ContextCompat.startForegroundService(
            this,
            Intent(this, TrackingService::class.java),
        )
    }

    private fun showLoading(message: String) {
        content.removeAllViews()
        val progress = ProgressBar(this)
        content.addView(progress, LinearLayout.LayoutParams(-2, -2).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        addStatus(message, false)
    }

    private fun showMessage(message: String, isError: Boolean) {
        addStatus(message, isError)
    }

    private fun addTitle(text: String) {
        content.addView(TextView(this).apply {
            this.text = text
            textSize = 28f
            setTextColor(Color.rgb(27, 94, 32))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
    }

    private fun addSubtitle(text: String) {
        content.addView(TextView(this).apply {
            this.text = text
            textSize = 15f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(6), 0, 0)
        })
    }

    private fun addInput(hint: String, value: String = ""): EditText =
        EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 16f
            singleLine = true
            content.addView(this, marginParams(top = 12))
        }

    private fun addStatus(message: String? = null, isError: Boolean = false): TextView =
        TextView(this).apply {
            text = message.orEmpty()
            textSize = 14f
            setTextColor(if (isError) Color.rgb(183, 28, 28) else Color.DKGRAY)
            content.addView(this, marginParams(top = 12))
        }

    private fun marginParams(top: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(top)
        }

    private fun hasForegroundLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED

    private fun isDriverRole(role: String): Boolean =
        role == "DRIVER" || role == "MOTORISTA"

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}