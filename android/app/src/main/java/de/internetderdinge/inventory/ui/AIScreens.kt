package de.internetderdinge.inventory.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

@Composable fun AIScreen(model: AppModel, api: Api, id: String) {
    var action by remember { mutableStateOf("") }; var prompt by remember { mutableStateOf("") }; var overwrite by remember { mutableStateOf(true) }; var transparent by remember { mutableStateOf(false) }
    var costs by remember { mutableStateOf(obj()) }
    LaunchedEffect(api.session.context) { runCatching { api.call("ai/prompts") }.onSuccess { costs = it.o("costEstimates") } }
    Page {
        Heading("KI-Werkzeuge", "Ergebnisse werden am Inventareintrag gespeichert.")
        if (api.session.allows("ai.analyze", "ai")) Section("Bildanalyse") {
            Toggle("Vorhandene Angaben überschreiben", overwrite) { overwrite = it }
            Button(onClick = { action = "analyze" }) { Text("Fotos analysieren") }
        }
        if (api.session.allows("ai.research", "ai")) Button(onClick = { action = "research" }) { Text("Informationen recherchieren") }
        if (api.session.allows("ai.images", "ai")) Section("Bilder") {
            TextInput("Suchbegriff / Bildanweisung (optional)", prompt, { prompt = it }, lines = 3)
            Toggle("Transparentes Cover", transparent) { transparent = it }
            Button(onClick = { action = "cover" }) { Text("Cover aus Fotos erstellen") }
            OutlinedButton(onClick = { action = "generate" }) { Text("Neues Bild erzeugen") }
            OutlinedButton(onClick = { action = "search" }) { Text("Bild im Internet suchen") }
        }
        Text("Bildmodell und Standardanweisungen kannst du unter Mehr → Bilder & KI wählen.", style = MaterialTheme.typography.bodySmall)
    }
    if (action.isNotBlank()) Confirm("KI-Aktion starten?", "${when (action) { "analyze" -> "Fotos analysieren"; "research" -> "Informationen recherchieren"; "cover" -> "Cover erstellen"; "generate" -> "Bild erzeugen"; else -> "Bild suchen" }}. Diese Aktion kann KI-Kosten verursachen." + costs.o(when (action) { "analyze" -> "inventoryAnalysis"; "research" -> "inventoryResearch"; else -> action }).let { if (it.has("maximumUsd")) " Geschätzt: ${it.s("minimumUsd")}–${it.s("maximumUsd")} USD." else "" }, model.busy, { action = "" }) {
        model.run {
            val body = when (action) {
                "analyze" -> model.analysisBody().put("overwrite", overwrite)
                "cover" -> model.coverBody().put("transparentBackground", transparent).apply {
                    if (transparent) { put("transparencyMethod", "difference-matting"); remove("prompt"); model.setting("transparentCoverPrompt").takeIf { it.isNotBlank() }?.let { put("prompt", it) } }
                    if (prompt.isNotBlank()) put("prompt", prompt)
                }
                "generate" -> model.coverBody().put("mode", "generate").apply { if (prompt.isNotBlank()) put("prompt", prompt) }
                "search" -> obj("mode" to "search").apply { if (prompt.isNotBlank()) put("query", prompt) }
                else -> obj()
            }
            model.mutate(api, "resources/$id/${if (action in listOf("search", "generate")) "image" else action}", "POST", body, true); action = ""; model.message = "KI-Aktion abgeschlossen."
        }
    }
}

@Composable fun TranslationsScreen(model: AppModel, api: Api, id: String) {
    var edit by remember { mutableStateOf<Pair<JSONObject, JSONObject>?>(null) }
    var confirmation by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }
    Remote(model, api, "resources/$id/translations") { data -> val overview = data.o("translations")
        val active = overview.a("languages").objects().any { it.s("status") in listOf("pending", "processing") }
        LaunchedEffect(active, data.toString()) { if (active) { delay(3000); model.revision++ } }
        Page {
            Heading("Übersetzungen", "Ausgangssprache: ${overview.o("defaultLanguage").s("label")}")
            if (api.session.allows("ai.translate", "ai")) Button(onClick = { confirmation = "Fehlende und veraltete Texte übersetzen?" to obj("force" to false) }) { Text("Alle aktualisieren") }
            if (overview.a("languages").length() == 0) Empty("Keine Zielsprachen eingerichtet")
            overview.a("languages").objects().forEach { language -> Section("${language.s("label")} · ${language.s("currentCount")}/${language.s("totalCount")}") {
                if (language.s("lastError").isNotBlank()) Notice(language.s("lastError"), true)
                if (api.session.allows("ai.translate", "ai")) TextButton(onClick = { confirmation = "${language.s("label")} neu übersetzen?" to obj("languageCodes" to JSONArray(listOf(language.s("code"))), "force" to true) }) { Text("Sprache übersetzen") }
                language.a("fields").objects().forEach { field ->
                    Text(field.s("label"), style = MaterialTheme.typography.titleSmall)
                    Text(field.s("sourceText"), style = MaterialTheme.typography.bodySmall)
                    Text(field.s("translatedText", "Noch nicht übersetzt"))
                    if (api.session.allows("inventory.update", "write")) TextButton(onClick = { edit = language to field }) { Text("Bearbeiten") }
                    if (field.s("suggestion").isNotBlank()) {
                        Notice("Vorschlag: ${field.s("suggestion")}")
                        if (api.session.allows("inventory.update", "write")) TextButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "resources/$id/translations/${language.s("code")}", "PATCH", obj("expectedRevision" to language.optInt("revision"), "operations" to JSONArray(listOf(obj("action" to "accept_suggestion", "fieldKey" to field.s("fieldKey")))))) } }) { Text("Vorschlag übernehmen") }
                    }
                }
            } }
        }
    }
    confirmation?.let { (title, body) -> Confirm(title, "Die Übersetzung wird auf dem Server eingeplant und kann KI-Kosten verursachen.", model.busy, { confirmation = null }) { model.run { api.raw("resources/$id/translations", "POST", body); confirmation = null } } }
    edit?.let { (language, field) -> FormDialog("${language.s("label")}: ${field.s("label")}", listOf(Field("translatedText", "Übersetzung", "multiline")), obj("translatedText" to field.s("translatedText")), model.busy, { edit = null }) { body -> model.run {
        body.put("action", "set").put("fieldKey", field.s("fieldKey"))
        model.mutate(api, "resources/$id/translations/${language.s("code")}", "PATCH", obj("expectedRevision" to language.optInt("revision"), "operations" to JSONArray(listOf(body)))); edit = null
    } } }
}

@Composable fun AISettingsScreen(model: AppModel, api: Api) {
    Remote(model, api, "ai/prompts") { original ->
        var settings by remember(original.toString()) { mutableStateOf(original.o("inventorySettings").copy()) }
        var collection by remember(original.toString()) { mutableStateOf(original.o("collection").copy()) }
        var selected by remember { mutableStateOf<JSONObject?>(null) }
        fun set(key: String, value: Any) { settings = settings.copy().put(key, value) }
        Page {
            Heading("KI-Vorgaben der Organisation")
            TextInput("Analysemodell", settings.s("analysisModel"), { set("analysisModel", it) })
            TextInput("Recherchemodell", settings.s("researchModel"), { set("researchModel", it) })
            TextInput("Sprache", settings.s("language"), { set("language", it) })
            TextInput("Maximale Bilderzahl", settings.s("maximumImages"), { set("maximumImages", it) }, true)
            listOf("autoAnalyze" to "Automatisch analysieren", "autoResearch" to "Automatisch recherchieren", "overwrite" to "Vorhandene Felder überschreiben").forEach { (key, title) -> Toggle(title, settings.optBoolean(key)) { set(key, it) } }
            Section("Anweisungsvorlagen") {
                collection.a("templates").objects().forEach { template ->
                    LinkRow(template.s("name"), template.s("kind")) { selected = template }
                    if (!template.s("id").startsWith("builtin-")) TextButton(onClick = {
                        val defaults = collection.o("defaults").copy()
                        if (defaults.s(template.s("kind")) == template.s("id")) defaults.put(template.s("kind"), "builtin-${template.s("kind")}")
                        collection = collection.copy().put("templates", JSONArray(collection.a("templates").objects().filter { it.s("id") != template.s("id") })).put("defaults", defaults)
                    }) { Text("Vorlage entfernen") }
                }
                OutlinedButton(onClick = { selected = obj("id" to uuid(), "kind" to "analysis") }) { Text("Vorlage hinzufügen") }
                collection.o("defaults").keys().forEach { kind -> Choice("Standard: $kind", collection.o("defaults").s(kind), collection.a("templates").objects().filter { it.s("kind") == kind }.map { it.s("id") to it.s("name") }) { value -> collection = collection.copy().put("defaults", collection.o("defaults").copy().put(kind, value)) } }
            }
            Button(enabled = !model.busy, onClick = { model.run {
                val payload = settings.copy().put("maximumImages", settings.s("maximumImages").toInt())
                model.mutate(api, "ai/prompts", "PUT", obj("collection" to collection, "inventorySettings" to payload, "revision" to original.optInt("revision")))
            } }) { Text("Organisationsvorgaben speichern") }
        }
        selected?.let { template ->
            val existing = collection.a("templates").objects().any { it.s("id") == template.s("id") }
            val fields = listOf(Field("name", "Name", required = true)) +
                (if (existing) emptyList() else listOf(Field("kind", "Art", "choice", listOf("analysis" to "Analyse", "research" to "Recherche", "cover" to "Cover", "transparentCover" to "Transparentes Cover", "image" to "Bildgenerierung")))) +
                listOf(Field("prompt", "Anweisung", "multiline", required = true))
            FormDialog("Anweisungsvorlage", fields, template, onDismiss = { selected = null }) { changed ->
            if (existing) changed.put("kind", template.s("kind"))
            changed.put("id", template.s("id")); collection = collection.copy().put("templates", JSONArray(collection.a("templates").objects().filter { it.s("id") != template.s("id") } + changed)); selected = null
        } }
    }
}
