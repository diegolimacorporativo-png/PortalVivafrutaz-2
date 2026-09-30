package com.vivafrutaz.tracker

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import android.util.Base64
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
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
import com.vivafrutaz.tracker.network.RouteResult
import com.vivafrutaz.tracker.network.ChecklistResult
import com.vivafrutaz.tracker.network.StopStatusSendResult
import com.vivafrutaz.tracker.model.DriverDelivery
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
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private lateinit var api: TrackerApi
    private lateinit var store: SecureStore
    private lateinit var trackingStateStore: TrackingStateStore
    private lateinit var content: LinearLayout
    private var stateRefreshJob: Job? = null
    private var pendingSessionName = "Motorista"
    private var pendingSessionRole = ""
    private var proofDeliveryId: Long? = null
    private val proofPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val deliveryId = proofDeliveryId ?: return@registerForActivityResult
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@launch
            if (bytes.size > 4_000_000) { Toast.makeText(this@MainActivity, "Imagem muito grande", Toast.LENGTH_LONG).show(); return@launch }
            val encoded = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            when (val result = api.sendProof(deliveryId, null, listOf(encoded), "Foto da entrega", UUID.randomUUID().toString())) {
                is com.vivafrutaz.tracker.network.OperationResult.Success -> Toast.makeText(this@MainActivity, "Foto enviada", Toast.LENGTH_SHORT).show()
                is com.vivafrutaz.tracker.network.OperationResult.Failure -> Toast.makeText(this@MainActivity, result.error.message, Toast.LENGTH_LONG).show()
            }
        }
    }

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
                    if (isTrackingRole(result.session.role)) {
                        pendingSessionName = result.session.name
                        pendingSessionRole = result.session.role
                        requestPermissionsAndStart()
                    } else {
                        store.clearSession()
                        showLogin("Esta conta não possui perfil de motorista ou logística.")
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
                            if (!isTrackingRole(result.session.role)) {
                                store.clearSession()
                                status.text = "Esta conta não possui perfil de motorista ou logística."
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
        val routeTitle = TextView(this).apply {
            text = "Rota do dia"
            textSize = 21f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.rgb(27, 94, 32))
        }
        content.addView(routeTitle, marginParams(top = 26))
        val routeStatus = addStatus("Carregando rota…")
        val routeContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(routeContainer, marginParams(top = 8))
        loadRoute(routeStatus, routeContainer)
        addOperationsPanel()
    }

    private fun addOperationsPanel() {
        content.addView(TextView(this).apply { text = "Operação"; textSize = 21f; setTypeface(typeface, android.graphics.Typeface.BOLD); setTextColor(Color.rgb(27, 94, 32)) }, marginParams(top = 26))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(Button(this).apply { text = "Iniciar jornada"; isAllCaps = false; setOnClickListener { journeyDialog(false) } }, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(Button(this).apply { text = "Encerrar jornada"; isAllCaps = false; setOnClickListener { journeyDialog(true) } }, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(row, marginParams(top = 8))
        content.addView(Button(this).apply { text = "Registrar abastecimento"; isAllCaps = false; setOnClickListener { fuelDialog() } }, marginParams(top = 6))
    }

    private fun journeyDialog(end: Boolean) {
        val odometer = EditText(this).apply { hint = "Odômetro ${if (end) "final" else "inicial"}"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL }
        val observation = EditText(this).apply { hint = "Observação (opcional)" }
        val dialog = androidx.appcompat.app.AlertDialog.Builder(this).setTitle(if (end) "Encerrar jornada" else "Iniciar jornada").setView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), 0, dp(18), 0); addView(odometer); addView(observation) }).setNegativeButton("Cancelar", null).setPositiveButton("Confirmar", null).create()
        dialog.setOnShowListener { dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener { val value = odometer.text.toString().toDoubleOrNull(); if (value == null) { odometer.error = "Informe o odômetro"; return@setOnClickListener }; lifecycleScope.launch { val key = UUID.randomUUID().toString(); val result = if (end) api.endJourney(value, observation.text.toString(), key) else api.startJourney(value, null, observation.text.toString(), key); when (result) { is com.vivafrutaz.tracker.network.OperationResult.Success -> { dialog.dismiss(); Toast.makeText(this@MainActivity, if (end) "Jornada encerrada" else "Jornada iniciada", Toast.LENGTH_SHORT).show() }; is com.vivafrutaz.tracker.network.OperationResult.Failure -> Toast.makeText(this@MainActivity, result.error.message, Toast.LENGTH_LONG).show() } } } }
        dialog.show()
    }

    private fun fuelDialog() {
        val liters = EditText(this).apply { hint = "Litros"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL }
        val total = EditText(this).apply { hint = "Valor total"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL }
        val type = EditText(this).apply { hint = "Combustível (ex.: diesel)" }
        val station = EditText(this).apply { hint = "Posto" }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), 0, dp(18), 0); addView(liters); addView(total); addView(type); addView(station) }
        val dialog = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Registrar abastecimento").setView(box).setNegativeButton("Cancelar", null).setPositiveButton("Salvar", null).create()
        dialog.setOnShowListener { dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener { val l = liters.text.toString().toDoubleOrNull(); val t = total.text.toString().toDoubleOrNull(); if (l == null || t == null || type.text.isNullOrBlank()) { Toast.makeText(this, "Preencha litros, valor e combustível", Toast.LENGTH_LONG).show(); return@setOnClickListener }; lifecycleScope.launch { when (val r = api.recordFuel(l, t / l, t, type.text.toString(), station.text.toString(), null, null, "", UUID.randomUUID().toString())) { is com.vivafrutaz.tracker.network.OperationResult.Success -> { dialog.dismiss(); Toast.makeText(this@MainActivity, "Abastecimento salvo", Toast.LENGTH_SHORT).show() }; is com.vivafrutaz.tracker.network.OperationResult.Failure -> Toast.makeText(this@MainActivity, r.error.message, Toast.LENGTH_LONG).show() } } } }
        dialog.show()
    }

    private fun loadRoute(status: TextView, container: LinearLayout) {
        lifecycleScope.launch {
            when (val result = api.getRouteToday()) {
                is RouteResult.Success -> {
                    status.text = if (result.route.deliveries.isEmpty()) "Nenhuma parada programada para hoje." else "${result.route.deliveries.size} parada(s)"
                    container.removeAllViews()
                    result.route.deliveries.sortedBy { it.routePosition ?: Int.MAX_VALUE }.forEach { renderDelivery(container, it) }
                }
                is RouteResult.Failure -> { status.text = result.error.message; status.setTextColor(Color.rgb(183, 28, 28)) }
            }
        }
    }

    private fun renderDelivery(container: LinearLayout, delivery: DriverDelivery) {
        val card = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE); setPadding(dp(16), dp(14), dp(16), dp(14)) }
        card.addView(TextView(this).apply { text = "${delivery.routePosition?.let { "$it. " } ?: ""}${delivery.companyName}"; textSize = 17f; setTypeface(typeface, android.graphics.Typeface.BOLD); setTextColor(Color.rgb(35, 55, 35)) })
        card.addView(TextView(this).apply { text = listOf(delivery.address, delivery.city).filter { it.isNotBlank() }.joinToString(" • ").ifBlank { "Endereço não informado" }; textSize = 14f; setPadding(0, dp(5), 0, 0) })
        card.addView(TextView(this).apply { text = "Status: ${delivery.status}${delivery.deliveryWindow?.let { " • Janela: $it" } ?: ""}"; textSize = 13f; setTextColor(Color.DKGRAY); setPadding(0, dp(5), 0, 0) })
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        actions.addView(Button(this).apply { text = "Entregue"; isAllCaps = false; setOnClickListener { openChecklist(delivery, card) } }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(Button(this).apply { text = "Ocorrência"; isAllCaps = false; setOnClickListener { updateStop(delivery, "problema") } }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(Button(this).apply { text = "Assinar"; isAllCaps = false; setOnClickListener { signatureDialog(delivery.id) } }, LinearLayout.LayoutParams(0, -2, 1f))
        actions.addView(Button(this).apply { text = "Foto"; isAllCaps = false; setOnClickListener { proofDeliveryId = delivery.id; proofPicker.launch("image/*") } }, LinearLayout.LayoutParams(0, -2, 1f))
        card.addView(actions, marginParams(top = 8)); container.addView(card, marginParams(top = 10))
    }

    private fun openChecklist(delivery: DriverDelivery, card: LinearLayout) {
        val input = EditText(this).apply { hint = "Observação da entrega (opcional)"; minLines = 2 }
        val dialog = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Confirmar entrega").setMessage("${delivery.companyName}\n${delivery.address}").setView(input).setNegativeButton("Cancelar", null).setPositiveButton("Confirmar", null).create()
        dialog.setOnShowListener { dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener { lifecycleScope.launch { when (val r = api.confirmChecklist(delivery.id, input.text.toString())) { is ChecklistResult.Success -> { dialog.dismiss(); card.alpha = 0.6f; Toast.makeText(this@MainActivity, "Entrega confirmada", Toast.LENGTH_SHORT).show() }; is ChecklistResult.Failure -> Toast.makeText(this@MainActivity, r.error.message, Toast.LENGTH_LONG).show() } } } }
        dialog.show()
    }

    private fun updateStop(delivery: DriverDelivery, status: String) {
        val input = EditText(this).apply { hint = "Descreva a ocorrência"; minLines = 2 }
        val dialog = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Registrar ocorrência").setView(input).setNegativeButton("Cancelar", null).setPositiveButton("Registrar", null).create()
        dialog.setOnShowListener { dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener { lifecycleScope.launch { when (val r = api.updateStopStatus(delivery.id, status, input.text.toString())) { is StopStatusSendResult.Success -> { dialog.dismiss(); Toast.makeText(this@MainActivity, "Status atualizado", Toast.LENGTH_SHORT).show() }; is StopStatusSendResult.Failure -> Toast.makeText(this@MainActivity, r.error.message, Toast.LENGTH_LONG).show() } } } }
        dialog.show()
    }

    private fun signatureDialog(deliveryId: Long) {
        val pad = SignaturePadView(this)
        val dialog = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Assinatura do recebedor").setMessage("Desenhe a assinatura no quadro abaixo.").setView(pad).setNegativeButton("Limpar") { _, _ -> pad.clear() }.setPositiveButton("Enviar", null).create()
        dialog.setOnShowListener { dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener { val encoded = pad.pngBase64(); if (encoded == null) { Toast.makeText(this, "Faça a assinatura antes de enviar", Toast.LENGTH_LONG).show(); return@setOnClickListener }; lifecycleScope.launch { when (val r = api.sendProof(deliveryId, encoded, emptyList(), "Assinatura do recebedor", UUID.randomUUID().toString())) { is com.vivafrutaz.tracker.network.OperationResult.Success -> { dialog.dismiss(); Toast.makeText(this@MainActivity, "Assinatura enviada", Toast.LENGTH_SHORT).show() }; is com.vivafrutaz.tracker.network.OperationResult.Failure -> Toast.makeText(this@MainActivity, r.error.message, Toast.LENGTH_LONG).show() } } } }
        dialog.show()
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
            maxLines = 1
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

    private fun isTrackingRole(role: String): Boolean =
        role == "DRIVER" || role == "MOTORISTA" || role == "LOGISTICS"

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}

private class SignaturePadView(context: android.content.Context) : View(context) {
    private val path = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = 5f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private var bitmap: Bitmap? = null
    private var canvas: Canvas? = null
    private var touched = false
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { bitmap = Bitmap.createBitmap(w.coerceAtLeast(1), h.coerceAtLeast(1), Bitmap.Config.ARGB_8888); canvas = Canvas(bitmap!!).also { it.drawColor(Color.WHITE) } }
    override fun onDraw(c: Canvas) { super.onDraw(c); bitmap?.let { c.drawBitmap(it, 0f, 0f, null) }; c.drawLine(20f, height - 24f, width - 20f, height - 24f, paint) }
    override fun onTouchEvent(event: MotionEvent): Boolean { when (event.action) { MotionEvent.ACTION_DOWN -> { path.moveTo(event.x, event.y); touched = true }; MotionEvent.ACTION_MOVE -> { path.lineTo(event.x, event.y); canvas?.drawPath(path, paint); path.reset(); path.moveTo(event.x, event.y); invalidate() }; MotionEvent.ACTION_UP -> { canvas?.drawPath(path, paint); path.reset(); invalidate() } }; return true }
    fun clear() { canvas?.drawColor(Color.WHITE); touched = false; invalidate() }
    fun pngBase64(): String? { val b = bitmap ?: return null; if (!touched) return null; val out = java.io.ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.PNG, 100, out); return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP) }
}
