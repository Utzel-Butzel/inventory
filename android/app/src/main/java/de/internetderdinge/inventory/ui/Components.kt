@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package de.internetderdinge.inventory.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONObject
import kotlinx.coroutines.CancellationException

val Spacing = 16.dp

@Composable fun Page(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
}
@Composable fun Heading(title: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
        content()
    }
}
@Composable fun Notice(text: String, error: Boolean = false) {
    Surface(color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
        Text(text, Modifier.fillMaxWidth().padding(16.dp), color = if (error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer)
    }
}
@Composable fun LinkRow(title: String, subtitle: String = "", onClick: () -> Unit) {
    ListItem(headlineContent = { Text(title) }, supportingContent = if (subtitle.isNotBlank()) ({ Text(subtitle) }) else null,
        trailingContent = { Icon(Icons.AutoMirrored.Outlined.ArrowForward, null) }, modifier = Modifier.clickable(onClick = onClick))
}
@Composable fun Empty(title: String = "Noch keine Einträge", detail: String = "Neue Einträge erscheinen hier.") {
    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Outlined.Inventory2, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleLarge); Text(detail, style = MaterialTheme.typography.bodyMedium)
    }
}
@Composable fun Remote(model: AppModel, api: Api, path: String, query: Map<String, String> = emptyMap(), content: @Composable (JSONObject) -> Unit) {
    var data by remember(path, api.session.context, query) { mutableStateOf<JSONObject?>(null) }
    var error by remember(path, api.session.context, query) { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(path, query, api.session.context, model.revision, reload) {
        error = null
        try { data = api.call(path, query = query) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message ?: "Laden fehlgeschlagen." }
    }
    if (error != null) Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Notice(error!!, true); OutlinedButton(onClick = { reload++ }) { Text("Erneut laden") }
    }
    else if (data == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    else content(data!!)
}
@Composable fun Choice(label: String, value: String, options: List<Pair<String, String>>, onValue: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded, { expanded = !expanded }) {
        OutlinedTextField(options.firstOrNull { it.first == value }?.second ?: value, {}, readOnly = true, label = { Text(label) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable), trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) })
        ExposedDropdownMenu(expanded, { expanded = false }) { options.forEach { (key, title) -> DropdownMenuItem(text = { Text(title) }, onClick = { onValue(key); expanded = false }) } }
    }
}
@Composable fun Toggle(label: String, checked: Boolean, onValue: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onValue(!checked) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f)); Switch(checked, onValue)
    }
}
@Composable fun TextInput(label: String, value: String, onValue: (String) -> Unit, number: Boolean = false, lines: Int = 1) {
    OutlinedTextField(value, onValue, Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = lines == 1, minLines = lines,
        keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Decimal else KeyboardType.Text))
}
data class Field(val key: String, val label: String, val kind: String = "text", val choices: List<Pair<String, String>> = emptyList(), val required: Boolean = false)

@Composable fun FormDialog(title: String, fields: List<Field>, initial: JSONObject = obj(), busy: Boolean = false, onDismiss: () -> Unit, onSave: (JSONObject) -> Unit) {
    var values by rememberJson { initial.copy() }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(title) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            fields.forEach { field ->
                fun set(value: Any?) { values = values.copy().put(field.key, value ?: JSONObject.NULL) }
                when (field.kind) {
                    "bool" -> Toggle(field.label, values.optBoolean(field.key)) { set(it) }
                    "choice" -> Choice(field.label, values.s(field.key), field.choices) { set(it) }
                    else -> TextInput(field.label, values.s(field.key), { set(it) }, field.kind in listOf("int", "number"), if (field.kind == "multiline") 3 else 1)
                }
            }
            error?.let { Notice(it, true) }
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = {
        try {
            val result = obj()
            fields.forEach { f ->
                val value = values.s(f.key)
                require(!f.required || value.isNotBlank()) { "${f.label} fehlt." }
                when (f.kind) {
                    "bool" -> result.put(f.key, values.optBoolean(f.key))
                    "int" -> if (value.isNotBlank()) result.put(f.key, value.toIntOrNull() ?: error("${f.label}: ganze Zahl eingeben."))
                    "number" -> if (value.isNotBlank()) result.put(f.key, value.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() } ?: error("${f.label}: Zahl eingeben."))
                    else -> result.put(f.key, value)
                }
            }
            onSave(result)
        } catch (e: Exception) { error = e.message }
    }) { Text(if (busy) "Wird gespeichert …" else "Speichern") } }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Abbrechen") } })
}
@Composable fun Confirm(title: String, text: String, busy: Boolean = false, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(title) }, text = { Text(text) },
        confirmButton = { TextButton(enabled = !busy, onClick = onConfirm) { Text("Bestätigen") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Abbrechen") } })
}
val statuses = listOf("available" to "Verfügbar", "in-use" to "In Verwendung", "maintenance" to "Wartung", "archived" to "Archiviert")
val types = listOf("object" to "Gegenstand", "tool" to "Werkzeug", "place" to "Ort", "person" to "Person", "vehicle" to "Fahrzeug", "project" to "Projekt", "clothing" to "Kleidung", "furniture" to "Möbel", "other" to "Sonstiges")
fun label(value: String) = (statuses + types + listOf("active" to "Aktiv", "returned" to "Zurückgegeben", "cancelled" to "Storniert", "submitted" to "Eingereicht", "approved" to "Genehmigt", "rejected" to "Abgelehnt", "fulfilled" to "Ausgegeben", "waiting" to "Wartet", "running" to "Läuft", "paused" to "Pausiert", "error" to "Fehler", "done" to "Fertig")).firstOrNull { it.first == value }?.second ?: value
