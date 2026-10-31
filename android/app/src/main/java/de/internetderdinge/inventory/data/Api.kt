package de.internetderdinge.inventory.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiError(val status: Int, message: String, val retryAfter: Long = 3, val retrySuggested: Boolean = false) : IOException(message) {
    val retryable get() = status in listOf(202, 408, 425, 429, 500, 502, 503, 504) || (status == 409 && retrySuggested)
}
data class ApiReply(val json: JSONObject, val status: Int, val retryAfter: Long)
data class Upload(val file: File, val name: String = file.name, val mime: String = "image/jpeg")

class Api(val session: Session, val http: OkHttpClient = client) {
    val root = normalizeServer(session.server).toHttpUrl()
    fun url(path: String, query: Map<String, String> = emptyMap()): HttpUrl = root.newBuilder()
        .addPathSegments("api/v1/${path.trim('/')}").apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    fun resourceLink(id: String): String = root.newBuilder().apply {
        session.capabilities.o("organization").s("slug").takeIf { it.isNotBlank() }?.let { addPathSegment(it) }
        addPathSegment("inventory"); addPathSegment(id)
    }.build().toString()

    fun request(url: HttpUrl): Request.Builder {
        require(sameOrigin(root, url)) { "Zugriff auf fremden Server blockiert." }
        return Request.Builder().url(url).header("Accept", "application/json").apply {
            if (session.token.isNotEmpty()) header("Authorization", "Bearer ${session.token}")
            if (session.organization.isNotEmpty()) header("X-Organization-ID", session.organization)
        }
    }
    suspend fun call(path: String, method: String = "GET", body: JSONObject? = null, key: String? = null, query: Map<String, String> = emptyMap()): JSONObject {
        val reply = raw(path, method, body, key, query)
        if (reply.status == 202) throw ApiError(202, "Wird auf dem Server verarbeitet. Erneut versuchen.", reply.retryAfter)
        return reply.json
    }
    suspend fun raw(path: String, method: String = "GET", body: JSONObject? = null, key: String? = null, query: Map<String, String> = emptyMap()): ApiReply {
        val data = if (method in listOf("GET", "HEAD")) null else (body?.toString() ?: "{}").toRequestBody("application/json".toMediaType())
        val req = request(url(path, query)).method(method, data).apply { key?.let { header("Idempotency-Key", it) } }.build()
        return execute(req)
    }
    suspend fun runtimeSettings(): JSONObject = execute(request(root.newBuilder().addPathSegments("api/settings/status").build()).get().build()).json
    suspend fun multipart(path: String, files: List<Upload>, key: String, field: String = "files", fields: Map<String, String> = emptyMap()): ApiReply {
        require(files.isNotEmpty() && files.size <= 12) { "Bitte 1 bis 12 Dateien wählen." }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (k, v) -> addFormDataPart(k, v) }
            files.forEach { require(it.file.isFile && it.file.length() > 0); addFormDataPart(field, it.name, it.file.asRequestBody(it.mime.toMediaType())) }
        }.build()
        return execute(request(url(path)).header("Idempotency-Key", key).post(body).build())
    }
    private suspend fun execute(request: Request): ApiReply = withContext(Dispatchers.IO) {
        http.newCall(request).await().use { response ->
            val text = response.body?.string().orEmpty()
            val json = if (text.isBlank()) JSONObject() else runCatching { JSONObject(text) }.getOrElse { throw ApiError(response.code, "Ungültige Serverantwort (${response.code}).") }
            val retry = response.header("Retry-After")?.toLongOrNull() ?: 3L
            if (!response.isSuccessful) throw ApiError(response.code, json.s("error", "Serverfehler ${response.code}"), retry, response.header("Retry-After") != null)
            ApiReply(json, response.code, retry)
        }
    }
    suspend fun bytes(value: String): ByteArray = withContext(Dispatchers.IO) {
        val url = root.resolve(value) ?: error("Ungültige Medienadresse")
        require(url.isHttps || sameOrigin(root, url)) { "Externe Medien müssen HTTPS verwenden." }
        val request = if (sameOrigin(root, url)) request(url).build() else Request.Builder().url(url).build()
        http.newCall(request).await().use {
            if (!it.isSuccessful) throw ApiError(it.code, "Datei konnte nicht geladen werden.")
            require((it.body?.contentLength() ?: 0) <= 50 * 1024 * 1024) { "Datei ist zu groß." }
            val body = it.body ?: error("Leere Datei")
            val output = java.io.ByteArrayOutputStream()
            body.byteStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= 50 * 1024 * 1024) { "Datei ist zu groß." }; output.write(buffer, 0, count) }
            }
            output.toByteArray()
        }
    }
    companion object {
        val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(20, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).callTimeout(240, TimeUnit.SECONDS).build()
        fun normalizeServer(value: String): String {
            val url = value.trim().toHttpUrl()
            require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null && url.encodedPath.trim('/').isEmpty()) { "Bitte die Serveradresse ohne Pfad, Passwort oder Parameter eingeben." }
            val local = url.host in setOf("localhost", "127.0.0.1", "::1", "10.0.2.2") || url.host.endsWith(".local")
            require(url.isHttps || local) { "Der Server muss HTTPS verwenden." }
            return url.toString()
        }
        fun sameOrigin(a: HttpUrl, b: HttpUrl) = a.scheme == b.scheme && a.host == b.host && a.port == b.port
    }
}
private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { continuation.resume(response) { _, r, _ -> r.close() } }
    })
}
