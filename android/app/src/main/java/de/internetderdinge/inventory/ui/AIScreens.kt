package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

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
        Heading(L10n.text(R.string.ui_ai_tools_ac717458), L10n.text(R.string.ui_results_are_saved_to_the_inventory_item_0fe7a21a))
        if (api.session.allows("ai.analyze", "ai")) Section(L10n.text(R.string.ui_image_analysis_5d6d896a)) {
            Toggle(L10n.text(R.string.ui_overwrite_existing_details_12eb372f), overwrite) { overwrite = it }
            Button(onClick = { action = "analyze" }) { Text(L10n.text(R.string.ui_analyze_photos_957b01f7)) }
        }
        if (api.session.allows("ai.research", "ai")) Button(onClick = { action = "research" }) { Text(L10n.text(R.string.ui_research_information_5215e68f)) }
        if (api.session.allows("ai.images", "ai")) Section(L10n.text(R.string.ui_images_214feaf1)) {
            TextInput(L10n.text(R.string.ui_search_term_image_instruction_optional_0b71c1bf), prompt, { prompt = it }, lines = 3)
            Toggle(L10n.text(R.string.ui_transparent_cover_9016a9c5), transparent) { transparent = it }
            Button(onClick = { action = "cover" }) { Text(L10n.text(R.string.ui_create_cover_from_photos_60465c89)) }
            OutlinedButton(onClick = { action = "generate" }) { Text(L10n.text(R.string.ui_generate_new_image_c730ecdc)) }
            OutlinedButton(onClick = { action = "search" }) { Text(L10n.text(R.string.ui_find_image_online_2ae93eab)) }
        }
        Text(L10n.text(R.string.ui_you_can_choose_the_image_model_and_0dbc2e7e), style = MaterialTheme.typography.bodySmall)
    }
    if (action.isNotBlank()) Confirm(L10n.text(R.string.ui_start_ai_action_16f89823), L10n.text(R.string.ui_0_this_action_may_incur_ai_costs_55432da9, when (action) { "analyze" -> L10n.text(R.string.ui_analyze_photos_957b01f7); "research" -> L10n.text(R.string.ui_research_information_5215e68f); "cover" -> "Cover erstellen"; "generate" -> "Bild erzeugen"; else -> "Bild suchen" }) + costs.o(when (action) { "analyze" -> "inventoryAnalysis"; "research" -> "inventoryResearch"; else -> action }).let { if (it.has("maximumUsd")) L10n.text(R.string.ui_estimated_0_1_usd_e963b1d1, it.s("minimumUsd"), it.s("maximumUsd")) else "" }, model.busy, { action = "" }) {
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
            model.mutate(api, "resources/$id/${if (action in listOf("search", "generate")) "image" else action}", "POST", body, true); action = ""; model.message = L10n.text(R.string.ui_ai_action_completed_834623df)
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
            Heading(L10n.text(R.string.ui_translations_22c9ef6d), L10n.text(R.string.ui_source_language_0_a1a63dfe, overview.o("defaultLanguage").s("label")))
            if (api.session.allows("ai.translate", "ai")) Button(onClick = { confirmation = L10n.text(R.string.ui_translate_missing_and_outdated_texts_0bffe97d) to obj("force" to false) }) { Text(L10n.text(R.string.ui_update_all_d8d1dc56)) }
            if (overview.a("languages").length() == 0) Empty(L10n.text(R.string.ui_no_target_languages_configured_9b167fea))
            overview.a("languages").objects().forEach { language -> Section("${language.s("label")} · ${language.s("currentCount")}/${language.s("totalCount")}") {
                if (language.s("lastError").isNotBlank()) Notice(language.s("lastError"), true)
                if (api.session.allows("ai.translate", "ai")) TextButton(onClick = { confirmation = L10n.text(R.string.ui_translate_0_again_bb87d8a0, language.s("label")) to obj("languageCodes" to JSONArray(listOf(language.s("code"))), "force" to true) }) { Text(L10n.text(R.string.ui_translate_language_c85eacdf)) }
                language.a("fields").objects().forEach { field ->
                    Text(field.s("label"), style = MaterialTheme.typography.titleSmall)
                    Text(field.s("sourceText"), style = MaterialTheme.typography.bodySmall)
                    Text(field.s("translatedText", L10n.text(R.string.ui_not_translated_yet_2e0ba474)))
                    if (api.session.allows("inventory.update", "write")) TextButton(onClick = { edit = language to field }) { Text(L10n.text(R.string.ui_edit_84e45ee7)) }
                    if (field.s("suggestion").isNotBlank()) {
                        Notice(L10n.text(R.string.ui_suggestion_0_f5503005, field.s("suggestion")))
                        if (api.session.allows("inventory.update", "write")) TextButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "resources/$id/translations/${language.s("code")}", "PATCH", obj("expectedRevision" to language.optInt("revision"), "operations" to JSONArray(listOf(obj("action" to "accept_suggestion", "fieldKey" to field.s("fieldKey")))))) } }) { Text(L10n.text(R.string.ui_accept_suggestion_41ddfc0b)) }
                    }
                }
            } }
        }
    }
    confirmation?.let { (title, body) -> Confirm(title, L10n.text(R.string.ui_the_translation_is_scheduled_on_the_server_76dc387c), model.busy, { confirmation = null }) { model.run { api.raw("resources/$id/translations", "POST", body); confirmation = null } } }
    edit?.let { (language, field) -> FormDialog("${language.s("label")}: ${field.s("label")}", listOf(Field("translatedText", L10n.text(R.string.ui_translation_08145060), "multiline")), obj("translatedText" to field.s("translatedText")), model.busy, { edit = null }) { body -> model.run {
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
            Heading(L10n.text(R.string.ui_organization_ai_defaults_c446f097))
            TextInput(L10n.text(R.string.ui_analysis_model_86ad01de), settings.s("analysisModel"), { set("analysisModel", it) })
            TextInput(L10n.text(R.string.ui_research_model_c37a96b0), settings.s("researchModel"), { set("researchModel", it) })
            TextInput(L10n.text(R.string.ui_language_f2a1cc71), settings.s("language"), { set("language", it) })
            TextInput(L10n.text(R.string.ui_maximum_image_count_e6b0831e), settings.s("maximumImages"), { set("maximumImages", it) }, true)
            listOf("autoAnalyze" to L10n.text(R.string.ui_analyze_automatically_2aca2a0f), "autoResearch" to L10n.text(R.string.ui_research_automatically_e478d0ac), "overwrite" to L10n.text(R.string.ui_overwrite_existing_fields_539c4b8e)).forEach { (key, title) -> Toggle(title, settings.optBoolean(key)) { set(key, it) } }
            Section(L10n.text(R.string.ui_instruction_templates_eb01414f)) {
                collection.a("templates").objects().forEach { template ->
                    LinkRow(template.s("name"), label(template.s("kind"))) { selected = template }
                    if (!template.s("id").startsWith("builtin-")) TextButton(onClick = {
                        val defaults = collection.o("defaults").copy()
                        if (defaults.s(template.s("kind")) == template.s("id")) defaults.put(template.s("kind"), "builtin-${template.s("kind")}")
                        collection = collection.copy().put("templates", JSONArray(collection.a("templates").objects().filter { it.s("id") != template.s("id") })).put("defaults", defaults)
                    }) { Text(L10n.text(R.string.ui_remove_template_d8db778f)) }
                }
                OutlinedButton(onClick = { selected = obj("id" to uuid(), "kind" to "analysis") }) { Text(L10n.text(R.string.ui_add_template_227e3fde)) }
                collection.o("defaults").keys().forEach { kind -> Choice(L10n.text(R.string.ui_default_0_81f5e3cd, label(kind)), collection.o("defaults").s(kind), collection.a("templates").objects().filter { it.s("kind") == kind }.map { it.s("id") to it.s("name") }) { value -> collection = collection.copy().put("defaults", collection.o("defaults").copy().put(kind, value)) } }
            }
            Button(enabled = !model.busy, onClick = { model.run {
                val payload = settings.copy().put("maximumImages", settings.s("maximumImages").toInt())
                model.mutate(api, "ai/prompts", "PUT", obj("collection" to collection, "inventorySettings" to payload, "revision" to original.optInt("revision")))
            } }) { Text(L10n.text(R.string.ui_save_organization_defaults_2e4db796)) }
        }
        selected?.let { template ->
            val existing = collection.a("templates").objects().any { it.s("id") == template.s("id") }
            val fields = listOf(Field("name", L10n.text(R.string.ui_name_dcd1d522), required = true)) +
                (if (existing) emptyList() else listOf(Field("kind", L10n.text(R.string.ui_kind_75df3579), "choice", listOf("analysis" to L10n.text(R.string.ui_analysis_d8673f98), "research" to L10n.text(R.string.ui_research_a12b73cf), "cover" to L10n.text(R.string.ui_cover_fa8d8456), "transparentCover" to L10n.text(R.string.ui_transparent_cover_9016a9c5), "image" to L10n.text(R.string.ui_image_generation_fe55be15))))) +
                listOf(Field("prompt", L10n.text(R.string.ui_instruction_e1812557), "multiline", required = true))
            FormDialog(L10n.text(R.string.ui_instruction_template_63638117), fields, template, onDismiss = { selected = null }) { changed ->
            if (existing) changed.put("kind", template.s("kind"))
            changed.put("id", template.s("id")); collection = collection.copy().put("templates", JSONArray(collection.a("templates").objects().filter { it.s("id") != template.s("id") } + changed)); selected = null
        } }
    }
}
