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
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.vivafrutaz.tracker.data.SecureStore
import com.vivafrutaz.tracker.data.TrackingState
import com.vivafrutaz.tracker.data.TrackingStateStore
import com.vivafrutaz.tracker.network.LoginResult
import com.vivafrutaz.tracker.network.SessionResult
import com.vivafrutaz.tracker.network.TrackerApi
import com.vivafrutaz.tracker.tracking.TrackingService
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var api: TrackerApi
    private lateinit var store: SecureStore
    private lateinit var trackingStateStore: TrackingStateStore
    private lateinit var content: LinearLayout
    private var stateRefreshJob: Job? = null
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
        trackingStateStore = TrackingStateStore(this)
        buildShell()
        restoreSessionOrLogin()
    }

    private fun buildShell() {
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(24))
            setBackgroundColor(Color.rgb(247, 250, 246))
        }
        setContentView(ScrollView(this).apply { addView(content) })
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
        stateRefreshJob?.cancel()
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
        stateRefreshJob?.cancel()
        content.removeAllViews()
        addTitle("Rastreamento do motorista")
        addSubtitle("VivaFrutaz • $name")

        val statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        content.addView(statusCard, marginParams(top = 22))

        val statusValue = TextView(this).apply {
            textSize = 22f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        val statusDetail = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(6), 0, 0)
        }
        val backgroundValue = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(14), 0, 0)
        }
        val lastCaptureValue = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(14), 0, 0)
        }
        val lastSentValue = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(14), 0, 0)
        }
        val pendingValue = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(14), 0, 0)
        }
        statusCard.addView(statusValue)
        statusCard.addView(statusDetail)
        statusCard.addView(backgroundValue)
        statusCard.addView(lastCaptureValue)
        statusCard.addView(lastSentValue)
        statusCard.addView(pendingValue)

        renderTrackingState(
            statusValue,
            statusDetail,
            backgroundValue,
            lastCaptureValue,
            lastSentValue,
            pendingValue,
        )
        stateRefreshJob = lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive) {
                    renderTrackingState(
                        statusValue,
                        statusDetail,
                        backgroundValue,
                        lastCaptureValue,
                        lastSentValue,
                        pendingValue,
                    )
                    delay(1_000)
                }
            }
        }

        val scopeNote = TextView(this).apply {
            text = "A tela acompanha o estado persistido pelo serviço. O Foreground Service continua coletando mesmo quando esta Activity é fechada. Não existe um botão comum para desligar o rastreamento."
            textSize = 12f
            setTextColor(Color.DKGRAY)
            setPadding(0, dp(18), 0, 0)
        }
        content.addView(scopeNote)
    }

    private fun renderTrackingState(
        statusValue: TextView,
        statusDetail: TextView,
        backgroundValue: TextView,
        lastCaptureValue: TextView,
        lastSentValue: TextView,
        pendingValue: TextView,
    ) {
        val state = trackingStateStore.read()
        val statusLabel = when (state.status) {
            TrackingState.STATUS_ACTIVE -> "GPS ATIVO"
            TrackingState.STATUS_NO_INTERNET -> "SEM INTERNET"
            TrackingState.STATUS_ERROR -> "ERRO"
            else -> "SEM SINAL / GPS INDISPONÍVEL"
        }
        val statusColor = when (state.status) {
            TrackingState.STATUS_ACTIVE -> Color.rgb(27, 94, 32)
            TrackingState.STATUS_ERROR -> Color.rgb(183, 28, 28)
            else -> Color.rgb(173, 91, 0)
        }
        statusValue.text = statusLabel
        statusValue.setTextColor(statusColor)
        statusDetail.text = state.errorMessage
            ?: when (state.status) {
                TrackingState.STATUS_ACTIVE -> "Última posição capturada e monitorada pelo serviço."
                TrackingState.STATUS_NO_INTERNET -> "As posições continuam sendo guardadas localmente."
                TrackingState.STATUS_ERROR -> "O serviço precisa de atenção."
                else -> "Aguardando uma posição válida do GPS."
            }
        statusDetail.setTextColor(if (state.status == TrackingState.STATUS_ERROR) {
            Color.rgb(183, 28, 28)
        } else {
            Color.DKGRAY
        })
        backgroundValue.text = if (state.trackingActive) {
            "Segundo plano: Foreground Service em execução"
        } else {
            "Segundo plano: serviço não está em execução"
        }
        lastCaptureValue.text = buildString {
            append("Última posição capturada: ")
            append(formatDate(state.lastCapturedAt))
            if (state.lastCapturedLatitude != null && state.lastCapturedLongitude != null) {
                append("\n")
                append(formatCoordinates(state.lastCapturedLatitude, state.lastCapturedLongitude))
                state.lastCapturedAccuracy?.let {
                    append(" • precisão ${formatNumber(it)} m")
                }
            }
        }
        lastSentValue.text = buildString {
            append("Última posição enviada ao servidor: ")
            append(formatDate(state.lastSentAt))
            if (state.lastSentLatitude != null && state.lastSentLongitude != null) {
                append("\n")
                append(formatCoordinates(state.lastSentLatitude, state.lastSentLongitude))
            }
        }
        pendingValue.text = "Posições pendentes na fila: ${state.pendingCount}"
    }

    private fun formatDate(value: Long?): String =
        value?.let {
            SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.getDefault()).format(Date(it))
        } ?: "nenhuma"

    private fun formatCoordinates(latitude: Double, longitude: Double): String =
        String.format(Locale.US, "Coordenadas: %.6f, %.6f", latitude, longitude)

    private fun formatNumber(value: Double): String =
        String.format(Locale.getDefault(), "%.1f", value)

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