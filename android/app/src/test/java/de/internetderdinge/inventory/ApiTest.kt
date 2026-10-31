package de.internetderdinge.inventory

import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class ApiTest {
    @Test fun serverAddressesRejectCredentialLeaksAndPublicHttp() {
        listOf("http://inventory.example", "https://user:password@inventory.example", "https://inventory.example/api/v1", "https://inventory.example/?token=secret", "https://inventory.example/#fragment").forEach { value ->
            assertTrue(value, runCatching { Api.normalizeServer(value) }.isFailure)
        }
        assertEquals("https://inventory.example/", Api.normalizeServer(" HTTPS://INVENTORY.EXAMPLE:443 "))
        assertEquals("http://localhost:3000/", Api.normalizeServer("http://localhost:3000"))
        assertTrue(runCatching { Api.normalizeServer("http://localhost.evil.example") }.isFailure)
    }
    @Test fun contextIncludesServerOrganizationAndAccount() {
        val s = Session("https://example.org/", "secret", "org-a", "user-a", obj())
        assertNotEquals(s.context, s.copy(organization = "org-b").context)
        assertNotEquals(s.context, s.copy(principal = "user-b").context)
        assertNotEquals(s.context, s.copy(server = "https://other.example/").context)
        assertEquals(s.context, s.copy(token = "renewed").context)
    }
    @Test fun granularPermissionsNeverFallBackToBroadScopes() {
        val base = Session("https://example.org", "secret", "org", "user", obj("scopes" to JSONArray(listOf("read", "write", "ai")), "permissions" to JSONArray(listOf("inventory.read"))))
        assertTrue(base.allows("inventory.read")); assertFalse(base.allows("stock.manage", "write"))
        assertFalse(base.copy(capabilities = obj("scopes" to JSONArray(listOf("write")), "organization" to obj("isReadOnly" to true))).allows("stock.manage", "write"))
        assertFalse(base.copy(capabilities = obj("scopes" to JSONArray(listOf("write")), "permissions" to JSONArray())).allows("inventory.update", "write"))
    }
    @Test fun lookupEscapesCodesAndPinsAuthorization() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"resource\":{\"id\":\"sample\"}}"))
            val api = Api(Session(server.url("/").toString(), "device-token", "org-a", "user", obj()))
            api.call("resources/lookup", query = mapOf("code" to "SKU&other=value/#"))
            val request = server.takeRequest()
            assertEquals("SKU&other=value/#", request.requestUrl!!.queryParameter("code"))
            assertEquals(1, request.requestUrl!!.querySize)
            assertEquals("Bearer device-token", request.getHeader("Authorization"))
            assertEquals("org-a", request.getHeader("X-Organization-ID"))
            assertTrue(runCatching { api.request(server.url("/").newBuilder().host("evil.example").build()) }.isFailure)
        }
    }
    @Test fun redirectsAreNotFollowedAndKeysSurviveRetry() = runBlocking {
        MockWebServer().use { server ->
            val api = Api(Session(server.url("/").toString(), "token", "org", "user", obj()))
            val body = obj("delta" to -1, "type" to "issue")
            server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "7").setBody("{\"error\":\"Busy\"}"))
            val failure = runCatching { api.call("resources/id/stock/movements", "POST", body, "stable-key") }.exceptionOrNull() as ApiError
            assertTrue(failure.retryable); assertEquals(7L, failure.retryAfter)
            server.enqueue(MockResponse().setBody("{}"))
            api.call("resources/id/stock/movements", "POST", body, "stable-key")
            val first = server.takeRequest(); val second = server.takeRequest()
            assertEquals(first.body.readUtf8(), second.body.readUtf8()); assertEquals(first.getHeader("Idempotency-Key"), second.getHeader("Idempotency-Key"))
            server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "https://evil.example/steal"))
            assertEquals(307, (runCatching { api.call("resources") }.exceptionOrNull() as ApiError).status)
        }
    }
    @Test fun processingResponseIsNotTreatedAsCompletion() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202).setBody("{\"status\":\"processing\"}"))
            val api = Api(Session(server.url("/").toString(), "token", "org", "user", obj()))
            assertEquals(202, (runCatching { api.call("resources/id/analyze", "POST", obj(), "key") }.exceptionOrNull() as ApiError).status)
        }
    }
}
