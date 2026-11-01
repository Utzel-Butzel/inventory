package de.internetderdinge.inventory

import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.Instant

class VisualAITest {
    @Test fun countPollsTheSignedJobInsteadOfStartingAnotherPaidPrediction() = runBlocking {
        MockWebServer().use { server ->
            val photo = File.createTempFile("inventory-count", ".jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
            try {
                val pending = obj("status" to "processing", "jobToken" to "signed-prediction", "expiresAt" to Instant.now().plusSeconds(60).toString())
                server.enqueue(MockResponse().setResponseCode(202).setHeader("Retry-After", "1").setBody(pending.toString()))
                server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "1").setBody("{\"error\":\"warming up\"}"))
                server.enqueue(MockResponse().setBody("{\"count\":7,\"confidence\":0.9,\"markers\":[]}"))
                val api = Api(Session(server.url("/").toString(), "token", "org", "user", obj()))
                assertEquals(7, VisualAI.count(api, Upload(photo), "count-key", "Schrauben", "item-id", null).getInt("count"))
                val start = server.takeRequest(); assertEquals("/api/v1/ai/count", start.path); assertEquals("count-key", start.getHeader("Idempotency-Key"))
                repeat(2) { val poll = server.takeRequest(); assertEquals("/api/v1/ai/count/jobs", poll.path); assertEquals("signed-prediction", JSONObject(poll.body.readUtf8()).getString("jobToken")) }
            } finally { photo.delete() }
        }
    }
    @Test fun expiredCountJobsStopLocally() = runBlocking {
        MockWebServer().use { server ->
            val photo = File.createTempFile("inventory-expired", ".jpg").apply { writeText("image") }
            try {
                server.enqueue(MockResponse().setResponseCode(202).setBody(obj("status" to "processing", "jobToken" to "old", "expiresAt" to Instant.now().minusSeconds(60).toString()).toString()))
                val api = Api(Session(server.url("/").toString(), "token", "org", "user", obj()))
                assertTrue(runCatching { VisualAI.count(api, Upload(photo), "key", "", null, null) }.isFailure)
                assertEquals(1, server.requestCount)
            } finally { photo.delete() }
        }
    }
}
