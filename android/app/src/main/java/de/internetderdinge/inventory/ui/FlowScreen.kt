@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

@Composable fun FlowScreen(model: AppModel, api: Api, id: String, back: () -> Unit) {
    val context = LocalContext.current
    val code = remember { model.flowCode }; val codeType = remember { model.flowCodeType }
    var configuration by remember { mutableStateOf<JSONObject?>(null) }; var legacy by remember { mutableStateOf(false) }
    var values by remember { mutableStateOf(obj()) }; var targets by remember { mutableStateOf(mapOf<String, String>()) }
    val reviewState = remember { model.flowReview }
    var report by reviewState.report; var reviewed by reviewState.request
    var uncertain by reviewState.uncertain; var complete by reviewState.complete
    var load by remember { mutableIntStateOf(0) }; var error by remember { mutableStateOf<String?>(null) }
    var files by remember { mutableStateOf(mapOf<String, List<Upload>>()) }
    val currentFiles by rememberUpdatedState(files)
    val uploadKeys = remember { mutableMapOf<String, String>() }; val uploaded = remember { mutableMapOf<String, JSONArray>() }
    var importing by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) model.run {
            require(uris.size <= 12) { L10n.text(R.string.ui_maximum_12_files_per_field_5bdbe27f) }
            val prepared = mutableListOf<Upload>()
            try { uris.forEach { prepared += Imaging.import(context, it, model.setting("uploadSize", "2200").toInt(), false) } }
            catch (e: Exception) { prepared.forEach { it.file.delete() }; throw e }
            files[importing]?.forEach { it.file.delete() }; files = files + (importing to prepared)
            uploaded.clear(); uploadKeys.keys.filter { it.endsWith("#$importing") }.toList().forEach { uploadKeys.remove(it) }
            values = values.copy().put(importing, JSONArray(listOf("selected"))); report = null
        }
    }
    DisposableEffect(Unit) { onDispose { currentFiles.values.flatten().forEach { it.file.delete() } } }
    LaunchedEffect(load) {
        try {
            require(code.isNotBlank()) { L10n.text(R.string.ui_please_scan_a_code_first_962b2eaa) }
            val workflow = api.call("stock/scan-workflows").a("workflows").objects().first { it.s("id") == id }
            legacy = workflow.a("actions").length() == 0
            val input = obj("code" to code).apply { codeType?.let { put("codeType", it) } }
            val config = if (legacy) api.call("stock/scans/resolve", "POST", input.put("workflowId", id)) else api.call("stock/scan-workflows/$id/runner", "POST", input).o("workflow")
            configuration = config
            if (!legacy && targets.isEmpty()) targets = config.a("targetGroups").objects().mapIndexedNotNull { index, group ->
                if (config.s("targetSelectionMode") == "all" || (config.s("targetSelectionMode") == "radio" && index == 0)) group.s("resourceId") to group.a("options").objects().first().s("id") else null
            }.toMap()
        } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message }
    }
    val config = configuration
    val fields = config?.let { if (legacy) it.a("fields").objects() else FlowRules.visible(it.a("inputFields").objects(), it.s("identifier"), code, values) }.orEmpty()
    fun preview() = model.run {
        try {
            error = null
            val configuration = config ?: error(L10n.text(R.string.ui_loading_workflow_67d8bba5))
            val inputs = FlowRules.inputs(fields, values)
            val selected = if (legacy) listOf(configuration.o("resource").getString("id")) else targets.values.sorted()
            require(selected.isNotEmpty()) { L10n.text(R.string.ui_please_select_at_least_one_product_350b11e8) }
            for (f in fields.filter { it.s("type") in listOf("media", "file") }) {
                val cacheKey = "${selected.first()}#${f.s("key")}"
                val media = uploaded[cacheKey] ?: files[f.s("key")]?.takeIf { it.isNotEmpty() }?.let { list ->
                    val reply = api.multipart("resources/${selected.first()}/media", list, uploadKeys.getOrPut(cacheKey, ::uuid))
                    if (reply.status == 202) throw ApiError(202, L10n.text(R.string.ui_processing_files_7b91b3a1))
                    JSONArray(reply.json.a("uploaded").objects().map { it.getString("id") }).also { uploaded[cacheKey] = it }
                }
                if (media != null) inputs.put(f.s("key"), media) else inputs.remove(f.s("key"))
            }
            val body = obj("workflowId" to id, "code" to code, "inputs" to inputs).apply { codeType?.let { put("codeType", it) } }
            if (legacy) {
                body.put("revision", configuration.o("workflow").optInt("revision"))
                listOf("expectedResourceUpdatedAt", "expectedUnitId", "expectedUnitUpdatedAt").forEach { body.put(it, configuration.opt(it) ?: JSONObject.NULL) }
                report = configuration; reviewed = body
            } else {
                body.put("selectedResourceIds", JSONArray(selected))
                val response = api.call("stock/action-chains/preview", "POST", body)
                require(response.s("planHash").length == 64)
                report = response; reviewed = body.put("expectedPlanHash", response.s("planHash"))
            }
        } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message }
    }
    val auto = !legacy && config != null && targets.size == 1 && fields.isNotEmpty() && fields.all { f -> f.s("type", "select") in listOf("radio", "select") && f.a("options").objects().any { it.s("value") == values.s(f.s("key")) } } && config.a("actions").objects().any { it.s("type") == "assembly-build" && it.optBoolean("enabled", true) }
    LaunchedEffect(auto, values.toString(), targets.toString()) { if (auto && report == null && !model.busy) { delay(300); preview() } }
    Page {
        Heading(config?.s("name")?.ifBlank { config.o("workflow").s("name") } ?: L10n.text(R.string.ui_workflow_0560f3a1), config?.s("identifier") ?: code)
        error?.let { Notice(it, true) }
        if (config == null) { if (error == null) CircularProgressIndicator() else OutlinedButton(onClick = { load++ }) { Text(L10n.text(R.string.ui_retry_1b8b908f)) } }
        else if (report == null) {
            if (!legacy) config.a("targetGroups").objects().forEach { group ->
                val key = group.s("resourceId"); val options = group.a("options").objects().map { it.s("id") to it.s("name") }
                if (config.s("targetSelectionMode") != "all") Toggle(group.s("name"), targets.containsKey(key)) { enabled ->
                    if (!model.busy) targets = if (!enabled) targets - key else (if (config.s("targetSelectionMode") == "radio") emptyMap() else targets) + (key to options.first().first)
                } else Text(group.s("name"), style = MaterialTheme.typography.titleMedium)
                if (targets.containsKey(key)) Choice(L10n.text(R.string.ui_product_variant_dd64dd6d), targets[key].orEmpty(), options) { if (!model.busy) targets = targets + (key to it) }
            }
            if (legacy) Notice("${config.o("resource").s("name")}: ${config.s("quantityBefore")} → ${config.s("quantityAfter")}")
            fields.forEach { f ->
                val key = f.s("key"); val title = f.s("label") + if (f.optBoolean("required")) " *" else ""
                fun set(v: Any?) { if (!model.busy) values = values.copy().apply { if (v == null) remove(key) else put(key, v) } }
                when (f.s("type", "select")) {
                    "checkbox" -> Toggle(title, values.optBoolean(key)) { set(it) }
                    "radio" -> { Text(title); FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { f.a("options").objects().forEach { option ->
                        FilterChip(values.s(key) == option.s("value"), { set(option.s("value")) }, label = { Text(option.s("label")) }, leadingIcon = if (option.s("color").matches(Regex("#[0-9a-fA-F]{6}"))) ({ Box(Modifier.size(18.dp).background(Color(android.graphics.Color.parseColor(option.s("color"))), CircleShape)) }) else null)
                    } } }
                    "select" -> Choice(title, values.s(key), listOf("" to L10n.text(R.string.ui_please_select_fd148453)) + f.a("options").objects().map { it.s("value") to it.s("label") }) { set(it) }
                    "media", "file" -> OutlinedButton(enabled = !model.busy, onClick = { importing = key; picker.launch(if (f.s("type") == "media") arrayOf("image/*") else arrayOf("*/*")) }) { Text(L10n.text(R.string.ui_0_1_selected_3fee04f7, title, files[key]?.size ?: 0)) }
                    "number" -> { var draft by remember(key) { mutableStateOf(values.s(key)) }; TextInput(title, draft, { draft = it; set(it.replace(',', '.').toDoubleOrNull()?.takeIf(Double::isFinite)) }, true) }
                    else -> TextInput(title, values.s(key), { set(it) })
                }
            }
            Button(enabled = !model.busy, onClick = ::preview) { Text(L10n.text(R.string.ui_review_all_actions_4b9427c8)) }
        } else {
            if (complete) Notice(L10n.text(R.string.ui_all_actions_completed_successfully_f435be4a))
            if (!legacy) report!!.a("steps").objects().forEach { step -> ElevatedCard { Column(Modifier.padding(Spacing)) {
                Text(step.s("label"), style = MaterialTheme.typography.titleMedium)
                if (step.optBoolean("skipped")) Text(L10n.text(R.string.ui_skipped_a71273c6)) else {
                    Text(step.s("target")); if (step.has("quantityBefore")) Text(L10n.text(R.string.ui_stock_0_1_e8afd637, step.s("quantityBefore"), step.s("quantityAfter")))
                    if (step.has("statusAfter")) Text(L10n.text(R.string.ui_status_0_1_594266fa, step.s("statusBefore"), step.s("statusAfter")))
                    if (step.has("locationAfter")) Text(L10n.text(R.string.ui_location_0_1_ec3855f5, step.s("locationBefore"), step.s("locationAfter")))
                    if (step.s("code").isNotBlank()) Text(L10n.text(R.string.ui_code_0_411ad6dd, step.s("code")))
                    if (step.s("eventName").isNotBlank()) Text(L10n.text(R.string.ui_event_0_afe5e6f8, step.s("eventName")))
                    step.a("components").objects().forEach { c -> Text("${c.s("quantity")} × ${c.s("name")} ${c.a("codes").strings().joinToString()}") }
                    listOf("metadata", "customFields").forEach { group -> step.o(group).keys().forEach { key -> Text("$key: ${step.o(group).s(key)}") } }
                }
            } } } else Notice("${config.o("resource").s("name")}: ${config.s("quantityBefore")} → ${config.s("quantityAfter")}\n${config.s("statusBefore")} → ${config.s("statusAfter")}")
            if (!complete) {
                Notice(if (uncertain) L10n.text(R.string.ui_the_response_is_missing_please_send_the_615fe93b) else L10n.text(R.string.ui_all_steps_run_together_review_the_changes_80d3efd1))
                Button(enabled = !model.busy && api.session.allows("workflows.manage", "write"), onClick = { model.run {
                    try {
                        val response = model.mutate(api, if (legacy) "stock/scans/execute" else "stock/action-chains/execute", "POST", reviewed!!, true)
                        if (!legacy) report = response; complete = true; uncertain = false
                    } catch (e: ApiError) {
                        if (e.status == 409 && !e.retryable) { report = null; reviewed = null; uncertain = false; load++; error = L10n.text(R.string.ui_the_workflow_has_changed_please_check_again_0ab52c2d) }
                        else { uncertain = e.retryable; error = e.message }
                    } catch (e: Exception) { uncertain = true; error = e.message }
                } }) { Text(if (uncertain) L10n.text(R.string.ui_retry_confirmation_28f2f7ed) else L10n.text(R.string.ui_confirm_all_changes_1d0e068c)) }
                TextButton(enabled = !model.busy && !uncertain, onClick = { report = null; reviewed = null }) { Text(L10n.text(R.string.ui_edit_details_37e4d9e8)) }
            } else Button(onClick = back) { Text(L10n.text(R.string.ui_scan_another_code_583eca16)) }
        }
    }
}
