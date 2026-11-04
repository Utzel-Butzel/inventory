package de.internetderdinge.inventory

import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class BrowserSignInTest {
    @Before fun translations() { installLocaleResources() }
    private val state = "s".repeat(43)
    private val code = "c".repeat(43)
    private fun attempt() = BrowserSignIn("https://inventory.example/", state = state, requestId = "r".repeat(43), expiresAt = 2000)
    private fun callback() = "de.polyxo.openinventory://auth/callback?state=$state&code=$code"

    @Test fun pkceMatchesRFC7636() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", attempt().copy(verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge)
        val first = BrowserSignIn("https://a.example/")
        val second = BrowserSignIn("https://a.example/")
        assertTrue(BrowserSignIn.SECRET.matches(first.state))
        assertTrue(BrowserSignIn.SECRET.matches(first.verifier))
        assertNotEquals(first.state, first.verifier)
        assertNotEquals(first.state, second.state)
        assertNotEquals(first.verifier, second.verifier)
    }
    @Test fun callbackRequiresExactDestinationStateAndUnexpiredAttempt() {
        assertEquals(code, attempt().code(callback(), 1000))
        val invalid = listOf(
            callback().replace("de.polyxo.openinventory:", "inventory:"),
            callback().replace("//auth/", "//evil/"), callback().replace("//auth/", "//user@auth/"),
            callback().replace("//auth/", "//auth:123/"), callback().replace("/callback?", "/other?"),
            callback().replace("state=$state", "state=wrong"), callback() + "&state=$state",
            callback() + "&token=secret", callback() + "#fragment", callback().replace("code=$code", "code=short")
        )
        invalid.forEach { assertTrue(it, runCatching { attempt().code(it, 1000) }.isFailure) }
        assertTrue(runCatching { attempt().code(callback(), 2000) }.isFailure)
        assertNull(attempt().code("de.polyxo.openinventory://auth/callback?state=$state&error=access_denied", 1000))
    }
    @Test fun browserURLIsPinnedToSelectedServerAndNeverContainsVerifier() {
        val request = attempt()
        assertEquals("https://inventory.example/api/v1/auth/browser/authorize?request=${request.requestId}", request.authorizationURL())
        assertFalse(request.authorizationURL().contains(request.verifier))
        assertTrue(runCatching { request.copy(requestId = "other&redirect=evil").authorizationURL() }.isFailure)
    }
    private fun account(server: String, user: String, organization: String = "org") =
        Session(server, "token-$server-$user", organization, "principal-$user-$organization", obj(), label = "$user@example.org", userId = user)

    @Test fun multipleDomainsAndUsersKeepIndependentCredentialsAndWorkspace() {
        val a = account("https://a.example/", "first")
        val b = account("https://b.example/", "first", "different-org")
        val c = account("https://a.example/", "second")
        val vault = AccountVault().withSession(a).withSession(b).withSession(c)
        assertEquals(3, vault.accounts.size)
        val switched = vault.withSession(a.copy(organization = "next-org", principal = "new-org-principal"))
        assertEquals(3, switched.accounts.size)
        assertEquals(a.accountId, switched.activeId)
        assertEquals(b.token, switched.accounts[1].token)
        assertEquals("different-org", switched.accounts[1].organization)
        assertNotEquals(a.context, b.context)
        assertNotEquals(a.context, c.context)
        val refreshed = switched.withSession(a.copy(token = "renewed", accountId = "new-id"))
        assertEquals(3, refreshed.accounts.size)
        assertEquals(a.accountId, refreshed.activeId)
        assertEquals("renewed", refreshed.active!!.token)
    }
    @Test fun logoutRemovesOnlySelectedAccount() {
        val a = account("https://a.example/", "first")
        val b = account("https://b.example/", "second")
        val vault = AccountVault().withSession(a).withSession(b).without(b.accountId)
        assertNull(vault.active)
        assertEquals(listOf(a), vault.accounts)
        assertEquals(a.accountId, vault.withSession(a).activeId)
    }
    @Test fun encryptedDocumentPayloadPreservesPendingHandshakeAndLegacySession() {
        val legacy = obj("server" to "https://a.example/", "token" to "legacy-token", "organization" to "org", "principal" to "user", "capabilities" to obj())
        val migrated = AccountVault.from(legacy)
        assertEquals("legacy-token", migrated.active!!.token)
        val pending = migrated.copy(pending = attempt())
        val restored = AccountVault.from(JSONObject(pending.json().toString()))
        assertEquals(pending.activeId, restored.activeId)
        assertEquals(pending.active!!.token, restored.active!!.token)
        assertEquals(pending.pending, restored.pending)
        assertEquals(code, restored.pending!!.code(callback(), 1000))
        assertNull(AccountVault.from(restored.copy(pending = null).json()).pending)
        assertFalse(migrated.active!!.expired)
        assertTrue(migrated.active!!.copy(deviceLogin = true, expiresAt = 1).expired)
    }
    @Test fun discoveryUsesEachServerWithoutSendingExistingCredentials() = runBlocking {
        MockWebServer().use { a -> MockWebServer().use { b ->
            a.enqueue(MockResponse().setBody("""{"passwordEnabled":false,"browserSignIn":true,"providers":[{"id":"supabase","name":"Konglomerat"}]}"""))
            b.enqueue(MockResponse().setBody("""{"passwordEnabled":true,"browserSignIn":false,"providers":[]}"""))
            val configured = AuthOptions.from(Api(Session(a.url("/").toString(), "", "", "", obj())).call("auth/options"))
            val other = AuthOptions.from(Api(Session(b.url("/").toString(), "", "", "", obj())).call("auth/options"))
            assertEquals(listOf("supabase" to "Konglomerat"), configured.providers)
            assertFalse(configured.passwordEnabled)
            assertTrue(configured.browserSignIn)
            assertFalse(other.browserSignIn)
            assertTrue(other.providers.isEmpty())
            for (request in listOf(a.takeRequest(), b.takeRequest())) {
                assertEquals("/api/v1/auth/options", request.path)
                assertNull(request.getHeader("Authorization"))
                assertNull(request.getHeader("X-Organization-ID"))
                assertNull(request.getHeader("Cookie"))
            }
        } }
    }
}
