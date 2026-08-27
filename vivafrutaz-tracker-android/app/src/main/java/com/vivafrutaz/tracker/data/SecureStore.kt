package com.vivafrutaz.tracker.data

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

class SecureStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "vivafrutaz_tracker_secure",
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun baseUrl(): String = preferences.getString(KEY_BASE_URL, "") ?: ""

    fun saveBaseUrl(value: String) {
        preferences.edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()
    }

    fun deviceId(): String {
        val existing = preferences.getString(KEY_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) return existing
        val generated = UUID.randomUUID().toString().replace("-", "")
        preferences.edit().putString(KEY_DEVICE_ID, generated).apply()
        return generated
    }

    fun saveSessionCookie(value: String) {
        preferences.edit().putString(KEY_SESSION_COOKIE, value).apply()
    }

    fun sessionCookie(): String? = preferences.getString(KEY_SESSION_COOKIE, null)

    fun hasSession(): Boolean = !sessionCookie().isNullOrBlank()

    fun clearSession() {
        preferences.edit().remove(KEY_SESSION_COOKIE).apply()
    }

    fun encode(value: String): String =
        Base64.encodeToString(value.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)

    fun decode(value: String): String =
        String(Base64.decode(value, Base64.NO_WRAP), Charsets.UTF_8)

    private companion object {
        const val KEY_BASE_URL = "base_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_SESSION_COOKIE = "session_cookie"
    }
}