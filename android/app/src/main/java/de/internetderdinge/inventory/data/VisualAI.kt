package de.internetderdinge.inventory.data

import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.IOException
import java.time.Instant

object VisualAI {
    suspend fun recognize(api: Api, image: Upload, key: String): JSONObject {
        val deadline = System.currentTimeMillis() + 150_000
        while (true) {
            val response = api.multipart("ai/recognize", listOf(image), key, "image")
            if (response.status != 202) return response.json
            check(System.currentTimeMillis() < deadline) { "Die Erkennung dauert zu lange. Bitte erneut versuchen." }
            delay(response.retryAfter.coerceIn(1, 5) * 1000)
        }
    }
    suspend fun count(api: Api, image: Upload, key: String, hint: String, itemId: String?, modelId: String?): JSONObject {
        require(hint.length <= 240)
        val fields = buildMap { if (hint.isNotBlank()) put("itemHint", hint); itemId?.let { put("itemId", it) }; modelId?.takeIf { it.isNotBlank() }?.let { put("modelId", it) } }
        var reply: ApiReply
        val startDeadline = System.currentTimeMillis() + 5000
        while (true) {
            try { reply = api.multipart("ai/count", listOf(image), key, "image", fields); break }
            catch (e: ApiError) { if (e.status != 409 || System.currentTimeMillis() > startDeadline) throw e; delay(e.retryAfter.coerceIn(1, 5) * 1000) }
        }
        var deadline = System.currentTimeMillis() + 11 * 60_000
        while (reply.status == 202) {
            val job = reply.json
            require(job.s("status") == "processing" && job.s("jobToken").isNotBlank()) { "Ungültiger Zählauftrag." }
            deadline = minOf(deadline, Instant.parse(job.getString("expiresAt")).toEpochMilli() + 10_000)
            check(System.currentTimeMillis() < deadline) { "Die Zählung ist abgelaufen." }
            delay(reply.retryAfter.coerceIn(1, 10) * 1000)
            try { reply = api.raw("ai/count/jobs", "POST", obj("jobToken" to job.getString("jobToken"))) }
            catch (e: IOException) { if (e is ApiError && !e.retryable) throw e }
        }
        return reply.json
    }
}
