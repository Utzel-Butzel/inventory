package de.internetderdinge.inventory

import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import de.internetderdinge.inventory.data.*
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativeAccountSessionTest {
    private lateinit var app: InventoryApplication
    private lateinit var model: AppModel
    private val models = ViewModelStore()
    private val servers = mutableListOf<MockWebServer>()
    private val requests = CopyOnWriteArrayList<RecordedRequest>()
    private fun main(action: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(action)
    @Before fun setup() { app = ApplicationProvider.getApplicationContext(); app.credentials.clear() }
    @After fun teardown() {
        main { models.clear() }
        app.credentials.clear()
        servers.forEach { it.shutdown() }
    }
    private fun launch() = main { model = AppModel(app); models.put("model", model) }
    private fun waitFor(predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            var ready = false
            main { ready = predicate() }
            if (ready) return
            Thread.sleep(20)
        }
        fail("Timed out waiting for session state")
    }
    private fun server(): MockWebServer = MockWebServer().also { server ->
        servers += server
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val organizations = JSONArray(listOf(obj("id" to "org-a", "name" to "A"), obj("id" to "org-b", "name" to "B")))
                val organization = request.getHeader("X-Organization-ID") ?: "org-a"
                val json = when (request.requestUrl!!.encodedPath) {
                    "/api/v1/auth/options" -> obj("passwordEnabled" to false, "browserSignIn" to true, "providers" to JSONArray(listOf(obj("id" to "supabase", "name" to "Konglomerat"))))
                    "/api/v1/auth/browser/start" -> obj("requestId" to "r".repeat(43), "expiresAt" to Instant.now().plusSeconds(600).toString())
                    "/api/v1/auth/browser/exchange" -> obj("token" to "new-device-token", "user" to obj("id" to "new-user", "email" to "new@example.org"), "expiresAt" to Instant.now().plusSeconds(3600).toString())
                    "/api/v1/organizations" -> obj("organizations" to organizations, "activeOrganizationId" to "org-a")
                    "/api/v1/organizations/select" -> obj("organization" to obj("id" to org.json.JSONObject(request.body.clone().readUtf8()).getString("organizationId")))
                    "/api/v1/auth/capabilities" -> obj("principal" to "${request.getHeader("Authorization")}-$organization", "scopes" to JSONArray(listOf("read")), "organization" to obj("id" to organization))
                    else -> obj()
                }
                return MockResponse().setBody(json.toString())
            }
        }
    }
    private fun account(server: MockWebServer, token: String) = Session(server.url("/").toString(), token, "org-a", "", obj())

    @Test fun restoringWaitsForValidationAndKeepsCredentialOnNetworkFailure() {
        val server = server()
        val original = app.credentials.write(account(server, "saved-token"))
        val dispatcher = server.dispatcher
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(503).setBody("{\"error\":\"Offline\"}").setBodyDelay(350, TimeUnit.MILLISECONDS)
        }
        launch()
        main { assertTrue(model.loading); assertNull(model.session) }
        waitFor { !model.loading }
        main { assertNotNull(model.recoveryError); assertNull(model.session) }
        assertEquals(original.token, app.credentials.read()!!.token)
        server.dispatcher = dispatcher
        main { model.restoreSession() }
        waitFor { !model.loading }
        main { assertNull(model.recoveryError); assertEquals(original.token, model.session!!.token) }
    }
    @Test fun switchingDomainsAndOrganizationsRetainsOtherAccountsAndLogoutIsLocal() {
        val a = server(); val b = server()
        val first = app.credentials.write(account(a, "first-token"))
        val second = app.credentials.write(account(b, "second-token"))
        launch(); waitFor { !model.loading }
        main { assertEquals(second.token, model.session!!.token); model.switchAccount(first.accountId, "org-b") }
        waitFor { !model.busy }
        main { assertEquals(first.token, model.session!!.token); assertEquals("org-b", model.session!!.organization) }
        assertEquals("org-a", app.credentials.readVault().accounts.first { it.accountId == second.accountId }.organization)
        main { model.logout() }; waitFor { !model.busy }
        assertNull(app.credentials.read())
        assertEquals(second.token, app.credentials.readVault().accounts.single().token)
        main { model.switchAccount(second.accountId) }; waitFor { !model.busy }
        main { assertEquals(second.token, model.session!!.token) }
        assertTrue(requests.none { it.path?.contains("auth/login") == true })
    }
    @Test fun browserCallbackUsesPersistedAttemptServerAndPreservesOldAccount() {
        val oldServer = server(); val ssoServer = server()
        val original = app.credentials.write(account(oldServer, "old-token"))
        val attempt = BrowserSignIn(ssoServer.url("/").toString(), requestId = "r".repeat(43), expiresAt = System.currentTimeMillis() + 60_000)
        app.credentials.savePending(attempt)
        launch(); waitFor { !model.loading }
        main { model.handleBrowserCallback("de.polyxo.openinventory://auth/callback?state=wrong&code=${"c".repeat(43)}") }
        waitFor { !model.busy }
        assertEquals(attempt, app.credentials.readVault().pending)
        assertEquals(original.token, app.credentials.read()!!.token)
        assertTrue(requests.none { it.path?.contains("exchange") == true })
        main { model.handleBrowserCallback("de.polyxo.openinventory://auth/callback?state=${attempt.state}&code=${"c".repeat(43)}") }
        waitFor { !model.busy }
        val active = app.credentials.read()!!
        assertEquals("new-device-token", active.token)
        assertEquals(ssoServer.url("/").toString(), active.server)
        assertEquals(2, app.credentials.readVault().accounts.size)
        assertNull(app.credentials.readVault().pending)
        val exchange = requests.single { it.path?.contains("exchange") == true }
        assertEquals(ssoServer.port, exchange.requestUrl!!.port)
        assertNull(exchange.getHeader("Authorization"))
        assertEquals(attempt.verifier, org.json.JSONObject(exchange.body.clone().readUtf8()).getString("codeVerifier"))
        main { model.handleBrowserCallback("de.polyxo.openinventory://auth/callback?state=${attempt.state}&code=${"c".repeat(43)}") }
        waitFor { !model.busy }
        assertEquals(1, requests.count { it.path?.contains("exchange") == true })
    }
    @Test fun browserCancellationDoesNotRemoveActiveLogin() {
        val server = server()
        val original = app.credentials.write(account(server, "old-token"))
        launch(); waitFor { !model.loading }
        var url = ""
        main { model.startBrowserSignIn(server.url("/").toString()) { url = it } }
        waitFor { !model.busy }
        assertTrue(url.startsWith(server.url("/api/v1/auth/browser/authorize").toString()))
        val pending = app.credentials.readVault().pending!!
        main { model.handleBrowserCallback("de.polyxo.openinventory://auth/callback?state=${pending.state}&error=access_denied") }
        waitFor { !model.busy }
        assertEquals(original.token, app.credentials.read()!!.token)
        assertNull(app.credentials.readVault().pending)
        assertTrue(requests.none { it.path?.contains("exchange") == true })
    }
}
