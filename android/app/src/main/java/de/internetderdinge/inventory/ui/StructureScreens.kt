package de.internetderdinge.inventory.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.json.JSONObject

@Composable fun FamilyScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    var dialog by remember { mutableStateOf("") }
    Remote(model, api, "resources/$id/family") { data ->
        Page {
            Heading("Varianten", "Gesamtbestand: ${data.o("summary").s("totalQuantity")}")
            ResourceRow(api, data.o("primary")) { navigate("resource/${data.o("primary").s("id")}") }
            data.a("variants").objects().forEach { variant -> ResourceRow(api, variant) { navigate("resource/${variant.s("id")}") } }
            if (api.session.allows("inventory.update", "write")) {
                if (api.session.allows("inventory.create", "write")) Button(onClick = { dialog = "new" }) { Text("Variante anlegen") }
                OutlinedButton(onClick = { dialog = "attach" }) { Text("Vorhandenen Eintrag zuordnen") }
                if (data.s("role") == "variant") TextButton(onClick = { dialog = "detach" }) { Text("Variante von Familie lösen") }
            }
        }
        if (dialog == "new") FormDialog("Neue Variante", listOf(Field("name", "Name", required = true), Field("sku", "SKU"), Field("barcode", "Barcode")), busy = model.busy, onDismiss = { dialog = "" }) { body -> model.run { model.mutate(api, "resources/$id/family", "POST", body); dialog = "" } }
        if (dialog == "attach") ResourcePicker(model, api, exclude = (data.a("variants").objects().map { it.s("id") } + data.o("primary").s("id")).toSet(), onDismiss = { dialog = "" }) { r -> model.run { model.mutate(api, "resources/$id/family", "POST", obj("existingResourceId" to r.s("id"))); dialog = "" } }
        if (dialog == "detach") Confirm("Variante lösen?", "Geerbte Angaben werden als eigene Angaben übernommen.", model.busy, { dialog = "" }) { model.run { model.mutate(api, "resources/$id/family", "DELETE"); dialog = "" } }
    }
}

@Composable fun RelationsScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    var types by remember { mutableStateOf(emptyList<Pair<String, String>>()) }
    var type by remember { mutableStateOf("") }
    var picker by remember { mutableStateOf(false) }
    var inverse by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(api.session.context) { try { types = api.call("relation-types").a("relationTypes").objects().filter { it.optBoolean("allowManual") && it.isNull("archivedAt") }.map { it.s("key") to it.s("label") }; type = types.firstOrNull()?.first.orEmpty() } catch (e: Exception) { model.message = e.message } }
    Remote(model, api, "resources/$id/relations") { data -> Page {
        Heading("Beziehungen")
        data.a("relations").objects().forEach { relation ->
            val outgoing = relation.s("sourceResourceId") == id
            val other = relation.o(if (outgoing) "target" else "source")
            LinkRow(other.s("name"), relation.o("relationType").s(if (outgoing) "label" else "inverseLabel", relation.s("relationTypeKey"))) { navigate("resource/${other.s("id")}") }
            if (api.session.allows("inventory.update", "write") && relation.s("origin") == "manual") TextButton(onClick = { remove = relation }) { Text("Beziehung entfernen") }
        }
        if (api.session.allows("inventory.update", "write")) Section("Neue Beziehung") {
            Choice("Art", type, types) { type = it }; Toggle("Dieser Eintrag ist das Ziel", inverse) { inverse = it }
            Button(enabled = type.isNotBlank(), onClick = { picker = true }) { Text("Eintrag auswählen") }
        }
    } }
    if (picker) ResourcePicker(model, api, exclude = setOf(id), onDismiss = { picker = false }) { target -> model.run {
        model.mutate(api, "resources/$id/relations", "POST", obj("sourceResourceId" to if (inverse) target.s("id") else id, "targetResourceId" to if (inverse) id else target.s("id"), "relationTypeKey" to type)); picker = false
    } }
    remove?.let { relation -> Confirm("Beziehung entfernen?", relation.o("relationType").s("label"), model.busy, { remove = null }) { model.run { api.call("relations/${relation.s("id")}", "DELETE", query = mapOf("resourceId" to id)); remove = null } } }
}

@Composable fun BomScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    Remote(model, api, "resources/$id/bom") { data ->
        var components by remember(data.toString()) { mutableStateOf(data.a("components").objects().map { it.copy() }) }
        var picker by remember { mutableStateOf(false) }
        var selected by remember { mutableStateOf<JSONObject?>(null) }
        var reset by remember { mutableStateOf(false) }
        val editable = api.session.allows("inventory.update", "write")
        Page {
            Heading("Stückliste", "${data.s("buildableQuantity", "0")} Baugruppen mit aktuellem Bestand möglich")
            if (!data.isNull("inheritance")) Notice("Geerbt von ${data.o("inheritance").s("primaryName")}. Änderungen werden als Abweichungen gespeichert.")
            components.forEach { component ->
                LinkRow(component.s("name"), "${component.s("quantityPerAssembly")} je Baugruppe · ${component.s("availableQuantity", "—")} verfügbar") { if (editable) selected = component else navigate("resource/${component.s("resourceId")}") }
                if (editable) TextButton(onClick = { components = components.filter { it !== component } }) { Text("Entfernen") }
            }
            if (editable) {
                OutlinedButton(onClick = { picker = true }) { Text("Komponente hinzufügen") }
                Button(enabled = !model.busy, onClick = { model.run {
                    val values = components.mapIndexed { index, c -> obj("resourceId" to c.s("resourceId"), "slotKey" to c.s("slotKey"), "quantityPerAssembly" to c.optInt("quantityPerAssembly", 1), "position" to index, "note" to c.s("note")) }
                    model.mutate(api, "resources/$id/bom", "PUT", obj("components" to JSONArray(values)))
                } }) { Text("Stückliste speichern") }
                if (!data.isNull("inheritance")) TextButton(onClick = { reset = true }) { Text("Abweichungen zurücksetzen") }
            }
        }
        if (picker) ResourcePicker(model, api, exclude = setOf(id), onDismiss = { picker = false }) { r -> components = components + obj("resourceId" to r.s("id"), "slotKey" to uuid(), "name" to r.s("name"), "quantityPerAssembly" to 1); picker = false }
        selected?.let { c -> FormDialog(c.s("name"), listOf(Field("quantityPerAssembly", "Menge je Baugruppe", "int", required = true), Field("note", "Notiz")), c, onDismiss = { selected = null }) { changed ->
            if (changed.optInt("quantityPerAssembly") <= 0) model.message = "Die Menge muss größer als null sein."
            else { components = components.map { if (it === c) c.copy().put("quantityPerAssembly", changed.optInt("quantityPerAssembly")).put("note", changed.s("note")) else it }; selected = null }
        } }
        if (reset) Confirm("Abweichungen zurücksetzen?", "Die Stückliste wird wieder von der Hauptressource übernommen.", model.busy, { reset = false }) { model.run { model.mutate(api, "resources/$id/bom", "DELETE"); reset = false } }
    }
}
