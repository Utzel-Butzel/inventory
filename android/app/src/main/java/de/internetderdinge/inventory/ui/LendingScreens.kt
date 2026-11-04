package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.*

@Composable fun DateInput(label: String, value: String, onValue: (String) -> Unit) {
    val context = LocalContext.current
    OutlinedButton(onClick = {
        val current = runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrDefault(LocalDate.now())
        DatePickerDialog(context, { _, y, m, d -> onValue(LocalDate.of(y, m + 1, d).atStartOfDay(ZoneId.systemDefault()).toInstant().toString()) }, current.year, current.monthValue - 1, current.dayOfMonth).show()
    }) { Text("$label: ${runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDate().toString() }.getOrDefault(L10n.text(R.string.ui_select_0bf1eddb))}") }
}

@Composable fun LoansScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var filter by remember { mutableStateOf("active") }
    Remote(model, api, "loans", mapOf("limit" to "500")) { data -> Page {
        Heading(L10n.text(R.string.ui_loans_reservations_8cafe909))
        Choice(L10n.text(R.string.ui_view_ccb27f03), filter, listOf("active" to L10n.text(R.string.ui_active_8163454f), "overdue" to L10n.text(R.string.ui_overdue_a1f573d6), "reservation" to L10n.text(R.string.ui_reservations_ff2232b0), "all" to L10n.text(R.string.ui_all_3801a35c))) { filter = it }
        val assignments = data.a("assignments").objects().filter { when (filter) { "active" -> it.s("status") == "active"; "overdue" -> it.optBoolean("overdue"); "reservation" -> it.s("kind") == "reservation"; else -> true } }
        if (assignments.isEmpty()) Empty()
        assignments.forEach { assignment ->
            LinkRow(assignment.o("resource").s("name"), "${assignment.s("quantity")} × ${assignment.o("assignee").s("label")} · ${label(assignment.s("status"))}") { navigate("assignments/${assignment.s("resourceId")}") }
            if (assignment.optBoolean("overdue")) Notice(L10n.text(R.string.ui_return_overdue_since_0_cb54f987, assignment.s("dueAt")))
        }
    } }
}

@Composable fun AssignmentsScreen(model: AppModel, api: Api, id: String) {
    var create by remember { mutableStateOf(false) }
    var lending by remember { mutableStateOf(false) }
    var operation by remember { mutableStateOf<Pair<JSONObject, String>?>(null) }
    val manage = api.session.allows("assignments.manage", "write")
    Remote(model, api, "resources/$id/assignments") { data ->
        Page {
            Heading(data.o("resource").s("name"), L10n.text(R.string.ui_0_available_1_reserved_7a9917cb, data.o("availability").s("availableQuantity"), data.o("availability").s("reservedQuantity")))
            if (manage) { Button(onClick = { create = true }) { Text(L10n.text(R.string.ui_issue_reserve_bd2426bf)) }; TextButton(onClick = { lending = true }) { Text(L10n.text(R.string.ui_lending_rules_21ff147e)) } }
            data.a("assignments").objects().forEach { a ->
                ElevatedCard { Column(Modifier.padding(Spacing)) {
                    Text(a.o("assignee").s("label"), style = MaterialTheme.typography.titleMedium)
                    Text("${a.s("quantity")} × · ${label(a.s("kind"))} · ${label(a.s("status"))}")
                    if (a.s("dueAt").isNotBlank()) Text(L10n.text(R.string.ui_due_0_42636805, a.s("dueAt")))
                    if (a.s("note").isNotBlank()) Text(a.s("note"))
                    if (a.optBoolean("overdue")) Notice(L10n.text(R.string.ui_return_overdue_7122fe4d))
                    if (manage && a.s("status") == "active") {
                        if (a.s("kind") == "reservation" && !a.optBoolean("stockApplied")) TextButton(onClick = { operation = a to "checkout" }) { Text(L10n.text(R.string.ui_issue_now_89e347a7)) }
                        else TextButton(onClick = { operation = a to "returned" }) { Text(L10n.text(R.string.ui_book_return_2bafac6e)) }
                        TextButton(onClick = { operation = a to "cancelled" }) { Text(L10n.text(R.string.ui_cancel_81a5f66b)) }
                    }
                } }
            }
        }
        if (create) AssignmentDialog(model, api, id, data) { create = false }
        if (lending) FormDialog(L10n.text(R.string.ui_lending_rules_21ff147e), listOf(Field("enabled", L10n.text(R.string.ui_lendable_bafed875), "bool"), Field("approvalRequired", L10n.text(R.string.ui_approval_required_251680d9), "bool"), Field("defaultDurationDays", L10n.text(R.string.ui_default_duration_days_cc5ca2fa), "int", required = true), Field("maxDurationDays", L10n.text(R.string.ui_maximum_duration_days_b78fbfc8), "int", required = true)), data.o("lending"), model.busy, { lending = false }) { body -> model.run { model.mutate(api, "resources/$id/lending", "PATCH", body); lending = false } }
        operation?.let { (assignment, action) ->
            var unit by remember(assignment.s("id")) { mutableStateOf(assignment.s("stockUnitId")) }
            AlertDialog(onDismissRequest = { if (!model.busy) operation = null }, title = { Text(if (action == "checkout") L10n.text(R.string.ui_issue_reservation_6de0eb0c) else if (action == "returned") L10n.text(R.string.ui_book_return_3d71c438) else L10n.text(R.string.ui_cancel_assignment_fc7f08c6)) }, text = { Column {
                Text("${assignment.s("quantity")} × ${data.o("resource").s("name")} · ${assignment.o("assignee").s("label")}")
                if (action == "checkout" && data.s("trackingMode") == "serialized") Choice(L10n.text(R.string.ui_unit_d5ba1549), unit, data.a("availableUnits").objects().map { it.s("id") to it.s("code") }) { unit = it }
            } }, confirmButton = { TextButton(enabled = !model.busy && (action != "checkout" || data.s("trackingMode") != "serialized" || unit.isNotBlank()), onClick = { model.run {
                val body = if (action == "checkout") obj("action" to "checkout").apply { if (unit.isNotBlank()) put("stockUnitId", unit) } else obj("status" to action)
                model.mutate(api, "assignments/${assignment.s("id")}", "PATCH", body, true); operation = null
            } }) { Text(L10n.text(R.string.ui_confirm_15b63b4d)) } }, dismissButton = { TextButton(onClick = { operation = null }, enabled = !model.busy) { Text(L10n.text(R.string.ui_cancel_f7ff1178)) } })
        }
    }
}

@Composable private fun AssignmentDialog(model: AppModel, api: Api, id: String, data: JSONObject, dismiss: () -> Unit) {
    var kind by remember { mutableStateOf("checkout") }; var quantity by remember { mutableStateOf("1") }; var unit by remember { mutableStateOf("") }
    var recipientType by remember { mutableStateOf("label") }; var recipient by remember { mutableStateOf("") }; var recipientName by remember { mutableStateOf("") }
    var start by remember { mutableStateOf(Instant.now().toString()) }; var due by remember { mutableStateOf(Instant.now().plusSeconds(86400L * data.o("lending").optInt("defaultDurationDays", 7)).toString()) }
    var note by remember { mutableStateOf("") }; var picker by remember { mutableStateOf(false) }
    androidx.compose.ui.window.Dialog(onDismissRequest = { if (!model.busy) dismiss() }) { Surface(shape = MaterialTheme.shapes.extraLarge) { Page {
        Heading(L10n.text(R.string.ui_loans_assignments_931054aa))
        Choice(L10n.text(R.string.ui_kind_75df3579), kind, listOf("checkout" to L10n.text(R.string.ui_loans_7b19cf9d), "assignment" to L10n.text(R.string.ui_assignment_2505acf3), "reservation" to L10n.text(R.string.ui_reservation_2123f330))) { kind = it }
        TextInput(L10n.text(R.string.ui_quantity_1bece813), quantity, { quantity = it }, true)
        if (data.s("trackingMode") == "serialized") Choice(L10n.text(R.string.ui_unit_d5ba1549), unit, listOf("" to L10n.text(R.string.ui_none_selected_38979ca2)) + data.a("availableUnits").objects().map { it.s("id") to it.s("code") }) { unit = it }
        Choice(L10n.text(R.string.ui_recipient_type_90ccecf5), recipientType, listOf("label" to L10n.text(R.string.ui_name_dcd1d522), "user" to L10n.text(R.string.ui_users_80033f82), "resource" to L10n.text(R.string.ui_inventory_item_19f47c8a))) { recipientType = it; recipient = ""; recipientName = "" }
        when (recipientType) {
            "user" -> Choice(L10n.text(R.string.ui_recipient_2f3ce594), recipient, data.o("recipients").a("users").objects().map { it.s("id") to "${it.s("name")} · ${it.s("email")}" }) { recipient = it }
            "resource" -> OutlinedButton(onClick = { picker = true }) { Text(recipientName.ifBlank { L10n.text(R.string.ui_select_recipient_4eb2283e) }) }
            else -> TextInput(L10n.text(R.string.ui_recipient_2f3ce594), recipient, { recipient = it })
        }
        DateInput(L10n.text(R.string.ui_start_0d95fd6a), start) { start = it }; DateInput(L10n.text(R.string.ui_return_6223760a), due) { due = it }
        TextInput(L10n.text(R.string.ui_note_74b487d9), note, { note = it }, lines = 2)
        Button(enabled = !model.busy && recipient.isNotBlank() && (quantity.toIntOrNull() ?: 0) > 0, onClick = { model.run {
            require(Instant.parse(due) > Instant.parse(start)) { L10n.text(R.string.ui_the_return_must_be_after_the_start_4c506d74) }
            val rec = obj("type" to recipientType, (when (recipientType) { "user" -> "userId"; "resource" -> "resourceId"; else -> "label" }) to recipient)
            val body = obj("kind" to kind, "quantity" to quantity.toInt(), "recipient" to rec, "startsAt" to start, "dueAt" to due, "note" to note)
            if (unit.isNotBlank()) body.put("stockUnitId", unit)
            model.mutate(api, "resources/$id/assignments", "POST", body, true); dismiss()
        } }) { Text(L10n.text(R.string.ui_confirm_15b63b4d)) }
        TextButton(enabled = !model.busy, onClick = dismiss) { Text(L10n.text(R.string.ui_cancel_f7ff1178)) }
    } } }
    if (picker) ResourcePicker(model, api, onDismiss = { picker = false }) { recipient = it.s("id"); recipientName = it.s("name"); picker = false }
}

@Composable fun RequestsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var status by remember { mutableStateOf("") }; var mine by remember { mutableStateOf(false) }
    Remote(model, api, "internal-requests", buildMap { put("limit", "200"); if (status.isNotBlank()) put("status", status); if (mine) put("mine", "true") }) { data -> Page {
        Heading(L10n.text(R.string.ui_internal_requests_32dc9d5c))
        if (data.o("capabilities").optBoolean("canCreate")) Button(onClick = { navigate("new-request") }) { Text(L10n.text(R.string.ui_new_request_d6b3176f)) }
        Choice(L10n.text(R.string.ui_status_920e413c), status, listOf("" to L10n.text(R.string.ui_all_3801a35c)) + listOf("submitted", "approved", "rejected", "fulfilled", "cancelled").map { it to label(it) }) { status = it }
        Toggle(L10n.text(R.string.ui_my_requests_only_1791dbe6), mine) { mine = it }
        if (data.a("requests").length() == 0) Empty()
        data.a("requests").objects().forEach { r -> LinkRow(r.s("reference"), L10n.text(R.string.ui_0_1_line_items_2_f724992b, r.o("requester").s("name"), label(r.s("status")), r.a("lines").length())) { navigate("request/${r.s("id")}") } }
    } }
}
@Composable fun RequestScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    var action by remember { mutableStateOf("") }
    Remote(model, api, "internal-requests/$id") { data -> val r = data.o("request"); Page {
        Heading(r.s("reference"), label(r.s("status")))
        Text(L10n.text(R.string.ui_requested_by_0_86d495ec, r.o("requester").s("name")))
        Text(L10n.text(R.string.ui_0_to_1_f2c9f59b, r.s("startsAt"), r.s("dueAt")))
        if (!r.isNull("delivery")) Text(L10n.text(R.string.ui_destination_0_a88778f0, r.o("delivery").s("name")))
        Text(r.s("note"))
        r.a("lines").objects().forEach { line -> LinkRow("${line.s("quantity")} × ${line.o("resource").s("name")}", line.s("note")) { navigate("resource/${line.o("resource").s("id")}") } }
        if (api.session.allows("requests.manage", "write")) {
            if (r.s("status") == "submitted") { Button(onClick = { action = "approve" }) { Text(L10n.text(R.string.ui_approve_0c78fbbf)) }; OutlinedButton(onClick = { action = "reject" }) { Text(L10n.text(R.string.ui_reject_7be75ced)) } }
            if (r.s("status") == "approved") Button(onClick = { action = "fulfill" }) { Text(L10n.text(R.string.ui_confirm_issue_da725733)) }
        }
        if (r.optBoolean("canCancel")) TextButton(onClick = { action = "cancel" }) { Text(L10n.text(R.string.ui_cancel_request_87e881d5)) }
        Section(L10n.text(R.string.ui_history_5fd70311)) { r.a("events").objects().forEach { Text("${label(it.s("type"))} · ${it.s("actor")} · ${it.s("occurredAt")}\n${it.s("note")}") } }
    } }
    if (action.isNotBlank()) FormDialog(when (action) { "approve" -> L10n.text(R.string.ui_approve_request_381362ce); "reject" -> L10n.text(R.string.ui_reject_request_370a74a7); "fulfill" -> L10n.text(R.string.ui_confirm_issue_da725733); else -> L10n.text(R.string.ui_cancel_request_87e881d5) }, listOf(Field("note", L10n.text(R.string.ui_reason_note_2e0fdd98), "multiline")), busy = model.busy, onDismiss = { action = "" }) { body -> model.run { model.mutate(api, "internal-requests/$id", "PATCH", body.put("action", action)); action = "" } }
}
@Composable fun NewRequestScreen(model: AppModel, api: Api, back: () -> Unit) {
    var lines by remember { mutableStateOf(emptyList<JSONObject>()) }; var picker by remember { mutableStateOf("") }; var delivery by remember { mutableStateOf<JSONObject?>(null) }
    var starts by remember { mutableStateOf(Instant.now().toString()) }; var due by remember { mutableStateOf(Instant.now().plusSeconds(7 * 86400).toString()) }; var note by remember { mutableStateOf("") }
    Page {
        Heading(L10n.text(R.string.ui_new_request_d6b3176f))
        DateInput(L10n.text(R.string.ui_start_0d95fd6a), starts) { starts = it }; DateInput(L10n.text(R.string.ui_return_6223760a), due) { due = it }
        OutlinedButton(onClick = { picker = "delivery" }) { Text(delivery?.s("name") ?: L10n.text(R.string.ui_select_delivery_location_optional_0bbf17bc)) }
        lines.forEachIndexed { index, line ->
            Text(line.s("name"), style = MaterialTheme.typography.titleMedium)
            TextInput(L10n.text(R.string.ui_quantity_1bece813), line.s("quantity"), { value -> lines = lines.mapIndexed { i, old -> if (i == index) old.copy().put("quantity", value) else old } }, true)
            TextInput(L10n.text(R.string.ui_line_note_413d289b), line.s("note"), { value -> lines = lines.mapIndexed { i, old -> if (i == index) old.copy().put("note", value) else old } })
            TextButton(onClick = { lines = lines.filterIndexed { i, _ -> i != index } }) { Text(L10n.text(R.string.ui_remove_3828375a)) }
        }
        OutlinedButton(enabled = lines.size < 50, onClick = { picker = "line" }) { Text(L10n.text(R.string.ui_add_inventory_items_54aa839c)) }
        TextInput(L10n.text(R.string.ui_note_74b487d9), note, { note = it }, lines = 3)
        Button(enabled = lines.isNotEmpty() && !model.busy, onClick = { model.run {
            val interval = Duration.between(Instant.parse(starts), Instant.parse(due))
            require(!interval.isNegative && !interval.isZero && interval <= Duration.ofDays(366)) { L10n.text(R.string.ui_period_1_to_366_days_6a5f4e5e) }
            val rows = lines.map { line -> val q = line.s("quantity").toIntOrNull() ?: 0; require(q in 1..2_000_000_000) { L10n.text(R.string.ui_please_enter_valid_quantities_1929212b) }; obj("resourceId" to line.s("resourceId"), "quantity" to q, "note" to line.s("note")) }
            val body = obj("startsAt" to starts, "dueAt" to due, "note" to note, "lines" to JSONArray(rows)); delivery?.let { body.put("deliveryResourceId", it.s("id")) }
            model.mutate(api, "internal-requests", "POST", body, true); back()
        } }) { Text(L10n.text(R.string.ui_submit_request_dfcd1e49)) }
    }
    if (picker.isNotBlank()) ResourcePicker(model, api, exclude = if (picker == "line") lines.map { it.s("resourceId") }.toSet() else emptySet(), onDismiss = { picker = "" }) { r -> if (picker == "delivery") delivery = r else lines = lines + obj("resourceId" to r.s("id"), "name" to r.s("name"), "quantity" to 1); picker = "" }
}
