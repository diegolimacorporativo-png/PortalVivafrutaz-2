package com.vivafrutaz.tracker.tracking

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.vivafrutaz.tracker.R
import com.vivafrutaz.tracker.data.GpsDatabase
import com.vivafrutaz.tracker.data.PendingGpsEntity
import com.vivafrutaz.tracker.data.TrackingState
import com.vivafrutaz.tracker.data.TrackingStateStore
import com.vivafrutaz.tracker.model.GpsPayload
import com.vivafrutaz.tracker.network.ApiFailure
import com.vivafrutaz.tracker.network.GpsSendResult
import com.vivafrutaz.tracker.network.TrackerApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

class TrackingService : Service() {
    private lateinit var fusedLocation: FusedLocationProviderClient
    private lateinit var api: TrackerApi
    private lateinit var dao: com.vivafrutaz.tracker.data.PendingGpsDao
    private lateinit var stateStore: TrackingStateStore
    private lateinit var connectivityManager: ConnectivityManager
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val flushing = AtomicBoolean(false)
    private val stopping = AtomicBoolean(false)
    private var networkCallbackRegistered = false
    private var retryAttempt = 0

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach { location -> capture(location) }
        }

        override fun onLocationAvailability(
            availability: com.google.android.gms.location.LocationAvailability,
        ) {
            if (availability.isLocationAvailable) return
            serviceScope.launch {
                val current = stateStore.read()
                if (!current.trackingActive || current.status == TrackingState.STATUS_ERROR) {
                    return@launch
                }
                val networkAvailable = hasNetwork()
                stateStore.updateStatus(
                    status = if (networkAvailable) {
                        TrackingState.STATUS_NO_SIGNAL
                    } else {
                        TrackingState.STATUS_NO_INTERNET
                    },
                    pendingCount = dao.count(),
                    errorMessage = if (networkAvailable) {
                        "GPS indisponível. Verifique se a localização está ligada."
                    } else {
                        null
                    },
                )
                updateNotification(
                    if (networkAvailable) "GPS indisponível"
                    else "Sem conexão — posição guardada",
                )
            }
        }
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            refreshNetworkState()
        }

        override fun onLost(network: Network) {
            refreshNetworkState()
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) {
            refreshNetworkState()
        }
    }

    override fun onCreate() {
        super.onCreate()
        api = TrackerApi(this)
        dao = GpsDatabase.get(this).pendingGpsDao()
        stateStore = TrackingStateStore(this)
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        fusedLocation = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!api.secureStore().hasSession()) {
            failAndStop(startId, "Sessão do motorista indisponível.")
            return START_NOT_STICKY
        }
        if (!hasLocationPermission()) {
            failAndStop(startId, "Permissão de localização indisponível.")
            return START_NOT_STICKY
        }

        startForegroundCompat(buildNotification("Aguardando localização"))
        startLocationUpdates()
        serviceScope.launch {
            stateStore.serviceStarted(dao.count(), hasNetwork())
            flushPending()
        }
        return START_STICKY
    }

    private fun startLocationUpdates() {
        if (!hasLocationPermission()) return
        if (!isLocationProviderEnabled()) {
            serviceScope.launch {
                val networkAvailable = hasNetwork()
                stateStore.updateStatus(
                    status = if (networkAvailable) {
                        TrackingState.STATUS_NO_SIGNAL
                    } else {
                        TrackingState.STATUS_NO_INTERNET
                    },
                    pendingCount = dao.count(),
                    errorMessage = if (networkAvailable) {
                        "GPS indisponível. Verifique se a localização está ligada."
                    } else {
                        null
                    },
                )
                updateNotification(
                    if (networkAvailable) "GPS indisponível"
                    else "Sem conexão — posição guardada",
                )
            }
            return
        }
        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            UPDATE_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .setWaitForAccurateLocation(false)
            .build()
        runCatching {
            fusedLocation.requestLocationUpdates(request, locationCallback, mainLooper)
        }.onFailure {
            handlePermissionLost()
        }
    }

    private fun capture(location: Location) {
        if (!hasLocationPermission()) {
            handlePermissionLost()
            return
        }
        val payload = GpsPayload(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = location.accuracy.toDouble(),
            speed = if (location.hasSpeed()) location.speed.toDouble() else null,
            heading = if (location.hasBearing()) location.bearing.toDouble() else null,
            capturedAt = System.currentTimeMillis(),
        )
        val fingerprint = listOf(
            payload.capturedAt,
            payload.latitude,
            payload.longitude,
            payload.accuracy,
            payload.speed,
            payload.heading,
        ).joinToString("|")

        serviceScope.launch {
            dao.insert(
                PendingGpsEntity(
                    latitude = payload.latitude,
                    longitude = payload.longitude,
                    accuracy = payload.accuracy,
                    speed = payload.speed,
                    heading = payload.heading,
                    capturedAt = payload.capturedAt,
                    payloadHash = fingerprint,
                ),
            )
            dao.trimToLimit(MAX_QUEUE_SIZE)
            val pendingCount = dao.count()
            val networkAvailable = hasNetwork()
            stateStore.recordCapture(payload, pendingCount, networkAvailable)
            if (networkAvailable) {
                flushPending()
            } else {
                updateNotification("Sem conexão — posição guardada")
            }
        }
    }

    private suspend fun flushPending() {
        if (!hasNetwork()) {
            stateStore.updateStatus(
                TrackingState.STATUS_NO_INTERNET,
                dao.count(),
            )
            updateNotification("Sem conexão — posição guardada")
            return
        }
        if (!flushing.compareAndSet(false, true)) return
        try {
            while (true) {
                if (!hasNetwork()) {
                    stateStore.updateStatus(
                        TrackingState.STATUS_NO_INTERNET,
                        dao.count(),
                    )
                    updateNotification("Sem conexão — posição guardada")
                    return
                }
                val item = dao.oldest(BATCH_SIZE).firstOrNull() ?: break
                val payload = GpsPayload(
                    latitude = item.latitude,
                    longitude = item.longitude,
                    accuracy = item.accuracy,
                    speed = item.speed,
                    heading = item.heading,
                    capturedAt = item.capturedAt,
                )
                val result = api.sendGps(
                    payload,
                )
                when (result) {
                    GpsSendResult.Success -> {
                        dao.delete(item.id)
                        retryAttempt = 0
                        stateStore.recordSent(payload, dao.count())
                        updateNotification("GPS ativo — posição enviada")
                    }
                    is GpsSendResult.Failure -> {
                        val error = result.error
                        val pendingCount = dao.count()
                        if (error is ApiFailure.Network) {
                            stateStore.updateStatus(
                                TrackingState.STATUS_NO_INTERNET,
                                pendingCount,
                            )
                            scheduleRetry()
                            return
                        }
                        if (error is ApiFailure.Http && (error.status == 401 || error.status == 403)) {
                            stateStore.updateStatus(
                                TrackingState.STATUS_ERROR,
                                pendingCount,
                                "Sessão rejeitada pelo servidor. Abra o app para entrar novamente.",
                            )
                            updateNotification("Sessão precisa ser revalidada")
                            stopLocationUpdates()
                            stopSelf()
                            return
                        }
                        if (error.retryable) {
                            stateStore.updateStatus(
                                TrackingState.STATUS_ERROR,
                                pendingCount,
                                error.message,
                            )
                            scheduleRetry()
                        } else {
                            // Invalid payloads must not block every later position forever.
                            dao.delete(item.id)
                            stateStore.updateStatus(
                                TrackingState.STATUS_ERROR,
                                dao.count(),
                                error.message,
                            )
                            updateNotification("Erro ao enviar posição")
                        }
                        return
                    }
                }
            }
        } finally {
            flushing.set(false)
        }
    }

    private fun scheduleRetry() {
        val delayMs = (15_000L * (1L shl retryAttempt.coerceAtMost(3))).coerceAtMost(120_000L)
        retryAttempt = (retryAttempt + 1).coerceAtMost(4)
        serviceScope.launch {
            delay(delayMs)
            flushPending()
        }
        updateNotification("Sem conexão — posição guardada")
    }

    private fun refreshNetworkState() {
        serviceScope.launch {
            val current = stateStore.read()
            if (!current.trackingActive) return@launch
            val available = hasNetwork()
            val pendingCount = dao.count()
            if (!available) {
                if (current.status != TrackingState.STATUS_ERROR) {
                    stateStore.updateStatus(
                        TrackingState.STATUS_NO_INTERNET,
                        pendingCount,
                    )
                }
                updateNotification("Sem conexão — posição guardada")
                return@launch
            }
            if (current.status == TrackingState.STATUS_NO_INTERNET) {
                stateStore.updateStatus(
                    TrackingState.STATUS_NO_SIGNAL,
                    pendingCount,
                )
            }
            if (pendingCount > 0) flushPending()
        }
    }

    private fun failAndStop(startId: Int, message: String) {
        serviceScope.launch {
            stateStore.updateStatus(
                status = TrackingState.STATUS_ERROR,
                pendingCount = dao.count(),
                errorMessage = message,
            )
            updateNotification(message)
            stopSelf(startId)
        }
    }

    private fun handlePermissionLost() {
        if (!stopping.compareAndSet(false, true)) return
        serviceScope.launch {
            stateStore.updateStatus(
                status = TrackingState.STATUS_ERROR,
                pendingCount = dao.count(),
                errorMessage = "Permissão de localização indisponível.",
            )
            updateNotification("Permissão de localização necessária")
            stopLocationUpdates()
            stopSelf()
        }
    }

    private fun registerNetworkCallback() {
        runCatching {
            connectivityManager.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                networkCallback,
            )
            networkCallbackRegistered = true
        }
    }

    private fun hasNetwork(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun isLocationProviderEnabled(): Boolean {
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return runCatching {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED

    private fun stopLocationUpdates() {
        if (::fusedLocation.isInitialized) fusedLocation.removeLocationUpdates(locationCallback)
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(message: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(message))
    }

    private fun buildNotification(message: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracker)
            .setContentTitle(getString(R.string.tracking_notification_title))
            .setContentText(message)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.tracking_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onDestroy() {
        stopLocationUpdates()
        if (networkCallbackRegistered) {
            runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
            networkCallbackRegistered = false
        }
        serviceScope.cancel()
        stateStore.serviceStopped()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private companion object {
        const val CHANNEL_ID = "vivafrutaz_tracking"
        const val NOTIFICATION_ID = 4101
        const val UPDATE_INTERVAL_MS = 15_000L
        const val MIN_UPDATE_INTERVAL_MS = 10_000L
        const val MAX_QUEUE_SIZE = 200
        const val BATCH_SIZE = 20
    }
}