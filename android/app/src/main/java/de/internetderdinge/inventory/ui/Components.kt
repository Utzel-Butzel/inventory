@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

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
@Composable fun Empty(title: String = L10n.text(R.string.ui_no_items_yet_cb2e41a3), detail: String = L10n.text(R.string.ui_new_items_appear_here_43cbb685)) {
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
        catch (e: Exception) { error = e.message ?: L10n.text(R.string.ui_loading_failed_e6f70b64) }
    }
    if (error != null) Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Notice(error!!, true); OutlinedButton(onClick = { reload++ }) { Text(L10n.text(R.string.ui_retry_1b8b908f)) }
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
                require(!f.required || value.isNotBlank()) { L10n.text(R.string.ui_0_is_missing_9221e4bd, f.label) }
                when (f.kind) {
                    "bool" -> result.put(f.key, values.optBoolean(f.key))
                    "int" -> if (value.isNotBlank()) result.put(f.key, value.toIntOrNull() ?: error(L10n.text(R.string.ui_0_enter_a_whole_number_69317e5f, f.label)))
                    "number" -> if (value.isNotBlank()) result.put(f.key, value.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() } ?: error(L10n.text(R.string.ui_0_enter_a_number_f237a8be, f.label)))
                    else -> result.put(f.key, value)
                }
            }
            onSave(result)
        } catch (e: Exception) { error = e.message }
    }) { Text(if (busy) L10n.text(R.string.ui_saving_a8060ba6) else L10n.text(R.string.ui_save_f6b2ff39)) } }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(L10n.text(R.string.ui_cancel_f7ff1178)) } })
}
@Composable fun Confirm(title: String, text: String, busy: Boolean = false, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(title) }, text = { Text(text) },
        confirmButton = { TextButton(enabled = !busy, onClick = onConfirm) { Text(L10n.text(R.string.ui_confirm_15b63b4d)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(L10n.text(R.string.ui_cancel_f7ff1178)) } })
}
val statuses get() = listOf("available" to L10n.text(R.string.ui_available_3aa55273), "in-use" to L10n.text(R.string.ui_in_use_886a1291), "maintenance" to L10n.text(R.string.ui_maintenance_854f69bd), "archived" to L10n.text(R.string.ui_archived_e28232fa))
val types get() = listOf("object" to L10n.text(R.string.ui_item_72e2f335), "tool" to L10n.text(R.string.ui_tool_bf1349a8), "place" to L10n.text(R.string.ui_place_30fb2591), "person" to L10n.text(R.string.ui_person_6007db63), "vehicle" to L10n.text(R.string.ui_vehicle_56f7557e), "project" to L10n.text(R.string.ui_project_40ebf93a), "clothing" to L10n.text(R.string.ui_clothing_e6bb4b3e), "furniture" to L10n.text(R.string.ui_furniture_c895b27d), "other" to L10n.text(R.string.ui_other_9f3d5f8d))
private val labelResources = mapOf(
    "active" to R.string.ui_active_8163454f,
    "returned" to R.string.ui_returned_48d94b8b,
    "cancelled" to R.string.ui_cancelled_0aa6a1fa,
    "submitted" to R.string.ui_submitted_7f8d92f4,
    "approved" to R.string.ui_approved_9b3015a9,
    "rejected" to R.string.ui_rejected_a9148e86,
    "fulfilled" to R.string.ui_fulfilled_3d1f3473,
    "waiting" to R.string.ui_waiting_cff72948,
    "pending" to R.string.ui_waiting_cff72948,
    "processing" to R.string.ui_in_progress_e94e8adc,
    "running" to R.string.ui_running_f85fd2bc,
    "paused" to R.string.ui_paused_02a733f1,
    "error" to R.string.ui_error_f6cc01cb,
    "failed" to R.string.ui_failed_1c47a973,
    "done" to R.string.ui_done_25d52d7e,
    "reserved" to R.string.ui_reserved_10814cd6,
    "consumed" to R.string.ui_consumed_417c49fe,
    "lost" to R.string.ui_lost_4b067d9b,
    "retired" to R.string.ui_retired_ff85d35e,
    "loan" to R.string.ui_loans_7b19cf9d,
    "reservation" to R.string.ui_reservation_2123f330,
    "assignment" to R.string.ui_assignment_2505acf3,
    "receipt" to R.string.ui_goods_receipt_d84ec7ae,
    "issue" to R.string.ui_removal_95114093,
    "adjustment" to R.string.ui_adjustment_62bc7c7f,
    "return" to R.string.ui_return_6223760a,
    "waste" to R.string.ui_waste_295b9e6f,
    "transfer" to R.string.ui_transfer_a9372d22,
    "unit-created" to R.string.ui_unit_created_8760b6d5,
    "unit-status" to R.string.ui_unit_status_463fb2bb,
    "unit-update" to R.string.ui_unit_updated_5bb0b6bf,
    "serialization-opening" to R.string.ui_serialization_ea16a109,
    "analysis" to R.string.ui_analysis_d8673f98,
    "research" to R.string.ui_research_a12b73cf,
    "text" to R.string.ui_text_71988c4d,
    "textarea" to R.string.ui_long_text_9aa0d7b3,
    "number" to R.string.ui_number_654eb4c0,
    "boolean" to R.string.ui_yes_no_0b90ccd2,
    "date" to R.string.ui_date_9135882d,
    "datetime" to R.string.ui_date_and_time_5e69bd74,
    "select" to R.string.ui_selection_e8b7adc3,
    "multi_select" to R.string.ui_multiple_selection_1d8a827e,
    "reference" to R.string.ui_relationship_b52d492d
)
fun label(value: String): String = labelResources[value]?.let { L10n.text(it) }
    ?: (statuses + types).firstOrNull { it.first == value }?.second ?: value
