package com.vivafrutaz.tracker.network

import android.content.Context
import com.vivafrutaz.tracker.data.SecureStore
import com.vivafrutaz.tracker.data.SessionCookieJar
import com.vivafrutaz.tracker.model.DriverSession
import com.vivafrutaz.tracker.model.GpsPayload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

sealed interface ApiFailure {
    val message: String
    val retryable: Boolean

    data class Http(
        val status: Int,
        override val message: String,
        override val retryable: Boolean,
    ) : ApiFailure

    data class Network(override val message: String) : ApiFailure {
        override val retryable: Boolean = true
    }
}

sealed interface LoginResult {
    data class Success(val session: DriverSession) : LoginResult
    data class Failure(val error: ApiFailure) : LoginResult
}

sealed interface SessionResult {
    data class Success(val session: DriverSession) : SessionResult
    data class Failure(val error: ApiFailure) : SessionResult
}

sealed interface GpsSendResult {
    data object Success : GpsSendResult
    data class Failure(val error: ApiFailure) : GpsSendResult
}

class TrackerApi(context: Context) {
    private val store = SecureStore(context)
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .cookieJar(SessionCookieJar(store))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
                .header("X-Device-Id", store.deviceId())
                .build()
            chain.proceed(request)
        }
        .build()

    fun secureStore(): SecureStore = store

    suspend fun login(email: String, password: String): LoginResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("email", email.trim().lowercase())
            .put("password", password)
            .put("type", "admin")
            .put("deviceId", store.deviceId())
            .toString()

        try {
            val response = execute("/api/auth/login", "POST", body)
            if (!response.isSuccessful) {
                return@withContext LoginResult.Failure(response.failure())
            }
            val user = JSONObject(response.body).optJSONObject("user")
                ?: return@withContext LoginResult.Failure(
                    ApiFailure.Http(502, "Resposta de login inválida.", false),
                )
            LoginResult.Success(
                DriverSession(
                    userId = user.optLong("id", 0),
                    name = user.optString("name", email),
                    role = user.optString("role", ""),
                ),
            )
        } catch (error: Exception) {
            LoginResult.Failure(ApiFailure.Network("Não foi possível conectar ao servidor."))
        }
    }

    suspend fun me(): SessionResult = withContext(Dispatchers.IO) {
        try {
            val response = execute("/api/auth/me", "GET", null)
            if (!response.isSuccessful) return@withContext SessionResult.Failure(response.failure())
            val user = JSONObject(response.body).optJSONObject("user")
                ?: return@withContext SessionResult.Failure(
                    ApiFailure.Http(502, "Resposta de sessão inválida.", false),
                )
            SessionResult.Success(
                DriverSession(
                    userId = user.optLong("id", 0),
                    name = user.optString("name", "Motorista"),
                    role = user.optString("role", ""),
                ),
            )
        } catch (error: Exception) {
            SessionResult.Failure(ApiFailure.Network("Não foi possível validar a sessão."))
        }
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        try {
            execute("/api/auth/logout", "POST", null)
        } catch (_: Exception) {
            // Local credentials are cleared by the caller even if the network is offline.
        } finally {
            store.clearSession()
        }
    }

    suspend fun sendGps(payload: GpsPayload): GpsSendResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("latitude", payload.latitude)
            .put("longitude", payload.longitude)
            .putNullable("accuracy", payload.accuracy)
            .putNullable("speed", payload.speed)
            .putNullable("heading", payload.heading)
            .toString()

        try {
            val response = execute("/api/driver/gps", "POST", body)
            if (response.isSuccessful) {
                GpsSendResult.Success
            } else {
                GpsSendResult.Failure(response.failure())
            }
        } catch (_: Exception) {
            GpsSendResult.Failure(ApiFailure.Network("Falha de conexão ao enviar GPS."))
        }
    }

    private fun execute(path: String, method: String, json: String?): RawResponse {
        val baseUrl = store.baseUrl().trimEnd('/')
        require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
            "URL do servidor não configurada"
        }
        val requestBuilder = Request.Builder().url("$baseUrl$path")
        if (method == "POST") {
            requestBuilder.post((json ?: "{}").toRequestBody(jsonType))
        } else {
            requestBuilder.get()
        }
        client.newCall(requestBuilder.build()).execute().use { response ->
            return RawResponse(
                status = response.code,
                body = response.body?.string().orEmpty(),
            )
        }
    }

    private fun RawResponse.failure(): ApiFailure {
        val message = runCatching { JSONObject(body).optString("message") }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?: "Servidor respondeu HTTP $status."
        return ApiFailure.Http(
            status = status,
            message = message,
            retryable = status >= 500 || status == 408 || status == 429,
        )
    }

    private data class RawResponse(val status: Int, val body: String) {
        val isSuccessful: Boolean get() = status in 200..299
    }

    private fun JSONObject.putNullable(key: String, value: Double?): JSONObject =
        if (value == null) put(key, JSONObject.NULL) else put(key, value)
}