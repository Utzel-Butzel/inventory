package de.internetderdinge.inventory.data

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/** All provider names come from the selected deployment; no global SSO provider. */
data class AuthOptions(val passwordEnabled: Boolean, val browserSignIn: Boolean, val providers: List<Pair<String, String>>) {
    companion object {
        fun from(json: JSONObject) = AuthOptions(json.getBoolean("passwordEnabled"), json.getBoolean("browserSignIn"),
            json.getJSONArray("providers").objects().map { it.getString("id") to it.getString("name") })
    }
}

data class BrowserSignIn(val server: String, val verifier: String = secret(), val state: String = secret(), val requestId: String = "", val expiresAt: Long = 0) {
    val challenge: String get() = encode(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
    fun authorizationURL(): String {
        require(SECRET.matches(requestId))
        return Api.normalizeServer(server) + "api/v1/auth/browser/authorize?request=$requestId"
    }
    fun code(callback: String, now: Long = System.currentTimeMillis()): String? {
        require(now < expiresAt) { "Expired browser sign-in" }
        val url = URI(callback)
        require(url.scheme == SCHEME && url.host == "auth" && url.path == "/callback" && url.userInfo == null && url.port == -1 && url.fragment == null)
        val pairs = url.rawQuery.orEmpty().split('&').map {
            val parts = it.split('=', limit = 2)
            URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
        }
        require(pairs.size == 2 && pairs.map { it.first }.toSet().size == 2)
        val values = pairs.toMap()
        require(values["state"] == state) { "Mismatched sign-in state" }
        if (values["error"] == "access_denied") return null
        return values["code"]?.also { require(SECRET.matches(it)) } ?: error("Invalid sign-in response")
    }
    fun json() = obj("server" to server, "verifier" to verifier, "state" to state, "requestId" to requestId, "expiresAt" to expiresAt)
    companion object {
        const val SCHEME = "de.polyxo.openinventory"
        val SECRET = Regex("^[A-Za-z0-9_-]{43}$")
        private fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        private fun secret(): String = encode(ByteArray(32).also { SecureRandom().nextBytes(it) })
        fun from(json: JSONObject) = BrowserSignIn(json.getString("server"), json.getString("verifier"), json.getString("state"), json.getString("requestId"), json.getLong("expiresAt"))
    }
}

/** One encrypted, atomic document binds every credential to its own domain/account. */
data class AccountVault(val accounts: List<Session> = emptyList(), val activeId: String? = null, val pending: BrowserSignIn? = null) {
    val active: Session? get() = accounts.firstOrNull { it.accountId == activeId }
    fun withSession(candidate: Session): AccountVault {
        val existing = accounts.firstOrNull { it.server == candidate.server &&
            (it.token == candidate.token || (candidate.userId.isNotEmpty() && it.userId == candidate.userId) ||
                (candidate.principal.isNotEmpty() && candidate.principal == it.principal)) }
        val next = candidate.copy(accountId = existing?.accountId ?: candidate.accountId)
        return copy(accounts = if (existing == null) accounts + next else accounts.map { if (it.accountId == existing.accountId) next else it }, activeId = next.accountId)
    }
    fun without(id: String) = copy(accounts = accounts.filterNot { it.accountId == id }, activeId = activeId.takeUnless { it == id })
    fun json() = obj("version" to 2, "accounts" to JSONArray(accounts.map { it.json() }), "activeId" to activeId, "pending" to pending?.json())
    companion object {
        fun from(json: JSONObject): AccountVault {
            if (!json.has("version")) {
                val legacy = Session.from(json)
                return AccountVault(listOf(legacy), legacy.accountId)
            }
            require(json.getInt("version") == 2)
            return AccountVault(json.getJSONArray("accounts").objects().map(Session::from), json.s("activeId").ifEmpty { null },
                json.optJSONObject("pending")?.let(BrowserSignIn::from))
        }
    }
}
