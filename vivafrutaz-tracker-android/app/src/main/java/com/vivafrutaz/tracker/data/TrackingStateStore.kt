package com.vivafrutaz.tracker.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.vivafrutaz.tracker.model.GpsPayload

data class TrackingState(
    val status: String = STATUS_NO_SIGNAL,
    val trackingActive: Boolean = false,
    val pendingCount: Int = 0,
    val lastCapturedAt: Long? = null,
    val lastSentAt: Long? = null,
    val lastSentLatitude: Double? = null,
    val lastSentLongitude: Double? = null,
    val errorMessage: String? = null,
) {
    companion object {
        const val STATUS_ACTIVE = "ATIVO"
        const val STATUS_NO_SIGNAL = "SEM SINAL"
        const val STATUS_NO_INTERNET = "SEM INTERNET"
        const val STATUS_ERROR = "ERRO"
    }
}

class TrackingStateStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "vivafrutaz_tracker_state",
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    fun read(): TrackingState = TrackingState(
        status = preferences.getString(KEY_STATUS, TrackingState.STATUS_NO_SIGNAL)
            ?: TrackingState.STATUS_NO_SIGNAL,
        trackingActive = preferences.getBoolean(KEY_TRACKING_ACTIVE, false),
        pendingCount = preferences.getInt(KEY_PENDING_COUNT, 0),
        lastCapturedAt = preferences.longOrNull(KEY_LAST_CAPTURED_AT),
        lastSentAt = preferences.longOrNull(KEY_LAST_SENT_AT),
        lastSentLatitude = preferences.doubleOrNull(KEY_LAST_SENT_LATITUDE),
        lastSentLongitude = preferences.doubleOrNull(KEY_LAST_SENT_LONGITUDE),
        errorMessage = preferences.getString(KEY_ERROR, null),
    )

    @Synchronized
    fun serviceStarted(pendingCount: Int) {
        preferences.edit()
            .putString(KEY_STATUS, TrackingState.STATUS_NO_SIGNAL)
            .putBoolean(KEY_TRACKING_ACTIVE, true)
            .putInt(KEY_PENDING_COUNT, pendingCount)
            .remove(KEY_ERROR)
            .apply()
    }

    @Synchronized
    fun recordCapture(payload: GpsPayload, pendingCount: Int) {
        preferences.edit()
            .putString(KEY_STATUS, TrackingState.STATUS_ACTIVE)
            .putBoolean(KEY_TRACKING_ACTIVE, true)
            .putInt(KEY_PENDING_COUNT, pendingCount)
            .putLong(KEY_LAST_CAPTURED_AT, payload.capturedAt)
            .remove(KEY_ERROR)
            .apply()
    }

    @Synchronized
    fun recordSent(payload: GpsPayload, pendingCount: Int) {
        preferences.edit()
            .putString(KEY_STATUS, TrackingState.STATUS_ACTIVE)
            .putBoolean(KEY_TRACKING_ACTIVE, true)
            .putInt(KEY_PENDING_COUNT, pendingCount)
            .putLong(KEY_LAST_SENT_AT, System.currentTimeMillis())
            .putDouble(KEY_LAST_SENT_LATITUDE, payload.latitude)
            .putDouble(KEY_LAST_SENT_LONGITUDE, payload.longitude)
            .remove(KEY_ERROR)
            .apply()
    }

    @Synchronized
    fun updateStatus(status: String, pendingCount: Int, errorMessage: String? = null) {
        val editor = preferences.edit()
            .putString(KEY_STATUS, status)
            .putInt(KEY_PENDING_COUNT, pendingCount)
        if (errorMessage.isNullOrBlank()) {
            editor.remove(KEY_ERROR)
        } else {
            editor.putString(KEY_ERROR, errorMessage)
        }
        editor.apply()
    }

    @Synchronized
    fun serviceStopped() {
        preferences.edit()
            .putBoolean(KEY_TRACKING_ACTIVE, false)
            .apply()
    }

    private fun android.content.SharedPreferences.longOrNull(key: String): Long? =
        if (contains(key)) getLong(key, 0L) else null

    private fun android.content.SharedPreferences.doubleOrNull(key: String): Double? =
        if (contains(key)) getString(key, null)?.toDoubleOrNull() else null

    private fun android.content.SharedPreferences.Editor.putDouble(key: String, value: Double) =
        putString(key, value.toString())

    private companion object {
        const val KEY_STATUS = "status"
        const val KEY_TRACKING_ACTIVE = "tracking_active"
        const val KEY_PENDING_COUNT = "pending_count"
        const val KEY_LAST_CAPTURED_AT = "last_captured_at"
        const val KEY_LAST_SENT_AT = "last_sent_at"
        const val KEY_LAST_SENT_LATITUDE = "last_sent_latitude"
        const val KEY_LAST_SENT_LONGITUDE = "last_sent_longitude"
        const val KEY_ERROR = "error"
    }
}