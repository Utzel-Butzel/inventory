package de.internetderdinge.inventory.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable fun LoginScreen(model: AppModel) {
    var server by rememberSaveable { mutableStateOf(model.preferences.getString("server", "") ?: "") }
    var email by rememberSaveable { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var token by remember { mutableStateOf("") }
    var expert by rememberSaveable { mutableStateOf(false) }
    Page {
        Spacer(Modifier.height(32.dp)); Icon(Icons.Outlined.Inventory2, null, Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
        Heading("Alles an seinem Platz.", "Verbinde dich mit deinem Inventory-Server.")
        TextInput("Serveradresse", server, { server = it })
        if (!expert) {
            TextInput("E-Mail", email, { email = it })
            OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Passwort") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        } else OutlinedTextField(token, { token = it }, Modifier.fillMaxWidth(), label = { Text("API-Token") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        Button(onClick = { model.login(server, email, password, if (expert) token else "") }, enabled = !model.busy && server.isNotBlank() && (if (expert) token.isNotBlank() else email.isNotBlank() && password.isNotBlank()), modifier = Modifier.fillMaxWidth()) { Text(if (model.busy) "Verbinde …" else "Anmelden") }
        TextButton(onClick = { expert = !expert }) { Text(if (expert) "Mit E-Mail anmelden" else "Expertenoption: API-Token") }
        Text("Deine Zugangsdaten werden mit dem Android Keystore verschlüsselt gespeichert.", style = MaterialTheme.typography.bodySmall)
    }
}
@Composable fun SettingsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    val context = LocalContext.current
    var logout by remember { mutableStateOf(false) }
    var organizations by remember { mutableStateOf(api.session.capabilities.a("organizations").objects()) }
    var models by remember { mutableStateOf(emptyList<JSONObject>()) }
    var uploadSize by remember { mutableStateOf(model.setting("uploadSize", "2200")) }
    var coverSize by remember { mutableStateOf(model.setting("coverSize", "1024")) }
    var imageModel by remember { mutableStateOf(model.setting("model")) }
    var prompt by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(api.session.context) {
        try { organizations = api.call("organizations").a("organizations").objects(); if (api.session.allows("ai.images", "ai")) models = api.call("ai/image-models").a("models").objects() }
        catch (e: Exception) { model.message = e.message }
    }
    fun web(path: String) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(api.session.server + path))) }
    Page {
        Heading("Dein Arbeitsbereich", api.session.capabilities.o("organization").s("name"))
        Section("Konto") {
            Text(api.session.capabilities.s("name")); Text(api.session.server, style = MaterialTheme.typography.bodySmall)
            Choice("Organisation", api.session.organization, organizations.map { it.s("id") to it.s("name") }) { if (!model.busy) model.switchOrganization(it) }
            if (api.session.capabilities.o("organization").optBoolean("isReadOnly")) Notice("Dieser Arbeitsbereich ist schreibgeschützt.")
        }
        Section("Aktivität") {
            LinkRow("Uploads & offene Vorgänge") { navigate("jobs") }
            LinkRow("Benachrichtigungen") { navigate("notifications") }
            if (api.session.allows("assignments.read")) LinkRow("Ausleihen & Reservierungen") { navigate("loans") }
            if (api.session.allows("requests.read")) LinkRow("Interne Anfragen") { navigate("requests") }
        }
        Section("Bilder & KI") {
            Choice("Maximale Fotogröße", uploadSize, listOf(1024, 1600, 2200, 4096).map { "$it" to "$it Pixel" }) { uploadSize = it; model.setSetting("uploadSize", it) }
            if (api.session.allows("ai.images", "ai")) {
                Choice("Bildmodell", imageModel, listOf("" to "Serverstandard") + models.map { it.s("id") to it.s("label") }) { imageModel = it; model.setSetting("model", it) }
                Choice("KI-Bildgröße", coverSize, listOf(1024, 2048, 4096).map { "$it" to "$it Pixel" }) { coverSize = it; model.setSetting("coverSize", it) }
                models.firstOrNull { it.s("id") == imageModel }?.o("estimatedCostsBySize")?.o(coverSize)?.let { if (it.has("maximumUsd")) Text("Geschätzte Bildkosten: ${it.s("minimumUsd")}–${it.s("maximumUsd")} USD", style = MaterialTheme.typography.bodySmall) }
            }
            if (api.session.allows("ai.analyze", "ai")) LinkRow("Eigene Analyseanweisung", "Leer lassen für Serverstandard") { prompt = "analysisPrompt" }
            if (api.session.allows("ai.images", "ai")) LinkRow("Eigene Cover-Anweisung", "Leer lassen für Serverstandard") { prompt = "coverPrompt" }
            if (api.session.allows("ai.images", "ai")) LinkRow("Anweisung für transparente Cover", "Leer lassen für Serverstandard") { prompt = "transparentCoverPrompt" }
            if (api.session.allows("roles.manage", "admin")) LinkRow("KI-Vorgaben der Organisation") { navigate("ai-settings") }
        }
        Section("Arbeitsbereich") {
            LinkRow("Inventartypen") { navigate("references/inventory-types") }; LinkRow("Benutzerdefinierte Felder") { navigate("references/custom-fields") }; LinkRow("Beziehungsarten") { navigate("references/relation-types") }
            LinkRow("Server & Zugriffsrechte") { navigate("references/capabilities") }
            LinkRow("Systemstatus", "Speicher, KI und Anmeldung") { navigate("references/runtime") }
            if (api.session.allows("workflows.read")) LinkRow("Aktionsabläufe", "Im Scanner ausführen") { navigate("camera/scan") }
        }
        Section("Web") {
            if (api.session.allows("workflows.manage", "write")) LinkRow("Aktionsabläufe bearbeiten", "Webeditor öffnen") { web("${api.session.capabilities.o("organization").s("slug")}/settings/action-flows") }
            LinkRow("Servereinstellungen") { web("settings") }; LinkRow("API-Dokumentation") { web("api-docs") }
        }
        Section("Android") { Text("Native Oberfläche mit Material 3. Bestehende Raumscans lassen sich ansehen. Apples RoomPlan-Erfassung, ARWorldMap-Relokalisierung und lokale Object-Capture-Rekonstruktion sind auf Android nicht verfügbar.") }
        TextButton(onClick = { logout = true }) { Text("Abmelden") }
    }
    prompt?.let { key -> FormDialog("Eigene KI-Anweisung", listOf(Field("prompt", "Anweisung", "multiline")), obj("prompt" to model.setting(key)), onDismiss = { prompt = null }) { model.setSetting(key, it.s("prompt").trim()); prompt = null } }
    if (logout) Confirm("Abmelden?", "Uploads bleiben lokal gespeichert und können nach erneuter Anmeldung im selben Arbeitsbereich fortgesetzt werden.", model.busy, { logout = false }) { model.logout() }
}

@Composable fun JobsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var jobs by remember { mutableStateOf(model.app.store.jobs(api.session.context)) }
    var operations by remember { mutableStateOf(model.app.store.operations(api.session.context)) }
    var remove by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(api.session.context, model.revision) { while (true) { jobs = model.app.store.jobs(api.session.context); operations = model.app.store.operations(api.session.context); delay(1500) } }
    Page {
        Heading("Uploads & offene Vorgänge")
        if (jobs.isEmpty() && operations.isEmpty()) Empty("Alles erledigt", "Neue Uploads und unterbrochene Vorgänge erscheinen hier.")
        jobs.forEach { job -> ElevatedCard { Column(Modifier.padding(Spacing)) {
            Text(job.o("resource").s("name", "Medienupload"), style = MaterialTheme.typography.titleMedium)
            Text("${label(job.s("status"))} · Schritt ${job.optInt("stage")}/4")
            if (job.s("error").isNotBlank()) Text(job.s("error"))
            if (job.s("resourceId").isNotBlank()) TextButton(onClick = { navigate("resource/${job.s("resourceId")}") }) { Text("Eintrag öffnen") }
            if (job.s("status") in listOf("error", "paused")) TextButton(onClick = { model.app.queue.schedule(job.s("id")) }) { Text("Erneut versuchen") }
            if (job.s("status") in listOf("done", "error", "paused")) TextButton(onClick = { remove = job.s("id") }) { Text("Lokal entfernen") }
        } } }
        operations.forEach { operation -> ElevatedCard { Column(Modifier.padding(Spacing)) {
            Text("Unbestätigter Vorgang", style = MaterialTheme.typography.titleMedium)
            Text(operationName(operation.s("path")))
            OperationSummary(operation.o("body"))
            Text("Die Serverantwort fehlt. Wiederholen verwendet dieselbe Bestätigung und vermeidet eine doppelte Buchung.", style = MaterialTheme.typography.bodySmall)
            Button(enabled = !model.busy, onClick = { model.run { model.retryOperation(api, operation) } }) { Text("Ergebnis sicher abrufen") }
        } } }
    }
    remove?.let { id -> Confirm("Lokalen Upload entfernen?", "Noch nicht hochgeladene Fotos werden auf diesem Gerät gelöscht. Bereits gespeicherte Serverdaten bleiben erhalten.", onDismiss = { remove = null }) { model.app.store.removeJob(id); remove = null; model.revision++ } }
}
fun operationName(path: String) = when { path.contains("action-chains") -> "Aktionsablauf"; path.contains("movements") -> "Bestandsbuchung"; path.contains("assignments") -> "Ausleihe oder Rückgabe"; path.contains("analyze") -> "KI-Analyse"; path.contains("cover") || path.endsWith("image") -> "Bilderzeugung"; path.contains("research") -> "Recherche"; path.contains("internal-requests") -> "Interne Anfrage"; else -> "Inventareintrag" }
@Composable fun OperationSummary(body: JSONObject) {
    listOf("name" to "Name", "delta" to "Bestandsänderung", "quantity" to "Menge", "note" to "Notiz", "code" to "Code", "status" to "Status").forEach { (key, title) -> if (body.s(key).isNotBlank()) Text("$title: ${body.s(key)}") }
}

@Composable fun ReferenceScreen(model: AppModel, api: Api, kind: String) {
    if (kind == "runtime") {
        var data by remember { mutableStateOf<JSONObject?>(null) }; var error by remember { mutableStateOf<String?>(null) }; var reload by remember { mutableIntStateOf(0) }
        LaunchedEffect(reload) { try { data = api.runtimeSettings(); error = null } catch (e: Exception) { error = e.message } }
        Page {
            Heading("Systemstatus")
            data?.let { d ->
                Section("Speicher") { Text(d.o("storage").s("provider")); Text(if (d.o("storage").optBoolean("configured")) "Eingerichtet" else "Nicht eingerichtet") }
                Section("KI") { Text("Analyse: ${if (d.o("ai").optBoolean("analysis")) "Verfügbar" else "Nicht eingerichtet"}"); Text("Bilderzeugung: ${if (d.o("ai").optBoolean("imageGeneration")) "Verfügbar" else "Nicht eingerichtet"}"); Text(d.o("ai").s("imageProvider")) }
                Section("Anmeldung") { d.o("auth").a("providers").objects().forEach { Text(it.s("name")) }; Text("Passwort: ${if (d.o("auth").optBoolean("password")) "Aktiv" else "Inaktiv"}") }
            }
            error?.let { Notice(it, true) }; OutlinedButton(onClick = { reload++ }) { Text("Aktualisieren") }
        }
    } else if (kind == "capabilities") Page {
        Heading("Server & Zugriff", api.session.server)
        Text("Konto: ${api.session.capabilities.s("name")}")
        Section("Berechtigungen") { api.session.capabilities.a("permissions").strings().forEach { Text(it) } }
        Section("Token-Bereiche") { api.session.capabilities.a("scopes").strings().forEach { Text(it) } }
    } else Remote(model, api, kind) { data -> Page {
        Heading(when (kind) { "inventory-types" -> "Inventartypen"; "custom-fields" -> "Benutzerdefinierte Felder"; else -> "Beziehungsarten" })
        val key = when (kind) { "inventory-types" -> "types"; "custom-fields" -> "definitions"; else -> "relationTypes" }
        data.a(key).objects().forEach { item -> ListItem(headlineContent = { Text(item.s("label")) }, supportingContent = { Text(item.s("description").ifEmpty { item.s("fieldType") }) }) }
    } }
}
