package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.AccountCircle
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
    val context = LocalContext.current
    var server by rememberSaveable { mutableStateOf(model.preferences.getString("server", "") ?: "") }
    var email by rememberSaveable { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var token by remember { mutableStateOf("") }
    var expert by rememberSaveable { mutableStateOf(false) }
    var options by remember { mutableStateOf<AuthOptions?>(null) }
    var optionsServer by remember { mutableStateOf("") }
    var checkingOptions by remember { mutableStateOf(false) }
    var optionsFailed by remember { mutableStateOf(false) }
    var optionsRetry by remember { mutableIntStateOf(0) }
    var privateSession by rememberSaveable { mutableStateOf(false) }
    val currentOptions = options.takeIf { optionsServer == server }
    LaunchedEffect(server, optionsRetry) {
        options = null; optionsServer = server; checkingOptions = false; optionsFailed = false
        val root = runCatching { Api.normalizeServer(server) }.getOrNull() ?: return@LaunchedEffect
        checkingOptions = true
        try {
            delay(400)
            val result = kotlinx.coroutines.withTimeout(15_000) { AuthOptions.from(Api(Session(root, "", "", "", obj())).call("auth/options")) }
            if (optionsServer == server) options = result
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) { optionsFailed = true }
        catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { optionsFailed = true }
        finally { checkingOptions = false }
    }
    Page {
        Spacer(Modifier.height(32.dp)); Icon(Icons.Outlined.Inventory2, null, Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
        Heading(L10n.text(R.string.ui_everything_in_its_place_19bc5baf), L10n.text(R.string.ui_connect_to_your_inventory_server_74638c95))
        TextInput(L10n.text(R.string.ui_server_address_b155d50f), server, { server = it })
        if (model.session == null && model.savedAccounts.isNotEmpty()) AccountSwitcher(model) { }
        if (checkingOptions) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (optionsFailed) {
            Text(L10n.text(R.string.ui_sign_in_options_unavailable), style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { optionsRetry++ }) { Text(L10n.text(R.string.ui_retry_session)) }
        }
        if (currentOptions?.browserSignIn == true && currentOptions.providers.isNotEmpty()) {
            OutlinedButton(onClick = {
                model.startBrowserSignIn(server) { url ->
                    val browserPackage = CustomTabsClient.getPackageName(context, emptyList())
                        ?: error(L10n.text(R.string.ui_browser_sign_in_unavailable))
                    check(!privateSession || CustomTabsClient.isEphemeralBrowsingSupported(context, browserPackage)) {
                        L10n.text(R.string.ui_private_browser_unavailable)
                    }
                    CustomTabsIntent.Builder().setShowTitle(true).setEphemeralBrowsingEnabled(privateSession).build()
                        .apply { intent.setPackage(browserPackage) }.launchUrl(context, Uri.parse(url))
                }
            }, enabled = !model.busy && !model.credentialLoadFailed, modifier = Modifier.fillMaxWidth()) {
                Text(if (currentOptions.providers.size == 1) L10n.text(R.string.ui_sign_in_with_provider, currentOptions.providers.single().second) else L10n.text(R.string.ui_browser_sign_in))
            }
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(privateSession, { privateSession = it }, enabled = !model.busy)
                Text(L10n.text(R.string.ui_browser_sign_in_other_account))
            }
        }
        if (!expert && currentOptions?.passwordEnabled != false) {
            TextInput(L10n.text(R.string.ui_email_2fae6fb3), email, { email = it })
            OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text(L10n.text(R.string.ui_password_a36c1015)) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        } else if (expert) OutlinedTextField(token, { token = it }, Modifier.fillMaxWidth(), label = { Text(L10n.text(R.string.ui_api_token_5efaaeee)) }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        Button(onClick = { model.login(server, email, password, if (expert) token else "") }, enabled = !model.busy && server.isNotBlank() && (if (expert) token.isNotBlank() else currentOptions?.passwordEnabled != false && email.isNotBlank() && password.isNotBlank()), modifier = Modifier.fillMaxWidth()) { Text(if (model.busy) L10n.text(R.string.ui_connecting_d763d79a) else L10n.text(R.string.ui_sign_in_a329a322)) }
        TextButton(onClick = { expert = !expert }) { Text(if (expert) L10n.text(R.string.ui_sign_in_with_email_83457197) else L10n.text(R.string.ui_expert_option_api_token_0eb53cb4)) }
        OutlinedButton(onClick = { model.login("https://demo.openinventory.polyxo.de", "", "", "inv_demo_public_openinventory") }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text(L10n.text(R.string.ui_try_the_demo_b632930d)) }
        Text(L10n.text(R.string.ui_view_public_sample_data_changes_and_uploads_bc2650dd), style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://openinventory.polyxo.de/${if (L10n.language == "de") "de/" else ""}app/privacy"))) }) { Text(L10n.text(R.string.ui_privacy_f624fcf0)) }
        Text(L10n.text(R.string.ui_your_credentials_are_stored_encrypted_using_the_c3fb972f), style = MaterialTheme.typography.bodySmall)
    }
}
@Composable fun AccountSwitcher(model: AppModel, addAccount: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, enabled = !model.busy && !model.credentialLoadFailed) {
            Icon(Icons.Outlined.AccountCircle, L10n.text(R.string.ui_accounts_organizations))
        }
        DropdownMenu(expanded, { expanded = false }) {
            model.savedAccounts.forEach { account ->
                Text("${account.label} · ${account.server}", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelSmall)
                val organizations = account.capabilities.a("organizations").objects()
                if (organizations.isEmpty()) DropdownMenuItem(text = { Text(account.label.ifEmpty { account.server }) }, onClick = { expanded = false; model.switchAccount(account.accountId) })
                else organizations.forEach { organization ->
                    DropdownMenuItem(text = { Text(organization.s("name")) }, onClick = {
                        expanded = false; model.switchAccount(account.accountId, organization.s("id"))
                    })
                }
            }
            HorizontalDivider()
            DropdownMenuItem(text = { Text(L10n.text(R.string.ui_add_account)) }, onClick = { expanded = false; addAccount() })
        }
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
        Heading(L10n.text(R.string.ui_your_workspace_602e2f2e), api.session.capabilities.o("organization").s("name"))
        Section(L10n.text(R.string.ui_account_df852501)) {
            AccountSwitcher(model) { navigate("login") }
            Text(api.session.capabilities.s("name")); Text(api.session.server, style = MaterialTheme.typography.bodySmall)
            Choice(L10n.text(R.string.ui_organization_350be364), api.session.organization, organizations.map { it.s("id") to it.s("name") }) { if (!model.busy) model.switchOrganization(it) }
            if (api.session.capabilities.o("organization").optBoolean("isReadOnly")) Notice(L10n.text(R.string.ui_this_workspace_is_read_only_ca669940))
        }
        Section(L10n.text(R.string.ui_activity_46f08d7f)) {
            LinkRow(L10n.text(R.string.ui_uploads_pending_operations_27e3f08e)) { navigate("jobs") }
            LinkRow(L10n.text(R.string.ui_notifications_f7205df4)) { navigate("notifications") }
            if (api.session.allows("assignments.read")) LinkRow(L10n.text(R.string.ui_loans_reservations_8cafe909)) { navigate("loans") }
            if (api.session.allows("requests.read")) LinkRow(L10n.text(R.string.ui_internal_requests_32dc9d5c)) { navigate("requests") }
        }
        Section(L10n.text(R.string.ui_images_ai_33734513)) {
            Choice(L10n.text(R.string.ui_maximum_photo_size_a47e72bb), uploadSize, listOf(1024, 1600, 2200, 4096).map { "$it" to L10n.text(R.string.ui_0_pixels_ef5e7378, it) }) { uploadSize = it; model.setSetting("uploadSize", it) }
            if (api.session.allows("ai.images", "ai")) {
                Choice(L10n.text(R.string.ui_image_model_04f87c78), imageModel, listOf("" to L10n.text(R.string.ui_server_default_67fd1f92)) + models.map { it.s("id") to it.s("label") }) { imageModel = it; model.setSetting("model", it) }
                Choice(L10n.text(R.string.ui_ai_image_size_7fe249c5), coverSize, listOf(1024, 2048, 4096).map { "$it" to L10n.text(R.string.ui_0_pixels_ef5e7378, it) }) { coverSize = it; model.setSetting("coverSize", it) }
                models.firstOrNull { it.s("id") == imageModel }?.o("estimatedCostsBySize")?.o(coverSize)?.let { if (it.has("maximumUsd")) Text(L10n.text(R.string.ui_estimated_image_cost_0_1_usd_1983c381, it.s("minimumUsd"), it.s("maximumUsd")), style = MaterialTheme.typography.bodySmall) }
            }
            if (api.session.allows("ai.analyze", "ai")) LinkRow(L10n.text(R.string.ui_custom_analysis_instruction_3d14c319), L10n.text(R.string.ui_leave_empty_for_server_default_4490ea75)) { prompt = "analysisPrompt" }
            if (api.session.allows("ai.images", "ai")) LinkRow(L10n.text(R.string.ui_custom_cover_instruction_7045feaf), L10n.text(R.string.ui_leave_empty_for_server_default_4490ea75)) { prompt = "coverPrompt" }
            if (api.session.allows("ai.images", "ai")) LinkRow(L10n.text(R.string.ui_transparent_cover_instruction_aeb9649d), L10n.text(R.string.ui_leave_empty_for_server_default_4490ea75)) { prompt = "transparentCoverPrompt" }
            if (api.session.allows("roles.manage", "admin")) LinkRow(L10n.text(R.string.ui_organization_ai_defaults_c446f097)) { navigate("ai-settings") }
        }
        Section(L10n.text(R.string.ui_workspace_6a85b576)) {
            LinkRow(L10n.text(R.string.ui_inventory_types_d81903f7)) { navigate("references/inventory-types") }; LinkRow(L10n.text(R.string.ui_custom_fields_30214611)) { navigate("references/custom-fields") }; LinkRow(L10n.text(R.string.ui_relationship_types_dbff9fd8)) { navigate("references/relation-types") }
            LinkRow(L10n.text(R.string.ui_server_permissions_30e927ac)) { navigate("references/capabilities") }
            LinkRow(L10n.text(R.string.ui_system_status_8d5cb1ee), L10n.text(R.string.ui_storage_ai_and_authentication_06537345)) { navigate("references/runtime") }
            if (api.session.allows("workflows.read")) LinkRow(L10n.text(R.string.ui_workflows_827ed1e2), L10n.text(R.string.ui_run_in_scanner_83d0a4ce)) { navigate("camera/scan") }
        }
        Section(L10n.text(R.string.ui_web_29751047)) {
            if (api.session.allows("workflows.manage", "write")) LinkRow(L10n.text(R.string.ui_edit_workflows_4789113d), L10n.text(R.string.ui_open_web_editor_5ef6e084)) { web("${api.session.capabilities.o("organization").s("slug")}/settings/action-flows") }
            LinkRow(L10n.text(R.string.ui_server_settings_c9877bd0)) { web("settings") }; LinkRow(L10n.text(R.string.ui_api_documentation_7b2502db)) { web("api-docs") }
        }
        Section(L10n.text(R.string.ui_open_inventory_166dbd73)) {
            LinkRow(L10n.text(R.string.ui_privacy_f624fcf0)) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://openinventory.polyxo.de/${if (L10n.language == "de") "de/" else ""}app/privacy"))) }
            LinkRow(L10n.text(R.string.ui_help_contact_5109b38a)) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://openinventory.polyxo.de/${if (L10n.language == "de") "de/" else ""}app/support"))) }
        }
        Section("Android") { Text(L10n.text(R.string.ui_native_interface_with_material_3_existing_room_b68f1962)) }
        TextButton(onClick = { logout = true }) { Text(L10n.text(R.string.ui_sign_out_545f8be3)) }
    }
    prompt?.let { key -> FormDialog(L10n.text(R.string.ui_custom_ai_instruction_3ec489fa), listOf(Field("prompt", L10n.text(R.string.ui_instruction_e1812557), "multiline")), obj("prompt" to model.setting(key)), onDismiss = { prompt = null }) { model.setSetting(key, it.s("prompt").trim()); prompt = null } }
    if (logout) Confirm(L10n.text(R.string.ui_sign_out_e42d9391), L10n.text(R.string.ui_uploads_remain_saved_locally_and_can_be_220e9161), model.busy, { logout = false }) { model.logout() }
}

@Composable fun JobsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var jobs by remember { mutableStateOf(model.app.store.jobs(api.session.context)) }
    var operations by remember { mutableStateOf(model.app.store.operations(api.session.context)) }
    var remove by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(api.session.context, model.revision) { while (true) { jobs = model.app.store.jobs(api.session.context); operations = model.app.store.operations(api.session.context); delay(1500) } }
    Page {
        Heading(L10n.text(R.string.ui_uploads_pending_operations_27e3f08e))
        if (jobs.isEmpty() && operations.isEmpty()) Empty(L10n.text(R.string.ui_all_done_2fa1e634), L10n.text(R.string.ui_new_uploads_and_interrupted_operations_appear_here_8bb31766))
        jobs.forEach { job -> ElevatedCard { Column(Modifier.padding(Spacing)) {
            Text(job.o("resource").s("name", L10n.text(R.string.ui_media_upload_ca85cac7)), style = MaterialTheme.typography.titleMedium)
            Text(L10n.text(R.string.ui_0_step_1_4_d087bd44, label(job.s("status")), job.optInt("stage")))
            if (job.s("error").isNotBlank()) Text(job.s("error"))
            if (job.s("resourceId").isNotBlank()) TextButton(onClick = { navigate("resource/${job.s("resourceId")}") }) { Text(L10n.text(R.string.ui_open_item_1d55cb86)) }
            if (job.s("status") in listOf("error", "paused")) TextButton(onClick = { model.app.queue.schedule(job.s("id")) }) { Text(L10n.text(R.string.ui_retry_948643cb)) }
            if (job.s("status") in listOf("done", "error", "paused")) TextButton(onClick = { remove = job.s("id") }) { Text(L10n.text(R.string.ui_remove_locally_e33caa84)) }
        } } }
        operations.forEach { operation -> ElevatedCard { Column(Modifier.padding(Spacing)) {
            Text(L10n.text(R.string.ui_unconfirmed_operation_6b32f094), style = MaterialTheme.typography.titleMedium)
            Text(operationName(operation.s("path")))
            OperationSummary(operation.o("body"))
            Text(L10n.text(R.string.ui_the_server_response_is_missing_retrying_uses_73e36bf8), style = MaterialTheme.typography.bodySmall)
            Button(enabled = !model.busy, onClick = { model.run { model.retryOperation(api, operation) } }) { Text(L10n.text(R.string.ui_retrieve_result_safely_15af0330)) }
        } } }
    }
    remove?.let { id -> Confirm(L10n.text(R.string.ui_remove_local_upload_647d3963), L10n.text(R.string.ui_photos_not_yet_uploaded_will_be_deleted_83f94435), onDismiss = { remove = null }) { model.app.store.removeJob(id); remove = null; model.revision++ } }
}
fun operationName(path: String) = when { path.contains("action-chains") -> L10n.text(R.string.ui_workflow_0560f3a1); path.contains("movements") -> L10n.text(R.string.ui_stock_transaction_abdfad57); path.contains("assignments") -> L10n.text(R.string.ui_loan_or_return_59ee011c); path.contains("analyze") -> L10n.text(R.string.ui_ai_analysis_5684fb9f); path.contains("cover") || path.endsWith("image") -> L10n.text(R.string.ui_image_generation_f9282431); path.contains("research") -> L10n.text(R.string.ui_research_a12b73cf); path.contains("internal-requests") -> L10n.text(R.string.ui_internal_request_2ffd3fae); else -> L10n.text(R.string.ui_inventory_item_19f47c8a) }
@Composable fun OperationSummary(body: JSONObject) {
    listOf("name" to L10n.text(R.string.ui_name_dcd1d522), "delta" to L10n.text(R.string.ui_stock_change_1c77e2d6), "quantity" to L10n.text(R.string.ui_quantity_1bece813), "note" to L10n.text(R.string.ui_note_74b487d9), "code" to L10n.text(R.string.ui_code_340f4630), "status" to L10n.text(R.string.ui_status_920e413c)).forEach { (key, title) -> if (body.s(key).isNotBlank()) Text("$title: ${body.s(key)}") }
}

@Composable fun ReferenceScreen(model: AppModel, api: Api, kind: String) {
    if (kind == "runtime") {
        var data by remember { mutableStateOf<JSONObject?>(null) }; var error by remember { mutableStateOf<String?>(null) }; var reload by remember { mutableIntStateOf(0) }
        LaunchedEffect(reload) { try { data = api.runtimeSettings(); error = null } catch (e: Exception) { error = e.message } }
        Page {
            Heading(L10n.text(R.string.ui_system_status_8d5cb1ee))
            data?.let { d ->
                Section(L10n.text(R.string.ui_storage_4a6d2dcf)) { Text(d.o("storage").s("provider")); Text(if (d.o("storage").optBoolean("configured")) L10n.text(R.string.ui_configured_dbac85c1) else L10n.text(R.string.ui_not_configured_2fed0df5)) }
                Section(L10n.text(R.string.ui_ai_fd184691)) { Text(L10n.text(R.string.ui_analysis_0_04431768, if (d.o("ai").optBoolean("analysis")) L10n.text(R.string.ui_available_3aa55273) else L10n.text(R.string.ui_not_configured_2fed0df5))); Text(L10n.text(R.string.ui_image_generation_0_9f3d03cc, if (d.o("ai").optBoolean("imageGeneration")) L10n.text(R.string.ui_available_3aa55273) else L10n.text(R.string.ui_not_configured_2fed0df5))); Text(d.o("ai").s("imageProvider")) }
                Section(L10n.text(R.string.ui_authentication_32ddf6ae)) { d.o("auth").a("providers").objects().forEach { Text(it.s("name")) }; Text(L10n.text(R.string.ui_password_0_3ba2e972, if (d.o("auth").optBoolean("password")) L10n.text(R.string.ui_active_8163454f) else L10n.text(R.string.ui_disabled_bf7c9171))) }
            }
            error?.let { Notice(it, true) }; OutlinedButton(onClick = { reload++ }) { Text(L10n.text(R.string.ui_refresh_96bf0098)) }
        }
    } else if (kind == "capabilities") Page {
        Heading(L10n.text(R.string.ui_server_access_cabfaaf0), api.session.server)
        Text(L10n.text(R.string.ui_account_0_985b0e8f, api.session.capabilities.s("name")))
        Section(L10n.text(R.string.ui_permissions_036b749f)) { api.session.capabilities.a("permissions").strings().forEach { Text(it) } }
        Section(L10n.text(R.string.ui_token_scopes_62e9cb28)) { api.session.capabilities.a("scopes").strings().forEach { Text(it) } }
    } else Remote(model, api, kind) { data -> Page {
        Heading(when (kind) { "inventory-types" -> L10n.text(R.string.ui_inventory_types_d81903f7); "custom-fields" -> L10n.text(R.string.ui_custom_fields_30214611); else -> L10n.text(R.string.ui_relationship_types_dbff9fd8) })
        val key = when (kind) { "inventory-types" -> "types"; "custom-fields" -> "definitions"; else -> "relationTypes" }
        data.a(key).objects().forEach { item -> ListItem(headlineContent = { Text(item.s("label")) }, supportingContent = { Text(item.s("description").ifEmpty { label(item.s("fieldType")) }) }) }
    } }
}
