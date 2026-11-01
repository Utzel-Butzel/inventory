package de.internetderdinge.inventory

import android.app.Application
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
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null)
    var revision by mutableIntStateOf(0)
    var pendingCode by mutableStateOf<String?>(null)
    var pendingLink by mutableStateOf<InventoryLink?>(null)
    var flowCode by mutableStateOf("")
    var flowCodeType by mutableStateOf<String?>(null)
    var selectedWorkflow by mutableStateOf("")
    var flowReview = FlowReviewState()
    private var task: Job? = null
    val api get() = session?.let { Api(it) }

    init { viewModelScope.launch { try { app.credentials.read()?.let { activate(it) } } catch (e: Exception) { message = e.message } finally { loading = false } } }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        val context = session?.context
        busy = true
        task = viewModelScope.launch {
            try { action(); if (context == session?.context) revision++ }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (context == session?.context) message = e.message ?: "Vorgang fehlgeschlagen." }
            finally { busy = false }
        }
    }
    fun login(server: String, email: String, password: String, token: String) = run {
        val root = Api.normalizeServer(server)
        val bootstrap = Api(Session(root, "", "", "", obj()))
        val credential = if (token.isNotBlank()) token.trim() else bootstrap.call("auth/login", "POST", obj("email" to email.trim(), "password" to password, "deviceName" to "Inventory Android")).getString("token")
        val candidate = Session(root, credential, "", "", obj())
        val organizations = Api(candidate).call("organizations")
        val list = organizations.a("organizations").objects()
        require(list.isNotEmpty()) { "Für dieses Konto ist kein Arbeitsbereich verfügbar." }
        val preferred = preferences.getString("organization:${root.sha256()}", organizations.s("activeOrganizationId"))
        val id = (list.firstOrNull { it.s("id") == preferred } ?: list.first()).getString("id")
        Api(candidate).call("organizations/select", "POST", obj("organizationId" to id))
        activate(candidate.copy(organization = id))
        preferences.edit().putString("server", root).apply()
    }
    private suspend fun activate(candidate: Session) {
        val caps = Api(candidate).call("auth/capabilities")
        val organization = caps.o("organization").s("id", candidate.organization)
        require(organization == candidate.organization) { "Der Server meldet einen anderen Arbeitsbereich." }
        val principal = caps.s("principal").ifBlank { candidate.token.sha256() }
        val verified = candidate.copy(organization = organization, principal = principal, capabilities = caps)
        app.credentials.write(verified)
        preferences.edit().putString("organization:${candidate.server.sha256()}", organization).apply()
        session = verified
        app.queue.resume(verified)
    }
    fun switchOrganization(id: String) = run {
        val old = session ?: return@run
        val selection = Api(old).call("organizations/select", "POST", obj("organizationId" to id))
        require(selection.o("organization").s("id") == id)
        activate(old.copy(organization = id))
    }
    fun logout() = run {
        val api = api
        // Local logout succeeds even offline; server revocation is best effort.
        app.credentials.clear(); session = null
        runCatching { api?.call("auth/logout", "POST") }
    }
    suspend fun mutate(api: Api, path: String, method: String, body: JSONObject = obj(), idempotent: Boolean = false): JSONObject {
        check(session?.context == api.session.context) { "Arbeitsbereich wurde gewechselt." }
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
