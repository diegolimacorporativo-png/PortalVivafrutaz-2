package com.vivafrutaz.tracker.network

import android.content.Context
import com.vivafrutaz.tracker.data.SecureStore
import com.vivafrutaz.tracker.data.SessionCookieJar
import com.vivafrutaz.tracker.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

sealed interface ApiFailure { val message: String; val retryable: Boolean; data class Http(val status: Int, override val message: String, override val retryable: Boolean) : ApiFailure; data class Network(override val message: String) : ApiFailure { override val retryable = true } }
sealed interface LoginResult { data class Success(val session: DriverSession) : LoginResult; data class Failure(val error: ApiFailure) : LoginResult }
sealed interface SessionResult { data class Success(val session: DriverSession) : SessionResult; data class Failure(val error: ApiFailure) : SessionResult }
sealed interface GpsSendResult { data object Success : GpsSendResult; data class Failure(val error: ApiFailure) : GpsSendResult }
sealed interface RouteResult { data class Success(val route: DriverRoute) : RouteResult; data class Failure(val error: ApiFailure) : RouteResult }
sealed interface ChecklistResult { data class Success(val checklist: DeliveryChecklist?) : ChecklistResult; data class Failure(val error: ApiFailure) : ChecklistResult }
sealed interface StopStatusSendResult { data class Success(val result: StopStatusResult) : StopStatusSendResult; data class Failure(val error: ApiFailure) : StopStatusSendResult }

class TrackerApi(context: Context) {
    private val store = SecureStore(context)
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder().cookieJar(SessionCookieJar(store)).connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS).addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Device-Id", store.deviceId()).build()) }.build()
    fun secureStore() = store
    suspend fun login(email: String, password: String): LoginResult = withContext(Dispatchers.IO) { try { val r = execute("/api/driver/auth/login", "POST", JSONObject().put("email", email.trim().lowercase()).put("password", password).put("deviceId", store.deviceId()).toString()); if (!r.isSuccessful) return@withContext LoginResult.Failure(r.failure()); val u = JSONObject(r.body).optJSONObject("user") ?: return@withContext LoginResult.Failure(ApiFailure.Http(502, "Resposta de login inválida.", false)); LoginResult.Success(session(u, email)) } catch (_: Exception) { LoginResult.Failure(ApiFailure.Network("Não foi possível conectar ao servidor.")) } }
    suspend fun me(): SessionResult = withContext(Dispatchers.IO) { try { val r = execute("/api/auth/me", "GET", null); if (!r.isSuccessful) return@withContext SessionResult.Failure(r.failure()); val u = JSONObject(r.body).optJSONObject("user") ?: return@withContext SessionResult.Failure(ApiFailure.Http(502, "Resposta de sessão inválida.", false)); SessionResult.Success(session(u, "Motorista")) } catch (_: Exception) { SessionResult.Failure(ApiFailure.Network("Não foi possível validar a sessão.")) } }
    suspend fun logout() = withContext(Dispatchers.IO) { try { execute("/api/auth/logout", "POST", null) } catch (_: Exception) {} finally { store.clearSession() } }
    suspend fun getRouteToday(): RouteResult = withContext(Dispatchers.IO) { try { val r = execute("/api/driver/route-today", "GET", null); if (!r.isSuccessful) return@withContext RouteResult.Failure(r.failure()); val root = JSONObject(r.body); val a = root.optJSONArray("deliveries") ?: JSONArray(); val items = mutableListOf<DriverDelivery>(); for (i in 0 until a.length()) { val d = a.optJSONObject(i) ?: continue; val street = d.optStringOrNull("addressStreet").orEmpty(); val city = d.optStringOrNull("addressCity").orEmpty(); val start = d.optStringOrNull("deliveryWindowStart"); val end = d.optStringOrNull("deliveryWindowEnd"); items += DriverDelivery(d.optLong("id"), d.optString("companyName", "Cliente"), street, city, d.optString("status", "pendente"), d.optInt("routePosition").takeIf { d.has("routePosition") }, if (start != null && end != null) "$start–$end" else start ?: end, d.optStringOrNull("notes"), d.optNullableDouble("latitude"), d.optNullableDouble("longitude")) }; RouteResult.Success(DriverRoute(root.optString("date"), items, root.optJSONObject("driver")?.optStringOrNull("name"))) } catch (_: Exception) { RouteResult.Failure(ApiFailure.Network("Não foi possível carregar a rota.")) } }
    suspend fun getChecklist(id: Long): ChecklistResult = withContext(Dispatchers.IO) { try { val r = execute("/api/deliveries/$id/checklist", "GET", null); if (!r.isSuccessful) return@withContext ChecklistResult.Failure(r.failure()); if (r.body.isBlank() || r.body == "null") return@withContext ChecklistResult.Success(null); ChecklistResult.Success(checklist(JSONObject(r.body))) } catch (_: Exception) { ChecklistResult.Failure(ApiFailure.Network("Não foi possível carregar o checklist.")) } }
    suspend fun confirmChecklist(id: Long, observation: String): ChecklistResult = withContext(Dispatchers.IO) { try { val r = execute("/api/deliveries/$id/checklist", "POST", JSONObject().put("entregaConfirmada", true).putNullable("observacao", observation.trim().ifBlank { null }).toString()); if (!r.isSuccessful) return@withContext ChecklistResult.Failure(r.failure()); val c = JSONObject(r.body).optJSONObject("checklist") ?: return@withContext ChecklistResult.Success(null); ChecklistResult.Success(checklist(c)) } catch (_: Exception) { ChecklistResult.Failure(ApiFailure.Network("Não foi possível confirmar a entrega.")) } }
    suspend fun updateStopStatus(id: Long, status: String, observation: String): StopStatusSendResult = withContext(Dispatchers.IO) { try { val r = execute("/api/deliveries/$id/stop-status", "POST", JSONObject().put("status", status).putNullable("observacao", observation.trim().ifBlank { null }).toString()); if (!r.isSuccessful) return@withContext StopStatusSendResult.Failure(r.failure()); val o = JSONObject(r.body); StopStatusSendResult.Success(StopStatusResult(o.optString("status", status), o.optStringOrNull("registeredAt"))) } catch (_: Exception) { StopStatusSendResult.Failure(ApiFailure.Network("Não foi possível atualizar a parada.")) } }
    suspend fun sendGps(p: GpsPayload): GpsSendResult = withContext(Dispatchers.IO) { try { val r = execute("/api/driver/gps", "POST", JSONObject().put("latitude", p.latitude).put("longitude", p.longitude).putNullable("accuracy", p.accuracy).putNullable("speed", p.speed).putNullable("heading", p.heading).toString()); if (r.isSuccessful) GpsSendResult.Success else GpsSendResult.Failure(r.failure()) } catch (_: Exception) { GpsSendResult.Failure(ApiFailure.Network("Falha de conexão ao enviar GPS.")) } }
    private fun session(u: JSONObject, fallback: String) = DriverSession(u.optLong("id"), u.optString("name", fallback), u.optString("role", ""))
    private fun checklist(o: JSONObject) = DeliveryChecklist(o.optLongOrNull("id"), o.optBoolean("entregaConfirmada"), o.optStringOrNull("observacao"), o.optStringOrNull("assinaturaUrl"), o.optStringOrNull("fotoUrl"))
    private fun execute(path: String, method: String, json: String?): RawResponse { val base = store.baseUrl().trimEnd('/'); require(base.startsWith("http://") || base.startsWith("https://")); val b = Request.Builder().url("$base$path"); if (method == "POST") b.post((json ?: "{}").toRequestBody(jsonType)) else b.get(); client.newCall(b.build()).execute().use { return RawResponse(it.code, it.body?.string().orEmpty()) } }
    private fun RawResponse.failure(): ApiFailure { val msg = runCatching { JSONObject(body).optString("message") }.getOrNull().orEmpty().ifBlank { "Servidor respondeu HTTP $status." }; return ApiFailure.Http(status, msg, status >= 500 || status == 408 || status == 429) }
    private data class RawResponse(val status: Int, val body: String) { val isSuccessful get() = status in 200..299 }
}
private fun JSONObject.putNullable(k: String, v: Any?) = if (v == null) put(k, JSONObject.NULL) else put(k, v)
private fun JSONObject.optStringOrNull(k: String): String? = optString(k, "").takeIf { it.isNotBlank() }
private fun JSONObject.optLongOrNull(k: String): Long? = if (has(k) && !isNull(k)) optLong(k) else null
private fun JSONObject.optNullableDouble(k: String): Double? = if (has(k) && !isNull(k)) optDouble(k) else null
