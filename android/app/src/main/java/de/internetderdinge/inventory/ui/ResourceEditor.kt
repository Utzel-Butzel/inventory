package de.internetderdinge.inventory.ui

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
        Heading(if (id == null) "Neuer Eintrag" else "Eintrag bearbeiten")
        error?.let { Notice(it, true) }
        Section("Grunddaten") {
            TextInput("Name *", draft.s("name"), { set("name", it) })
            Choice("Typ", draft.s("type"), typeOptions) { set("type", it) }
            Choice("Status", draft.s("status"), statuses) { set("status", it) }
            TextInput("Beschreibung", draft.s("description"), { set("description", it) }, lines = 4)
            TextInput("SKU", draft.s("sku"), { set("sku", it) }); TextInput("Barcode", draft.s("barcode"), { set("barcode", it) })
            TextInput("Seriennummer", draft.s("serialNumber"), { set("serialNumber", it) }); TextInput("Standort", draft.s("location"), { set("location", it) })
            if (id == null) TextInput("Anfangsbestand", draft.s("quantity"), { set("quantity", it) }, number = true)
        }
        Section("Organisation") {
            TextInput("Tags, mit Komma trennen", draft.a("tags").strings().joinToString(", "), { set("tags", JSONArray(it.split(',').map(String::trim))) })
            TextInput("Kategorien, mit Komma trennen", draft.a("categories").objects().joinToString(", ") { it.s("name") }, { text ->
                set("categories", JSONArray(text.split(',').map { name -> original.a("categories").objects().firstOrNull { it.s("name") == name.trim() } ?: obj("name" to name.trim()) }))
            })
            TextInput("Link-Aliasse, mit Komma trennen", draft.a("slugs").strings().joinToString(", "), { set("slugs", JSONArray(it.split(',').map(String::trim))) })
            Choice("Priorität", draft.s("priority"), (1..5).map { "$it" to "$it" }) { set("priority", it) }
            TextInput("Wert in Cent", draft.s("valueCents"), { set("valueCents", it) }, number = true)
            TextInput("Währung", draft.s("currency"), { set("currency", it.uppercase()) })
            TextInput("Notizen", draft.s("notes"), { set("notes", it) }, lines = 3)
        }
        Section("Benutzerdefinierte Felder") {
            val visible = definitions.filter { d -> (d.a("resourceTypes").length() == 0 || draft.s("type") in d.a("resourceTypes").strings()) &&
                (d.a("categories").length() == 0 || draft.a("categories").objects().any { it.s("name") in d.a("categories").strings() }) }
            visible.forEach { definition -> CustomField(model, api, definition, draft.o("customFields")) { values -> set("customFields", values) } }
            if (visible.isEmpty()) Text("Für diesen Typ sind keine zusätzlichen Felder definiert.")
        }
        Section("Verknüpfte Einträge") {
            related.forEach { resourceId -> Row { Text(resourceId, Modifier.weight(1f)); TextButton(onClick = { related = related - resourceId }) { Text("Entfernen") } } }
            OutlinedButton(onClick = { picking = true }) { Text("Eintrag verknüpfen") }
        }
        Section("GPS") {
            TextInput("Breitengrad", draft.s("gpsLatitude"), { set("gpsLatitude", it) }, true)
            TextInput("Längengrad", draft.s("gpsLongitude"), { set("gpsLongitude", it) }, true)
            TextInput("Höhe in Metern", draft.s("gpsAltitude"), { set("gpsAltitude", it) }, true)
        }
        Button(modifier = Modifier.fillMaxWidth(), enabled = !model.busy && draft.s("name").isNotBlank(), onClick = {
            try {
                val result = draft.copy()
                val custom = result.o("customFields").copy()
                definitions.filter { it.s("fieldType") == "number" }.forEach { field ->
                    val key = field.s("key")
                    if (custom.has(key)) {
                        val value = custom.s(key).replace(',', '.').toDoubleOrNull()
                        require(value != null && value.isFinite()) { "${field.s("label")}: bitte eine gültige Zahl eingeben." }
                        require(field.isNull("minValue") || value >= field.optDouble("minValue")) { "${field.s("label")}: Wert ist zu klein." }
                        require(field.isNull("maxValue") || value <= field.optDouble("maxValue")) { "${field.s("label")}: Wert ist zu groß." }
                        custom.put(key, value)
                    }
                }
                if (result.has("customFields")) result.put("customFields", custom)
                listOf("quantity", "valueCents", "priority").forEach { key -> if (result.has(key)) result.put(key, result.s(key).takeIf { it.isNotBlank() }?.toInt() ?: JSONObject.NULL) }
                listOf("gpsLatitude", "gpsLongitude", "gpsAltitude").forEach { key -> if (result.has(key)) result.put(key, result.s(key).replace(',', '.').takeIf { it.isNotBlank() }?.toDouble()?.also { require(it.isFinite()) } ?: JSONObject.NULL) }
                require(result.isNull("gpsLatitude") == result.isNull("gpsLongitude")) { "Breiten- und Längengrad gemeinsam angeben." }
                listOf("sku", "barcode", "serialNumber", "location").forEach { key -> if (result.s(key).isBlank()) result.put(key, JSONObject.NULL) }
                listOf("tags", "slugs").forEach { key -> result.put(key, JSONArray(result.a(key).strings().filter { it.isNotBlank() }.distinct())) }
                result.put("categories", JSONArray(result.a("categories").objects().filter { it.s("name").isNotBlank() }))
                result.put("relatedResourceIds", JSONArray(related))
                val writable = setOf("name", "slugs", "description", "type", "status", "sku", "barcode", "quantity", "location", "serialNumber", "valueCents", "currency", "priority", "tags", "categories", "customFields", "relatedResourceIds", "gpsLatitude", "gpsLongitude", "gpsAltitude", "notes")
                val payload = obj()
                result.keys().forEach { key -> if (key in writable && (id == null || key != "quantity") && (id == null || canonical(result.opt(key)) != canonical(original.opt(key)))) payload.put(key, result.opt(key)) }
                model.run { model.mutate(api, if (id == null) "resources" else "resources/$id", if (id == null) "POST" else "PATCH", payload, idempotent = id == null); back() }
            } catch (e: Exception) { error = e.message ?: "Bitte die Zahlen prüfen." }
        }) { Text("Speichern") }
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
        "select" -> Choice(title, values.s(key), listOf("" to "Keine Auswahl") + field.a("options").objects().map { it.s("value") to it.s("label") }) { set(it.takeIf(String::isNotEmpty)) }
        "multi_select" -> {
            Text(title)
            field.a("options").objects().forEach { option -> val selected = values.a(key).strings(); Toggle(option.s("label"), option.s("value") in selected) { checked -> set(JSONArray(if (checked) selected + option.s("value") else selected - option.s("value"))) } }
        }
        "reference" -> { OutlinedButton(onClick = { reference = true }) { Text("$title: ${values.s(key).ifBlank { "Auswählen" }}") }; TextButton(onClick = { set(null) }) { Text("Auswahl löschen") } }
        "number" -> {
            TextInput(title, values.s(key), { set(it.takeIf(String::isNotBlank)) }, true)
        }
        else -> TextInput(title + when (field.s("fieldType")) { "date" -> " (JJJJ-MM-TT)"; "datetime" -> " (ISO-Datum mit Uhrzeit)"; else -> "" }, values.s(key), { set(it.takeIf(String::isNotEmpty)) }, lines = if (field.s("fieldType") == "textarea") 3 else 1)
    }
    if (field.s("description").isNotBlank()) Text(field.s("description"), style = MaterialTheme.typography.bodySmall)
    if (reference) {
        var query by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { reference = false }, title = { Text(title) }, text = { Column {
            TextInput("Suchen", query, { query = it })
            Box(Modifier.heightIn(max = 300.dp)) { Remote(model, api, "custom-fields/${field.s("id")}/options", mapOf("q" to query)) { data ->
                androidx.compose.foundation.lazy.LazyColumn { items(data.a("options").length()) { index -> val option = data.a("options").getJSONObject(index)
                    LinkRow(option.s("label"), option.s("description")) { set(if (field.optBoolean("referenceMultiple")) JSONArray((values.a(key).strings() + option.s("id")).distinct()) else option.s("id")); reference = false }
                } }
            } }
        } }, confirmButton = { TextButton(onClick = { reference = false }) { Text("Fertig") } })
    }
}
