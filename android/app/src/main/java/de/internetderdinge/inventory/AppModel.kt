package de.internetderdinge.inventory

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import android.app.Application
import java.time.Instant
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.*
import org.json.JSONObject

class FlowReviewState {
    val report = mutableStateOf<JSONObject?>(null)
    val request = mutableStateOf<JSONObject?>(null)
    val uncertain = mutableStateOf(false)
    val complete = mutableStateOf(false)
}

class AppModel(application: Application) : AndroidViewModel(application) {
    val app = application as InventoryApplication
    val preferences = application.getSharedPreferences("preferences", 0)
    var session by mutableStateOf<Session?>(null); private set
    var loading by mutableStateOf(true); private set
    var connectionRevision by mutableIntStateOf(0); private set
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null)
    var savedAccounts by mutableStateOf<List<Session>>(emptyList()); private set
    var pendingBrowser by mutableStateOf<BrowserSignIn?>(null); private set
    var recoveryError by mutableStateOf<String?>(null); private set
    var credentialLoadFailed by mutableStateOf(false); private set
    private var queuedBrowserCallback: String? = null
    private var restoreTask: Job? = null
    var revision by mutableIntStateOf(0)
    var pendingCode by mutableStateOf<String?>(null)
    var pendingLink by mutableStateOf<InventoryLink?>(null)
    var flowCode by mutableStateOf("")
    var flowCodeType by mutableStateOf<String?>(null)
    var selectedWorkflow by mutableStateOf("")
    var flowReview = FlowReviewState()
    private var task: Job? = null
    val api get() = session?.let { Api(it) }

    init { restoreSession() }

    fun restoreSession() {
        if (busy || restoreTask?.isActive == true) return
        loading = true
        recoveryError = null
        restoreTask = viewModelScope.launch {
            try {
                val vault = withContext(Dispatchers.IO) { app.credentials.readVault() }
                credentialLoadFailed = false
                savedAccounts = vault.accounts
                pendingBrowser = vault.pending?.takeIf { it.expiresAt > System.currentTimeMillis() }
                val stored = vault.active
                if (stored != null) {
                    if (stored.expired) {
                        withContext(Dispatchers.IO) { app.credentials.removeAccount(stored.accountId) }
                        refreshAccounts()
                        message = L10n.text(R.string.ui_please_sign_in_again_9429828e)
                    } else {
                        try { activate(stored) }
                        catch (e: ApiError) {
                            if (e.status == 401) {
                                withContext(Dispatchers.IO) { app.credentials.removeAccount(stored.accountId) }
                                refreshAccounts()
                                message = L10n.text(R.string.ui_please_sign_in_again_9429828e)
                            } else recoveryError = e.message
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { recoveryError = e.message ?: L10n.text(R.string.ui_connection_unavailable) }
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                credentialLoadFailed = true
                recoveryError = e.message ?: L10n.text(R.string.ui_connection_unavailable)
            } finally {
                loading = false
                queuedBrowserCallback?.let { queuedBrowserCallback = null; handleBrowserCallback(it) }
            }
        }
    }

    fun showLoginAfterRecovery() { if (!credentialLoadFailed) recoveryError = null }

    private suspend fun refreshAccounts() {
        val vault = withContext(Dispatchers.IO) { app.credentials.readVault() }
        savedAccounts = vault.accounts
        pendingBrowser = vault.pending?.takeIf { it.expiresAt > System.currentTimeMillis() }
    }

    fun run(action: suspend () -> Unit) {
        if (busy || loading || credentialLoadFailed) return
        val context = session?.context
        busy = true
        task = viewModelScope.launch {
            try { action(); if (context == session?.context) revision++ }
            catch (e: TimeoutCancellationException) { if (context == session?.context) message = L10n.text(R.string.ui_connection_unavailable) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (context == session?.context) message = e.message ?: L10n.text(R.string.ui_operation_failed_544e92c9) }
            finally {
                busy = false
                queuedBrowserCallback?.let { queuedBrowserCallback = null; handleBrowserCallback(it) }
            }
        }
    }

    fun login(server: String, email: String, password: String, token: String) = run {
        clearPendingBrowser()
        val root = Api.normalizeServer(server)
        val candidate = if (token.isNotBlank()) Session(root, token.trim(), "", "", obj(), label = L10n.text(R.string.ui_api_token_5efaaeee))
        else loginSession(root, Api(Session(root, "", "", "", obj())).call("auth/login", "POST", obj("email" to email.trim(), "password" to password, "deviceName" to "Inventory Android")))
        try { activate(candidate) }
        catch (e: Exception) { if (candidate.deviceLogin) revoke(candidate); throw e }
    }

    private fun loginSession(server: String, response: JSONObject): Session {
        val token = response.getString("token").trim()
        require(token.isNotEmpty())
        return Session(server, token, "", "", obj(), label = response.o("user").getString("email"),
            userId = response.o("user").getString("id"), deviceLogin = true,
            expiresAt = Instant.parse(response.getString("expiresAt")).toEpochMilli())
    }

    private suspend fun activate(candidate: Session, requestedOrganization: String? = null) {
        require(!candidate.expired) { L10n.text(R.string.ui_please_sign_in_again_9429828e) }
        val bootstrap = Api(candidate.copy(organization = ""))
        val organizations = bootstrap.call("organizations")
        val list = organizations.a("organizations").objects()
        require(list.isNotEmpty()) { L10n.text(R.string.ui_no_workspace_is_available_for_this_account_68e959a4) }
        if (requestedOrganization != null) require(list.any { it.s("id") == requestedOrganization }) { L10n.text(R.string.ui_the_organization_is_unavailable_10c19dda) }
        val preferred = requestedOrganization ?: candidate.organization
        val selected = list.firstOrNull { it.s("id") == preferred }
            ?: list.firstOrNull { it.s("id") == organizations.s("activeOrganizationId") } ?: list.first()
        val id = selected.getString("id")
        if (candidate.token == "inv_demo_public_openinventory") {
            require(list.size == 1 && id == "d3e00000-0000-4000-8000-000000000001" && selected.optBoolean("isReadOnly") && selected.s("role") == "viewer") { L10n.text(R.string.ui_the_demo_is_not_configured_as_a_10faaf4a) }
        } else {
            require(bootstrap.call("organizations/select", "POST", obj("organizationId" to id)).o("organization").s("id") == id)
        }
        val scoped = candidate.copy(organization = id)
        val caps = Api(scoped).call("auth/capabilities")
        require(caps.o("organization").s("id", id) == id) { L10n.text(R.string.ui_the_server_reports_a_different_workspace_31c36a98) }
        require("read" in caps.a("scopes").strings()) { L10n.text(R.string.ui_this_account_cannot_view_inventory_323e491b) }
        Api(scoped).call("resources", query = mapOf("page" to "1", "pageSize" to "1"))
        val principal = caps.s("principal").ifBlank { candidate.token.sha256() }
        if (!caps.has("organizations")) caps.put("organizations", organizations.a("organizations"))
        val verified = scoped.copy(principal = principal, capabilities = caps,
            label = candidate.label.ifBlank { caps.s("name", candidate.server) })
        val saved = withContext(Dispatchers.IO) { app.credentials.write(verified) }
        session = saved
        connectionRevision++
        recoveryError = null
        preferences.edit().putString("server", saved.server).apply()
        pendingCode = null; pendingLink = null; selectedWorkflow = ""; flowCode = ""; flowReview = FlowReviewState()
        refreshAccounts()
        app.queue.resume(saved)
    }

    fun switchOrganization(id: String) { session?.let { switchAccount(it.accountId, id) } }
    fun switchAccount(id: String, organization: String? = null) = run {
        val candidate = savedAccounts.firstOrNull { it.accountId == id } ?: return@run
        clearPendingBrowser()
        activate(candidate, organization)
    }

    fun logout() = run {
        val old = session ?: return@run
        clearPendingBrowser()
        withContext(Dispatchers.IO) { app.credentials.removeAccount(old.accountId) }
        session = null
        recoveryError = null
        refreshAccounts()
        if (old.deviceLogin) revoke(old)
    }

    private suspend fun revoke(candidate: Session) { runCatching { Api(candidate).call("auth/logout", "POST") } }
    private suspend fun clearPendingBrowser() {
        withContext(Dispatchers.IO) { app.credentials.savePending(null) }
        pendingBrowser = null
    }
    fun cancelBrowserSignIn() = run { clearPendingBrowser() }

    fun startBrowserSignIn(server: String, launch: (String) -> Unit) = run {
        val root = Api.normalizeServer(server)
        val api = Api(Session(root, "", "", "", obj()))
        val options = withTimeout(15_000) { AuthOptions.from(api.call("auth/options")) }
        require(options.browserSignIn && options.providers.isNotEmpty()) { L10n.text(R.string.ui_sso_not_configured) }
        clearPendingBrowser()
        val attempt = BrowserSignIn(root)
        val response = api.call("auth/browser/start", "POST", obj("codeChallenge" to attempt.challenge, "codeChallengeMethod" to "S256", "state" to attempt.state, "deviceName" to "Inventory Android"))
        val pending = attempt.copy(requestId = response.getString("requestId"), expiresAt = Instant.parse(response.getString("expiresAt")).toEpochMilli())
        require(pending.expiresAt > System.currentTimeMillis())
        val url = pending.authorizationURL()
        withContext(Dispatchers.IO) { app.credentials.savePending(pending) }
        pendingBrowser = pending
        try { launch(url) } catch (e: Exception) { clearPendingBrowser(); throw e }
    }

    fun handleBrowserCallback(value: String) {
        if (loading || busy) { queuedBrowserCallback = value; return }
        run {
            val pending = withContext(Dispatchers.IO) { app.credentials.readVault().pending } ?: return@run
            val code = try { pending.code(value) } catch (e: Exception) {
                throw IllegalArgumentException(L10n.text(R.string.ui_browser_sign_in_invalid_callback), e)
            }
            clearPendingBrowser()
            if (code == null) return@run
            val response = Api(Session(pending.server, "", "", "", obj())).call("auth/browser/exchange", "POST",
                obj("requestId" to pending.requestId, "code" to code, "codeVerifier" to pending.verifier))
            val candidate = loginSession(pending.server, response)
            try { activate(candidate) } catch (e: Exception) { revoke(candidate); throw e }
        }
    }

    suspend fun mutate(api: Api, path: String, method: String, body: JSONObject = obj(), idempotent: Boolean = false): JSONObject {
        check(session?.context == api.session.context) { L10n.text(R.string.ui_workspace_changed_f6323460) }
        if (!idempotent) return api.call(path, method, body)
        val operation = withContext(Dispatchers.IO) { app.store.operation(api.session.context, path, method, body) }
        return retryOperation(api, operation)
    }
    suspend fun retryOperation(api: Api, operation: JSONObject): JSONObject {
        check(session?.context == operation.s("context"))
        return try {
            val response = api.call(operation.getString("path"), operation.getString("method"), operation.o("body"), operation.getString("key"))
            app.store.complete(operation); response
        } catch (e: ApiError) {
            // Validation and stale-preview errors are definitive. Transport/5xx
            // outcomes stay in the journal until the same request succeeds.
            if (e.status in listOf(400, 403, 404, 409, 422) && !e.retryable) app.store.complete(operation)
            throw e
        }
    }
    fun setting(key: String, default: String = "") = preferences.getString("${session?.context}:$key", default) ?: default
    fun setSetting(key: String, value: String) { preferences.edit().putString("${session?.context}:$key", value).apply(); revision++ }
    fun analysisBody() = obj("overwrite" to true).apply { setting("analysisPrompt").takeIf { it.isNotBlank() }?.let { put("prompt", it) } }
    fun coverBody() = obj("maximumImageSize" to (setting("coverSize", "1024").toIntOrNull() ?: 1024)).apply {
        setting("model").takeIf { it.isNotBlank() }?.let { put("modelId", it) }
        setting("coverPrompt").takeIf { it.isNotBlank() }?.let { put("prompt", it) }
    }
}
