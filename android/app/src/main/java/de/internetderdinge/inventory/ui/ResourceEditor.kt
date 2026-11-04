package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.json.JSONObject

@Composable fun ResourceEditor(model: AppModel, api: Api, id: String?, back: () -> Unit) {
    if (id == null) EditResource(model, api, null, obj("name" to "", "type" to "object", "status" to "available", "quantity" to 1, "currency" to "EUR", "priority" to 3), back)
    else Remote(model, api, "resources/$id") { EditResource(model, api, id, it.o("resource"), back) }
}
@Composable private fun EditResource(model: AppModel, api: Api, id: String?, original: JSONObject, back: () -> Unit) {
    var draft by rememberJson(id) { original.copy() }
    var definitions by remember { mutableStateOf(emptyList<JSONObject>()) }
    var typeOptions by remember { mutableStateOf(types) }
    var error by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var related by remember { mutableStateOf(original.a("relatedResourceIds").strings()) }
    LaunchedEffect(api.session.context) {
        try {
            typeOptions = api.call("inventory-types").a("types").objects().filter { it.isNull("archivedAt") || it.s("key") == original.s("type") }.map { it.s("key") to it.s("label") }
            definitions = api.call("custom-fields", query = mapOf("entityType" to "inventory")).a("definitions").objects()
        } catch (e: Exception) { error = e.message }
    }
    fun set(key: String, value: Any?) { draft = draft.copy().put(key, value ?: JSONObject.NULL) }
    Page {
        Heading(if (id == null) L10n.text(R.string.ui_new_item_c325efcf) else L10n.text(R.string.ui_edit_item_b32de8f2))
        error?.let { Notice(it, true) }
        Section(L10n.text(R.string.ui_basic_details_88a7fe09)) {
            TextInput(L10n.text(R.string.ui_name_862fead0), draft.s("name"), { set("name", it) })
            Choice(L10n.text(R.string.ui_type_1b024183), draft.s("type"), typeOptions) { set("type", it) }
            Choice(L10n.text(R.string.ui_status_920e413c), draft.s("status"), statuses) { set("status", it) }
            TextInput(L10n.text(R.string.ui_description_e9262f00), draft.s("description"), { set("description", it) }, lines = 4)
            TextInput("SKU", draft.s("sku"), { set("sku", it) }); TextInput(L10n.text(R.string.ui_barcode_a401f372), draft.s("barcode"), { set("barcode", it) })
            TextInput(L10n.text(R.string.ui_serial_number_760abc3d), draft.s("serialNumber"), { set("serialNumber", it) }); TextInput(L10n.text(R.string.ui_location_ecf34cc8), draft.s("location"), { set("location", it) })
            if (id == null) TextInput(L10n.text(R.string.ui_initial_stock_f03906a7), draft.s("quantity"), { set("quantity", it) }, number = true)
        }
        Section(L10n.text(R.string.ui_organization_350be364)) {
            TextInput(L10n.text(R.string.ui_tags_separated_by_commas_c5a24eba), draft.a("tags").strings().joinToString(", "), { set("tags", JSONArray(it.split(',').map(String::trim))) })
            TextInput(L10n.text(R.string.ui_categories_separated_by_commas_1d6971a9), draft.a("categories").objects().joinToString(", ") { it.s("name") }, { text ->
                set("categories", JSONArray(text.split(',').map { name -> original.a("categories").objects().firstOrNull { it.s("name") == name.trim() } ?: obj("name" to name.trim()) }))
            })
            TextInput(L10n.text(R.string.ui_link_aliases_separated_by_commas_32dab078), draft.a("slugs").strings().joinToString(", "), { set("slugs", JSONArray(it.split(',').map(String::trim))) })
            Choice(L10n.text(R.string.ui_priority_787e02f4), draft.s("priority"), (1..5).map { "$it" to "$it" }) { set("priority", it) }
            TextInput(L10n.text(R.string.ui_value_in_cents_265c0d4a), draft.s("valueCents"), { set("valueCents", it) }, number = true)
            TextInput(L10n.text(R.string.ui_currency_3bdd23b6), draft.s("currency"), { set("currency", it.uppercase()) })
            TextInput(L10n.text(R.string.ui_notes_7800bd53), draft.s("notes"), { set("notes", it) }, lines = 3)
        }
        Section(L10n.text(R.string.ui_custom_fields_30214611)) {
            val visible = definitions.filter { d -> (d.a("resourceTypes").length() == 0 || draft.s("type") in d.a("resourceTypes").strings()) &&
                (d.a("categories").length() == 0 || draft.a("categories").objects().any { it.s("name") in d.a("categories").strings() }) }
            visible.forEach { definition -> CustomField(model, api, definition, draft.o("customFields")) { values -> set("customFields", values) } }
            if (visible.isEmpty()) Text(L10n.text(R.string.ui_no_additional_fields_are_defined_for_this_23c2bc58))
        }
        Section(L10n.text(R.string.ui_linked_items_802ad3d9)) {
            related.forEach { resourceId -> Row { Text(resourceId, Modifier.weight(1f)); TextButton(onClick = { related = related - resourceId }) { Text(L10n.text(R.string.ui_remove_3828375a)) } } }
            OutlinedButton(onClick = { picking = true }) { Text(L10n.text(R.string.ui_link_item_092dcf01)) }
        }
        Section("GPS") {
            TextInput(L10n.text(R.string.ui_latitude_c5049879), draft.s("gpsLatitude"), { set("gpsLatitude", it) }, true)
            TextInput(L10n.text(R.string.ui_longitude_4c9aacde), draft.s("gpsLongitude"), { set("gpsLongitude", it) }, true)
            TextInput(L10n.text(R.string.ui_altitude_in_meters_5e8e9876), draft.s("gpsAltitude"), { set("gpsAltitude", it) }, true)
        }
        Button(modifier = Modifier.fillMaxWidth(), enabled = !model.busy && draft.s("name").isNotBlank(), onClick = {
            try {
                val result = draft.copy()
                val custom = result.o("customFields").copy()
                definitions.filter { it.s("fieldType") == "number" }.forEach { field ->
                    val key = field.s("key")
                    if (custom.has(key)) {
                        val value = custom.s(key).replace(',', '.').toDoubleOrNull()
                        require(value != null && value.isFinite()) { L10n.text(R.string.ui_0_please_enter_a_valid_number_55c7b88c, field.s("label")) }
                        require(field.isNull("minValue") || value >= field.optDouble("minValue")) { L10n.text(R.string.ui_0_value_is_too_small_fe39b811, field.s("label")) }
                        require(field.isNull("maxValue") || value <= field.optDouble("maxValue")) { L10n.text(R.string.ui_0_value_is_too_large_569227c8, field.s("label")) }
                        custom.put(key, value)
                    }
                }
                if (result.has("customFields")) result.put("customFields", custom)
                listOf("quantity", "valueCents", "priority").forEach { key -> if (result.has(key)) result.put(key, result.s(key).takeIf { it.isNotBlank() }?.toInt() ?: JSONObject.NULL) }
                listOf("gpsLatitude", "gpsLongitude", "gpsAltitude").forEach { key -> if (result.has(key)) result.put(key, result.s(key).replace(',', '.').takeIf { it.isNotBlank() }?.toDouble()?.also { require(it.isFinite()) } ?: JSONObject.NULL) }
                require(result.isNull("gpsLatitude") == result.isNull("gpsLongitude")) { L10n.text(R.string.ui_provide_latitude_and_longitude_together_b22887ac) }
                listOf("sku", "barcode", "serialNumber", "location").forEach { key -> if (result.s(key).isBlank()) result.put(key, JSONObject.NULL) }
                listOf("tags", "slugs").forEach { key -> result.put(key, JSONArray(result.a(key).strings().filter { it.isNotBlank() }.distinct())) }
                result.put("categories", JSONArray(result.a("categories").objects().filter { it.s("name").isNotBlank() }))
                result.put("relatedResourceIds", JSONArray(related))
                val writable = setOf("name", "slugs", "description", "type", "status", "sku", "barcode", "quantity", "location", "serialNumber", "valueCents", "currency", "priority", "tags", "categories", "customFields", "relatedResourceIds", "gpsLatitude", "gpsLongitude", "gpsAltitude", "notes")
                val payload = obj()
                result.keys().forEach { key -> if (key in writable && (id == null || key != "quantity") && (id == null || canonical(result.opt(key)) != canonical(original.opt(key)))) payload.put(key, result.opt(key)) }
                model.run { model.mutate(api, if (id == null) "resources" else "resources/$id", if (id == null) "POST" else "PATCH", payload, idempotent = id == null); back() }
            } catch (e: Exception) { error = e.message ?: L10n.text(R.string.ui_please_check_the_numbers_8d897dcb) }
        }) { Text(L10n.text(R.string.ui_save_f6b2ff39)) }
    }
    if (picking) ResourcePicker(model, api, exclude = related.toSet() + listOfNotNull(id), onDismiss = { picking = false }) { related = related + it.getString("id"); picking = false }
}

@Composable private fun CustomField(model: AppModel, api: Api, field: JSONObject, values: JSONObject, onChange: (JSONObject) -> Unit) {
    val key = field.s("key")
    val title = field.s("label") + if (field.optBoolean("required")) " *" else ""
    fun set(value: Any?) { onChange(values.copy().apply { if (value == null) remove(key) else put(key, value) }) }
    var reference by remember { mutableStateOf(false) }
    when (field.s("fieldType")) {
        "boolean" -> Toggle(title, values.optBoolean(key)) { set(it) }
        "select" -> Choice(title, values.s(key), listOf("" to L10n.text(R.string.ui_no_selection_146bfc6e)) + field.a("options").objects().map { it.s("value") to it.s("label") }) { set(it.takeIf(String::isNotEmpty)) }
        "multi_select" -> {
            Text(title)
            field.a("options").objects().forEach { option -> val selected = values.a(key).strings(); Toggle(option.s("label"), option.s("value") in selected) { checked -> set(JSONArray(if (checked) selected + option.s("value") else selected - option.s("value"))) } }
        }
        "reference" -> { OutlinedButton(onClick = { reference = true }) { Text("$title: ${values.s(key).ifBlank { L10n.text(R.string.ui_select_0bf1eddb) }}") }; TextButton(onClick = { set(null) }) { Text(L10n.text(R.string.ui_clear_selection_61f1caee)) } }
        "number" -> {
            TextInput(title, values.s(key), { set(it.takeIf(String::isNotBlank)) }, true)
        }
        else -> TextInput(title + when (field.s("fieldType")) { "date" -> L10n.text(R.string.ui_yyyy_mm_dd_d2cbb853); "datetime" -> L10n.text(R.string.ui_iso_date_and_time_dd91648f); else -> "" }, values.s(key), { set(it.takeIf(String::isNotEmpty)) }, lines = if (field.s("fieldType") == "textarea") 3 else 1)
    }
    if (field.s("description").isNotBlank()) Text(field.s("description"), style = MaterialTheme.typography.bodySmall)
    if (reference) {
        var query by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { reference = false }, title = { Text(title) }, text = { Column {
            TextInput(L10n.text(R.string.ui_search_dd097e77), query, { query = it })
            Box(Modifier.heightIn(max = 300.dp)) { Remote(model, api, "custom-fields/${field.s("id")}/options", mapOf("q" to query)) { data ->
                androidx.compose.foundation.lazy.LazyColumn { items(data.a("options").length()) { index -> val option = data.a("options").getJSONObject(index)
                    LinkRow(option.s("label"), option.s("description")) { set(if (field.optBoolean("referenceMultiple")) JSONArray((values.a(key).strings() + option.s("id")).distinct()) else option.s("id")); reference = false }
                } }
            } }
        } }, confirmButton = { TextButton(onClick = { reference = false }) { Text(L10n.text(R.string.ui_done_25d52d7e)) } })
    }
}
