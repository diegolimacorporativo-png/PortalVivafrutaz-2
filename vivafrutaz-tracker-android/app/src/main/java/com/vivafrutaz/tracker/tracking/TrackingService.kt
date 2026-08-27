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
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val flushing = AtomicBoolean(false)
    private var retryAttempt = 0

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach { location -> capture(location) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        api = TrackerApi(this)
        dao = GpsDatabase.get(this).pendingGpsDao()
        fusedLocation = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!hasLocationPermission() || !api.secureStore().hasSession()) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundCompat(buildNotification("Aguardando localização"))
        startLocationUpdates()
        serviceScope.launch { flushPending() }
        return START_STICKY
    }

    private fun startLocationUpdates() {
        if (!hasLocationPermission()) return
        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            UPDATE_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .setWaitForAccurateLocation(false)
            .build()
        fusedLocation.requestLocationUpdates(request, locationCallback, mainLooper)
    }

    private fun capture(location: Location) {
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
            flushPending()
        }
    }

    private suspend fun flushPending() {
        if (!flushing.compareAndSet(false, true)) return
        try {
            while (true) {
                val item = dao.oldest(BATCH_SIZE).firstOrNull() ?: break
                val result = api.sendGps(
                    GpsPayload(
                        latitude = item.latitude,
                        longitude = item.longitude,
                        accuracy = item.accuracy,
                        speed = item.speed,
                        heading = item.heading,
                        capturedAt = item.capturedAt,
                    ),
                )
                when (result) {
                    GpsSendResult.Success -> {
                        dao.delete(item.id)
                        retryAttempt = 0
                        updateNotification("GPS ativo — posição enviada")
                    }
                    is GpsSendResult.Failure -> {
                        val error = result.error
                        if (error is ApiFailure.Http && (error.status == 401 || error.status == 403)) {
                            updateNotification("Sessão precisa ser revalidada")
                            stopLocationUpdates()
                            stopSelf()
                            return
                        }
                        if (error.retryable) {
                            scheduleRetry()
                        } else {
                            // Invalid payloads must not block every later position forever.
                            dao.delete(item.id)
                            updateNotification("GPS aguardando uma posição válida")
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
        serviceScope.cancel()
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