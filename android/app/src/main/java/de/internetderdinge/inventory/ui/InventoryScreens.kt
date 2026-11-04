@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.ImageLoader
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

val LocalInventoryImageLoader = staticCompositionLocalOf<ImageLoader> { error(L10n.text(R.string.ui_image_loader_is_not_initialized_d4bd5cbd)) }

@Composable fun ResourceImage(api: Api, url: String, modifier: Modifier = Modifier, description: String? = null) {
    val context = LocalContext.current
    val resolved = remember(url, api.session.context) { api.root.resolve(url) }
    val loader = LocalInventoryImageLoader.current
    if (url.isBlank() || resolved == null || (!resolved.isHttps && !Api.sameOrigin(api.root, resolved))) Box(modifier, contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Inventory2, description, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.primary) }
    else AsyncImage(model = ImageRequest.Builder(context).data(resolved.toString())
        .apply { if (Api.sameOrigin(api.root, resolved)) { addHeader("Authorization", "Bearer ${api.session.token}"); addHeader("X-Organization-ID", api.session.organization) } }
        .memoryCacheKey("${api.session.context}:$resolved").build(), imageLoader = loader, contentDescription = description,
        contentScale = ContentScale.Crop, modifier = modifier)
}
fun cover(resource: JSONObject) = resource.o("cover").s("url").ifEmpty { resource.a("media").objects().firstOrNull { it.s("kind") == "image" }?.s("url").orEmpty() }
@Composable fun ResourceRow(api: Api, resource: JSONObject, onClick: () -> Unit) {
    ListItem(modifier = Modifier.clickable(onClick = onClick), headlineContent = { Text(resource.s("name"), fontWeight = FontWeight.Medium) },
        supportingContent = { Text(listOf(resource.s("sku"), resource.s("location"), label(resource.s("status"))).filter { it.isNotBlank() }.joinToString(" · ")) },
        leadingContent = { ResourceImage(api, cover(resource), Modifier.size(64.dp).clip(RoundedCornerShape(14.dp))) },
        trailingContent = { Text(resource.s("quantity", ""), style = MaterialTheme.typography.titleMedium) })
}
@Composable fun InventoryScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var debounced by remember { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("") }
    var favorites by rememberSaveable { mutableStateOf(false) }
    var loanable by rememberSaveable { mutableStateOf(false) }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var filters by rememberSaveable { mutableStateOf(false) }
    var availableTypes by remember { mutableStateOf(types) }
    LaunchedEffect(api.session.context) {
        runCatching { api.call("inventory-types") }.onSuccess { data -> availableTypes = data.a("types").objects().filter { it.isNull("archivedAt") }.map { it.s("key") to it.s("label") } }
    }
    LaunchedEffect(query) { delay(300); debounced = query; page = 1 }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Heading(L10n.text(R.string.ui_your_inventory_ce20f971), api.session.capabilities.o("organization").s("name"))
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(L10n.text(R.string.ui_name_sku_tag_or_location_a7c32941)) },
                leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { IconButton(onClick = { filters = !filters }) { Icon(Icons.Outlined.Tune, L10n.text(R.string.ui_filter_638e249f)) } })
            if (filters) {
                Choice(L10n.text(R.string.ui_type_1b024183), type, listOf("" to L10n.text(R.string.ui_all_types_83162aa9)) + availableTypes) { type = it; page = 1 }
                Choice(L10n.text(R.string.ui_status_920e413c), status, listOf("" to L10n.text(R.string.ui_all_statuses_23ee74c4)) + statuses) { status = it; page = 1 }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(favorites, { favorites = !favorites; page = 1 }, { Text(L10n.text(R.string.ui_favorites_b4f83e2e)) })
                    FilterChip(loanable, { loanable = !loanable; page = 1 }, { Text(L10n.text(R.string.ui_lendable_bafed875)) })
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { navigate("camera/scan") }) { Icon(Icons.Outlined.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text(L10n.text(R.string.ui_scan_2a53b078)) }
                if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) Button(onClick = { navigate("camera/capture") }) { Icon(Icons.Outlined.AddAPhoto, null); Spacer(Modifier.width(8.dp)); Text(L10n.text(R.string.ui_capture_ef5c867a)) }
                if (api.session.allows("inventory.create", "write")) TextButton(onClick = { navigate("new") }) { Text(L10n.text(R.string.ui_manual_961cacaa)) }
            }
        }
        val params = buildMap { put("page", "$page"); put("pageSize", "24"); if (debounced.isNotBlank()) put("q", debounced); if (type.isNotBlank()) put("type", type); if (status.isNotBlank()) put("status", status); if (favorites) put("favorites", "true"); if (loanable) put("loanable", "true") }
        Box(Modifier.weight(1f)) { Remote(model, api, "resources", params) { data ->
            val resources = data.a("resources").objects()
            LazyColumn(contentPadding = PaddingValues(vertical = 16.dp)) {
                item {
                    val total = data.o("pagination").optInt("total")
                    Text("$total ${if (total == 1) "Eintrag" else "Einträge"}", Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.labelLarge)
                }
                if (resources.isEmpty()) item { Empty(L10n.text(R.string.ui_no_items_found_4f7ae92c), L10n.text(R.string.ui_adjust_the_search_or_capture_an_item_fccd3f8c)) }
                items(resources, key = { it.getString("id") }) { resource -> ResourceRow(api, resource) { navigate("resource/${resource.getString("id")}") } }
                item { Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { page-- }, enabled = page > 1) { Text(L10n.text(R.string.ui_previous_548611ce)) }
                    Text("$page / ${maxOf(1, data.o("pagination").optInt("pages"))}", Modifier.padding(12.dp))
                    TextButton(onClick = { page++ }, enabled = page < data.o("pagination").optInt("pages")) { Text(L10n.text(R.string.ui_next_1e14bdf3)) }
                } }
            }
        } }
    }
}
@Composable fun ResourceScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit, back: () -> Unit) {
    var delete by remember { mutableStateOf(false) }
    val context = LocalContext.current
    Remote(model, api, "resources/$id") { data ->
        val r = data.o("resource")
        val canEdit = api.session.allows("inventory.update", "write") && data.o("access").optBoolean("update", true)
        Page {
            if (cover(r).isNotBlank()) ResourceImage(api, cover(r), Modifier.fillMaxWidth().height(240.dp).clip(MaterialTheme.shapes.large), r.s("name"))
            Heading(r.s("name"), listOf(label(r.s("type")), label(r.s("status")), r.s("sku")).filter { it.isNotBlank() }.joinToString(" · "))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canEdit) Button(onClick = { navigate("edit/$id") }) { Text(L10n.text(R.string.ui_edit_84e45ee7)) }
                OutlinedButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "resources/$id/favorite", if (r.optBoolean("isFavorite")) "DELETE" else "PUT") } }) { Text(if (r.optBoolean("isFavorite")) L10n.text(R.string.ui_favorite_dacb6377) else L10n.text(R.string.ui_save_favorite_b1fffff7)) }
                TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, api.resourceLink(id)), L10n.text(R.string.ui_share_item_ab645f69))) }) { Text(L10n.text(R.string.ui_share_3050e581)) }
            }
            ElevatedCard(Modifier.fillMaxWidth()) { Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column { Text(L10n.text(R.string.ui_stock_82cb99ec), style = MaterialTheme.typography.labelLarge); Text(r.s("quantity", "0"), style = MaterialTheme.typography.headlineLarge) }
                Column { Text(L10n.text(R.string.ui_location_ecf34cc8), style = MaterialTheme.typography.labelLarge); Text(r.s("location", L10n.text(R.string.ui_not_set_080f77b2))) }
            } }
            if (r.s("description").isNotBlank()) Text(r.s("description"))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { r.a("tags").strings().forEach { SuggestionChip(onClick = {}, label = { Text(it) }) } }
            Section(L10n.text(R.string.ui_manage_9e2096cf)) {
                if (api.session.allows("stock.read")) LinkRow(L10n.text(R.string.ui_stock_units_a61769ad), L10n.text(R.string.ui_movements_minimum_stock_and_forecast_d328871b)) { navigate("stock/$id") }
                if (api.session.allows("assignments.read")) LinkRow(L10n.text(R.string.ui_loans_assignments_931054aa), L10n.text(R.string.ui_issue_reserve_return_a2262ddb)) { navigate("assignments/$id") }
                LinkRow(L10n.text(R.string.ui_media_0031e362), L10n.text(R.string.ui_files_0_98dcd6a9, r.a("media").length())) { navigate("media/$id") }
                LinkRow(L10n.text(R.string.ui_variants_741cba75)) { navigate("family/$id") }; LinkRow(L10n.text(R.string.ui_relationships_80a6bf24)) { navigate("relations/$id") }; LinkRow(L10n.text(R.string.ui_bill_of_materials_2a456394)) { navigate("bom/$id") }
                LinkRow(L10n.text(R.string.ui_translations_22c9ef6d)) { navigate("translations/$id") }
                if (canEdit) LinkRow(L10n.text(R.string.ui_ai_tools_ac717458), L10n.text(R.string.ui_analyze_research_generate_images_08c2b226)) { navigate("ai/$id") }
            }
            Section(L10n.text(R.string.ui_additional_details_66fb159b)) {
                listOf("serialNumber" to L10n.text(R.string.ui_serial_number_760abc3d), "barcode" to L10n.text(R.string.ui_barcode_a401f372), "notes" to L10n.text(R.string.ui_notes_7800bd53)).forEach { (key, title) -> if (r.s(key).isNotBlank()) Text("$title: ${r.s(key)}") }
                if (!r.isNull("valueCents")) Text(L10n.text(R.string.ui_value_2f_s_6450f84f).format(r.optDouble("valueCents") / 100, r.s("currency")))
                r.o("customFields").keys().forEach { key -> Text("$key: ${r.o("customFields").s(key)}") }
            }
            if (api.session.allows("inventory.delete", "write") && data.o("access").optBoolean("delete", true)) TextButton(onClick = { delete = true }) { Text(L10n.text(R.string.ui_delete_item_afd2099f), color = MaterialTheme.colorScheme.error) }
        }
        if (delete) Confirm(L10n.text(R.string.ui_delete_item_d8cef291), L10n.text(R.string.ui_0_will_be_permanently_deleted_93c7bb52, r.s("name")), model.busy, { delete = false }) { model.run { model.mutate(api, "resources/$id", "DELETE"); back() } }
    }
}

@Composable fun ResourcePicker(model: AppModel, api: Api, title: String = L10n.text(R.string.ui_select_item_cbcea774), exclude: Set<String> = emptySet(), onDismiss: () -> Unit, onPick: (JSONObject) -> Unit) {
    var query by remember { mutableStateOf("") }
    var debounced by remember { mutableStateOf("") }
    var page by remember { mutableIntStateOf(1) }
    LaunchedEffect(query) { delay(250); debounced = query; page = 1 }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(.94f).fillMaxHeight(.85f), shape = MaterialTheme.shapes.extraLarge) {
            Column(Modifier.padding(16.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                TextInput(L10n.text(R.string.ui_search_dd097e77), query, { query = it })
                Box(Modifier.weight(1f)) { Remote(model, api, "resources", mapOf("q" to debounced, "pageSize" to "30", "page" to "$page")) { data ->
                    LazyColumn { items(data.a("resources").objects().filter { it.s("id") !in exclude }) { r -> ResourceRow(api, r) { onPick(r) } }
                        item { Row { TextButton(enabled = page > 1, onClick = { page-- }) { Text(L10n.text(R.string.ui_previous_548611ce)) }; TextButton(enabled = page < data.o("pagination").optInt("pages"), onClick = { page++ }) { Text(L10n.text(R.string.ui_next_1e14bdf3)) } } } }
                } }
                TextButton(onClick = onDismiss) { Text(L10n.text(R.string.ui_cancel_f7ff1178)) }
            }
        }
    }
}
