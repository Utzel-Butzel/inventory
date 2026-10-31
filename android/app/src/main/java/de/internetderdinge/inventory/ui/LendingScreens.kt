package de.internetderdinge.inventory.ui

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
    }) { Text("$label: ${runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDate().toString() }.getOrDefault("Auswählen")}") }
}

@Composable fun LoansScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var filter by remember { mutableStateOf("active") }
    Remote(model, api, "loans", mapOf("limit" to "500")) { data -> Page {
        Heading("Ausleihen & Reservierungen")
        Choice("Anzeigen", filter, listOf("active" to "Aktiv", "overdue" to "Überfällig", "reservation" to "Reservierungen", "all" to "Alle")) { filter = it }
        val assignments = data.a("assignments").objects().filter { when (filter) { "active" -> it.s("status") == "active"; "overdue" -> it.optBoolean("overdue"); "reservation" -> it.s("kind") == "reservation"; else -> true } }
        if (assignments.isEmpty()) Empty()
        assignments.forEach { assignment ->
            LinkRow(assignment.o("resource").s("name"), "${assignment.s("quantity")} × ${assignment.o("assignee").s("label")} · ${label(assignment.s("status"))}") { navigate("assignments/${assignment.s("resourceId")}") }
            if (assignment.optBoolean("overdue")) Notice("Rückgabe überfällig seit ${assignment.s("dueAt")}")
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
            Heading(data.o("resource").s("name"), "${data.o("availability").s("availableQuantity")} verfügbar · ${data.o("availability").s("reservedQuantity")} reserviert")
            if (manage) { Button(onClick = { create = true }) { Text("Ausgeben / reservieren") }; TextButton(onClick = { lending = true }) { Text("Ausleihregeln") } }
            data.a("assignments").objects().forEach { a ->
                ElevatedCard { Column(Modifier.padding(Spacing)) {
                    Text(a.o("assignee").s("label"), style = MaterialTheme.typography.titleMedium)
                    Text("${a.s("quantity")} × · ${a.s("kind")} · ${label(a.s("status"))}")
                    if (a.s("dueAt").isNotBlank()) Text("Fällig: ${a.s("dueAt")}")
                    if (a.s("note").isNotBlank()) Text(a.s("note"))
                    if (a.optBoolean("overdue")) Notice("Rückgabe überfällig")
                    if (manage && a.s("status") == "active") {
                        if (a.s("kind") == "reservation" && !a.optBoolean("stockApplied")) TextButton(onClick = { operation = a to "checkout" }) { Text("Jetzt ausgeben") }
                        else TextButton(onClick = { operation = a to "returned" }) { Text("Rückgabe buchen") }
                        TextButton(onClick = { operation = a to "cancelled" }) { Text("Stornieren") }
                    }
                } }
            }
        }
        if (create) AssignmentDialog(model, api, id, data) { create = false }
        if (lending) FormDialog("Ausleihregeln", listOf(Field("enabled", "Ausleihbar", "bool"), Field("approvalRequired", "Genehmigung erforderlich", "bool"), Field("defaultDurationDays", "Standarddauer (Tage)", "int", required = true), Field("maxDurationDays", "Maximale Dauer (Tage)", "int", required = true)), data.o("lending"), model.busy, { lending = false }) { body -> model.run { model.mutate(api, "resources/$id/lending", "PATCH", body); lending = false } }
        operation?.let { (assignment, action) ->
            var unit by remember(assignment.s("id")) { mutableStateOf(assignment.s("stockUnitId")) }
            AlertDialog(onDismissRequest = { if (!model.busy) operation = null }, title = { Text(if (action == "checkout") "Reservierung ausgeben?" else if (action == "returned") "Rückgabe buchen?" else "Zuweisung stornieren?") }, text = { Column {
                Text("${assignment.s("quantity")} × ${data.o("resource").s("name")} · ${assignment.o("assignee").s("label")}")
                if (action == "checkout" && data.s("trackingMode") == "serialized") Choice("Einheit", unit, data.a("availableUnits").objects().map { it.s("id") to it.s("code") }) { unit = it }
            } }, confirmButton = { TextButton(enabled = !model.busy && (action != "checkout" || data.s("trackingMode") != "serialized" || unit.isNotBlank()), onClick = { model.run {
                val body = if (action == "checkout") obj("action" to "checkout").apply { if (unit.isNotBlank()) put("stockUnitId", unit) } else obj("status" to action)
                model.mutate(api, "assignments/${assignment.s("id")}", "PATCH", body, true); operation = null
            } }) { Text("Bestätigen") } }, dismissButton = { TextButton(onClick = { operation = null }, enabled = !model.busy) { Text("Abbrechen") } })
        }
    }
}

@Composable private fun AssignmentDialog(model: AppModel, api: Api, id: String, data: JSONObject, dismiss: () -> Unit) {
    var kind by remember { mutableStateOf("checkout") }; var quantity by remember { mutableStateOf("1") }; var unit by remember { mutableStateOf("") }
    var recipientType by remember { mutableStateOf("label") }; var recipient by remember { mutableStateOf("") }; var recipientName by remember { mutableStateOf("") }
    var start by remember { mutableStateOf(Instant.now().toString()) }; var due by remember { mutableStateOf(Instant.now().plusSeconds(86400L * data.o("lending").optInt("defaultDurationDays", 7)).toString()) }
    var note by remember { mutableStateOf("") }; var picker by remember { mutableStateOf(false) }
    androidx.compose.ui.window.Dialog(onDismissRequest = { if (!model.busy) dismiss() }) { Surface(shape = MaterialTheme.shapes.extraLarge) { Page {
        Heading("Ausleihe & Zuweisung")
        Choice("Art", kind, listOf("checkout" to "Ausleihe", "assignment" to "Zuweisung", "reservation" to "Reservierung")) { kind = it }
        TextInput("Menge", quantity, { quantity = it }, true)
        if (data.s("trackingMode") == "serialized") Choice("Einheit", unit, listOf("" to "Keine ausgewählt") + data.a("availableUnits").objects().map { it.s("id") to it.s("code") }) { unit = it }
        Choice("Empfängerart", recipientType, listOf("label" to "Name", "user" to "Benutzer", "resource" to "Inventareintrag")) { recipientType = it; recipient = ""; recipientName = "" }
        when (recipientType) {
            "user" -> Choice("Empfänger", recipient, data.o("recipients").a("users").objects().map { it.s("id") to "${it.s("name")} · ${it.s("email")}" }) { recipient = it }
            "resource" -> OutlinedButton(onClick = { picker = true }) { Text(recipientName.ifBlank { "Empfänger auswählen" }) }
            else -> TextInput("Empfänger", recipient, { recipient = it })
        }
        DateInput("Beginn", start) { start = it }; DateInput("Rückgabe", due) { due = it }
        TextInput("Notiz", note, { note = it }, lines = 2)
        Button(enabled = !model.busy && recipient.isNotBlank() && (quantity.toIntOrNull() ?: 0) > 0, onClick = { model.run {
            require(Instant.parse(due) > Instant.parse(start)) { "Die Rückgabe muss nach dem Beginn liegen." }
            val rec = obj("type" to recipientType, (when (recipientType) { "user" -> "userId"; "resource" -> "resourceId"; else -> "label" }) to recipient)
            val body = obj("kind" to kind, "quantity" to quantity.toInt(), "recipient" to rec, "startsAt" to start, "dueAt" to due, "note" to note)
            if (unit.isNotBlank()) body.put("stockUnitId", unit)
            model.mutate(api, "resources/$id/assignments", "POST", body, true); dismiss()
        } }) { Text("Bestätigen") }
        TextButton(enabled = !model.busy, onClick = dismiss) { Text("Abbrechen") }
    } } }
    if (picker) ResourcePicker(model, api, onDismiss = { picker = false }) { recipient = it.s("id"); recipientName = it.s("name"); picker = false }
}

@Composable fun RequestsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var status by remember { mutableStateOf("") }; var mine by remember { mutableStateOf(false) }
    Remote(model, api, "internal-requests", buildMap { put("limit", "200"); if (status.isNotBlank()) put("status", status); if (mine) put("mine", "true") }) { data -> Page {
        Heading("Interne Anfragen")
        if (data.o("capabilities").optBoolean("canCreate")) Button(onClick = { navigate("new-request") }) { Text("Neue Anfrage") }
        Choice("Status", status, listOf("" to "Alle") + listOf("submitted", "approved", "rejected", "fulfilled", "cancelled").map { it to label(it) }) { status = it }
        Toggle("Nur meine Anfragen", mine) { mine = it }
        if (data.a("requests").length() == 0) Empty()
        data.a("requests").objects().forEach { r -> LinkRow(r.s("reference"), "${r.o("requester").s("name")} · ${label(r.s("status"))} · ${r.a("lines").length()} Positionen") { navigate("request/${r.s("id")}") } }
    } }
}
@Composable fun RequestScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    var action by remember { mutableStateOf("") }
    Remote(model, api, "internal-requests/$id") { data -> val r = data.o("request"); Page {
        Heading(r.s("reference"), label(r.s("status")))
        Text("Angefragt von ${r.o("requester").s("name")}")
        Text("${r.s("startsAt")} bis ${r.s("dueAt")}")
        if (!r.isNull("delivery")) Text("Ziel: ${r.o("delivery").s("name")}")
        Text(r.s("note"))
        r.a("lines").objects().forEach { line -> LinkRow("${line.s("quantity")} × ${line.o("resource").s("name")}", line.s("note")) { navigate("resource/${line.o("resource").s("id")}") } }
        if (api.session.allows("requests.manage", "write")) {
            if (r.s("status") == "submitted") { Button(onClick = { action = "approve" }) { Text("Genehmigen") }; OutlinedButton(onClick = { action = "reject" }) { Text("Ablehnen") } }
            if (r.s("status") == "approved") Button(onClick = { action = "fulfill" }) { Text("Ausgabe bestätigen") }
        }
        if (r.optBoolean("canCancel")) TextButton(onClick = { action = "cancel" }) { Text("Anfrage stornieren") }
        Section("Verlauf") { r.a("events").objects().forEach { Text("${label(it.s("type"))} · ${it.s("actor")} · ${it.s("occurredAt")}\n${it.s("note")}") } }
    } }
    if (action.isNotBlank()) FormDialog(when (action) { "approve" -> "Anfrage genehmigen"; "reject" -> "Anfrage ablehnen"; "fulfill" -> "Ausgabe bestätigen"; else -> "Anfrage stornieren" }, listOf(Field("note", "Begründung / Notiz", "multiline")), busy = model.busy, onDismiss = { action = "" }) { body -> model.run { model.mutate(api, "internal-requests/$id", "PATCH", body.put("action", action)); action = "" } }
}
@Composable fun NewRequestScreen(model: AppModel, api: Api, back: () -> Unit) {
    var lines by remember { mutableStateOf(emptyList<JSONObject>()) }; var picker by remember { mutableStateOf("") }; var delivery by remember { mutableStateOf<JSONObject?>(null) }
    var starts by remember { mutableStateOf(Instant.now().toString()) }; var due by remember { mutableStateOf(Instant.now().plusSeconds(7 * 86400).toString()) }; var note by remember { mutableStateOf("") }
    Page {
        Heading("Neue Anfrage")
        DateInput("Beginn", starts) { starts = it }; DateInput("Rückgabe", due) { due = it }
        OutlinedButton(onClick = { picker = "delivery" }) { Text(delivery?.s("name") ?: "Lieferort auswählen (optional)") }
        lines.forEachIndexed { index, line ->
            Text(line.s("name"), style = MaterialTheme.typography.titleMedium)
            TextInput("Menge", line.s("quantity"), { value -> lines = lines.mapIndexed { i, old -> if (i == index) old.copy().put("quantity", value) else old } }, true)
            TextInput("Positionsnotiz", line.s("note"), { value -> lines = lines.mapIndexed { i, old -> if (i == index) old.copy().put("note", value) else old } })
            TextButton(onClick = { lines = lines.filterIndexed { i, _ -> i != index } }) { Text("Entfernen") }
        }
        OutlinedButton(enabled = lines.size < 50, onClick = { picker = "line" }) { Text("Eintrag hinzufügen") }
        TextInput("Notiz", note, { note = it }, lines = 3)
        Button(enabled = lines.isNotEmpty() && !model.busy, onClick = { model.run {
            val interval = Duration.between(Instant.parse(starts), Instant.parse(due))
            require(!interval.isNegative && !interval.isZero && interval <= Duration.ofDays(366)) { "Zeitraum: 1 bis 366 Tage." }
            val rows = lines.map { line -> val q = line.s("quantity").toIntOrNull() ?: 0; require(q in 1..2_000_000_000) { "Bitte gültige Mengen eingeben." }; obj("resourceId" to line.s("resourceId"), "quantity" to q, "note" to line.s("note")) }
            val body = obj("startsAt" to starts, "dueAt" to due, "note" to note, "lines" to JSONArray(rows)); delivery?.let { body.put("deliveryResourceId", it.s("id")) }
            model.mutate(api, "internal-requests", "POST", body, true); back()
        } }) { Text("Anfrage absenden") }
    }
    if (picker.isNotBlank()) ResourcePicker(model, api, exclude = if (picker == "line") lines.map { it.s("resourceId") }.toSet() else emptySet(), onDismiss = { picker = "" }) { r -> if (picker == "delivery") delivery = r else lines = lines + obj("resourceId" to r.s("id"), "name" to r.s("name"), "quantity" to 1); picker = "" }
}
