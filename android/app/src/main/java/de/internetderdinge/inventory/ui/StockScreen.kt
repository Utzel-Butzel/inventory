package de.internetderdinge.inventory.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

@Composable fun StockScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit, selectedUnit: String? = null) {
    var dialog by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(obj()) }
    var review by remember { mutableStateOf<JSONObject?>(null) }
    val manage = api.session.allows("stock.manage", "write")
    Remote(model, api, "resources/$id/stock") { data ->
        val config = data.o("config")
        LaunchedEffect(selectedUnit) {
            if (selectedUnit != null) data.a("units").objects().firstOrNull { it.s("id") == selectedUnit }?.let { selected = it; if (manage) dialog = "unit" }
        }
        Page {
            Heading(data.o("resource").s("name"), "${data.o("resource").s("quantity")} ${config.s("unitName")} · ${if (config.s("trackingMode") == "serialized") "Einzelverfolgung" else "Mengenbestand"}")
            if (manage) {
                Row { Button(onClick = { dialog = "movement" }) { Text("Bestand buchen") }; TextButton(onClick = { dialog = "config" }) { Text("Konfigurieren") } }
                if (api.session.allows("ai.use", "ai")) OutlinedButton(onClick = { navigate("camera/count:$id") }) { Text("Mit Kamera zählen") }
            }
            Section("Planung") {
                Text("Mindestbestand: ${config.s("minimumStock")} · Nachbestellen: ${config.s("reorderQuantity")}")
                val f = data.o("forecast")
                Text("Ø täglicher Verbrauch: ${f.s("averageDailyUsage")}")
                if (!f.isNull("daysUntilStockout")) Text("Reichweite: ${f.s("daysUntilStockout")} Tage")
                if (f.optBoolean("isBelowMinimum")) Notice("Mindestbestand unterschritten. Vorschlag: ${f.s("suggestedReorderQuantity")} nachbestellen.")
                Text("Bestellt: ${data.o("procurement").s("onOrder", "0")} · Erwarteter Bestand: ${data.o("procurement").s("projectedQuantity", "0")}")
            }
            if (config.s("trackingMode") == "serialized") Section("Einheiten") {
                if (manage) OutlinedButton(onClick = { dialog = "units" }) { Text("Einheiten hinzufügen") }
                data.a("units").objects().forEach { unit -> LinkRow(unit.s("code"), "${label(unit.s("status"))} · ${unit.s("location")}") { if (manage) { selected = unit; dialog = "unit" } } }
            }
            Section("Bewegungen") {
                data.a("movements").objects().forEach { move -> ListItem(headlineContent = { Text("${move.s("delta")} → ${move.s("balanceAfter")}") }, supportingContent = { Text("${move.s("occurredAt")} · ${move.s("type")}\n${move.s("note")}") }) }
                if (data.a("movements").length() == 0) Text("Noch keine Bewegungen.")
            }
        }
        when (dialog) {
            "movement" -> FormDialog("Bestandsbewegung", listOf(Field("delta", "Änderung (+ / −)", "int", required = true), Field("type", "Art", "choice", listOf("receipt" to "Wareneingang", "issue" to "Warenausgang", "adjustment" to "Korrektur", "return" to "Rückgabe", "waste" to "Ausschuss", "transfer" to "Transfer")), Field("reason", "Grund"), Field("note", "Notiz"), Field("location", "Standort")), obj("delta" to 1, "type" to "receipt"), onDismiss = { dialog = "" }) { review = it; dialog = "" }
            "config" -> FormDialog("Bestand konfigurieren", listOf(Field("trackingMode", "Verfolgung", "choice", listOf("bulk" to "Menge", "serialized" to "Einzelne Einheiten")), Field("minimumStock", "Mindestbestand", "int", required = true), Field("reorderQuantity", "Nachbestellmenge", "int", required = true), Field("leadTimeDays", "Lieferzeit in Tagen", "int", required = true), Field("unitName", "Einheit")), config, model.busy, { dialog = "" }) { body -> model.run { model.mutate(api, "resources/$id/stock/config", "PATCH", body); dialog = "" } }
            "units" -> FormDialog("Einheiten hinzufügen", listOf(Field("count", "Anzahl (1–100)", "int"), Field("codes", "Codes, jeweils eine Zeile", "multiline"), Field("location", "Standort")), obj("count" to 1), model.busy, { dialog = "" }) { body -> model.run {
                val codes = body.s("codes").lines().map(String::trim).filter(String::isNotBlank); body.remove("codes")
                if (codes.isNotEmpty()) { body.remove("count"); body.put("codes", JSONArray(codes)) }
                require((if (codes.isEmpty()) body.optInt("count") else codes.size) in 1..100)
                model.mutate(api, "resources/$id/stock/units", "POST", body); dialog = ""
            } }
            "unit" -> FormDialog(selected.s("code"), listOf(Field("status", "Status", "choice", (listOf("available", "reserved", "in-use", "maintenance", "consumed", "lost", "retired")).map { it to label(it) }), Field("location", "Standort"), Field("reason", "Grund"), Field("note", "Notiz")), selected, model.busy, { dialog = "" }) { body -> model.run { body.put("occurredAt", Instant.now().toString()); if (body.s("location").isBlank()) body.put("location", JSONObject.NULL); model.mutate(api, "resources/$id/stock/units/${selected.s("id")}", "PATCH", body); dialog = "" } }
        }
        review?.let { body -> Confirm("Bestandsänderung prüfen", "${data.o("resource").s("name")}: ${data.o("resource").optInt("quantity")} → ${data.o("resource").optInt("quantity") + body.optInt("delta")}\n${body.s("note")}", model.busy, { review = null }) {
            model.run { require(body.optInt("delta") != 0) { "Die Bestandsänderung darf nicht null sein." }; model.mutate(api, "resources/$id/stock/movements", "POST", body, true); review = null }
        } }
    }
}
