package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

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
            Heading(L10n.text(R.string.ui_variants_741cba75), L10n.text(R.string.ui_total_stock_0_47c5ca0c, data.o("summary").s("totalQuantity")))
            ResourceRow(api, data.o("primary")) { navigate("resource/${data.o("primary").s("id")}") }
            data.a("variants").objects().forEach { variant -> ResourceRow(api, variant) { navigate("resource/${variant.s("id")}") } }
            if (api.session.allows("inventory.update", "write")) {
                if (api.session.allows("inventory.create", "write")) Button(onClick = { dialog = "new" }) { Text(L10n.text(R.string.ui_create_variant_d0e1778f)) }
                OutlinedButton(onClick = { dialog = "attach" }) { Text(L10n.text(R.string.ui_link_existing_item_d2cb7372)) }
                if (data.s("role") == "variant") TextButton(onClick = { dialog = "detach" }) { Text(L10n.text(R.string.ui_unlink_variant_from_family_77afa1b8)) }
            }
        }
        if (dialog == "new") FormDialog(L10n.text(R.string.ui_new_variant_cbbbd7e7), listOf(Field("name", L10n.text(R.string.ui_name_dcd1d522), required = true), Field("sku", "SKU"), Field("barcode", L10n.text(R.string.ui_barcode_a401f372))), busy = model.busy, onDismiss = { dialog = "" }) { body -> model.run { model.mutate(api, "resources/$id/family", "POST", body); dialog = "" } }
        if (dialog == "attach") ResourcePicker(model, api, exclude = (data.a("variants").objects().map { it.s("id") } + data.o("primary").s("id")).toSet(), onDismiss = { dialog = "" }) { r -> model.run { model.mutate(api, "resources/$id/family", "POST", obj("existingResourceId" to r.s("id"))); dialog = "" } }
        if (dialog == "detach") Confirm(L10n.text(R.string.ui_unlink_variant_9f69e44b), L10n.text(R.string.ui_inherited_details_are_kept_as_local_details_21434a10), model.busy, { dialog = "" }) { model.run { model.mutate(api, "resources/$id/family", "DELETE"); dialog = "" } }
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
        Heading(L10n.text(R.string.ui_relationships_80a6bf24))
        data.a("relations").objects().forEach { relation ->
            val outgoing = relation.s("sourceResourceId") == id
            val other = relation.o(if (outgoing) "target" else "source")
            LinkRow(other.s("name"), relation.o("relationType").s(if (outgoing) "label" else "inverseLabel", relation.s("relationTypeKey"))) { navigate("resource/${other.s("id")}") }
            if (api.session.allows("inventory.update", "write") && relation.s("origin") == "manual") TextButton(onClick = { remove = relation }) { Text(L10n.text(R.string.ui_remove_relationship_d2dd7825)) }
        }
        if (api.session.allows("inventory.update", "write")) Section(L10n.text(R.string.ui_new_relationship_177e281a)) {
            Choice(L10n.text(R.string.ui_kind_75df3579), type, types) { type = it }; Toggle(L10n.text(R.string.ui_this_item_is_the_destination_e2d8bb04), inverse) { inverse = it }
            Button(enabled = type.isNotBlank(), onClick = { picker = true }) { Text(L10n.text(R.string.ui_select_item_cbcea774)) }
        }
    } }
    if (picker) ResourcePicker(model, api, exclude = setOf(id), onDismiss = { picker = false }) { target -> model.run {
        model.mutate(api, "resources/$id/relations", "POST", obj("sourceResourceId" to if (inverse) target.s("id") else id, "targetResourceId" to if (inverse) id else target.s("id"), "relationTypeKey" to type)); picker = false
    } }
    remove?.let { relation -> Confirm(L10n.text(R.string.ui_remove_relationship_e69ff42d), relation.o("relationType").s("label"), model.busy, { remove = null }) { model.run { api.call("relations/${relation.s("id")}", "DELETE", query = mapOf("resourceId" to id)); remove = null } } }
}

@Composable fun BomScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    Remote(model, api, "resources/$id/bom") { data ->
        var components by remember(data.toString()) { mutableStateOf(data.a("components").objects().map { it.copy() }) }
        var picker by remember { mutableStateOf(false) }
        var selected by remember { mutableStateOf<JSONObject?>(null) }
        var reset by remember { mutableStateOf(false) }
        val editable = api.session.allows("inventory.update", "write")
        Page {
            Heading(L10n.text(R.string.ui_bill_of_materials_2a456394), L10n.text(R.string.ui_assemblies_possible_with_current_stock_0_d44ab32d, data.s("buildableQuantity", "0")))
            if (!data.isNull("inheritance")) Notice(L10n.text(R.string.ui_inherited_from_0_changes_are_saved_as_5bc2359a, data.o("inheritance").s("primaryName")))
            components.forEach { component ->
                LinkRow(component.s("name"), L10n.text(R.string.ui_0_per_assembly_1_available_cab8d3ba, component.s("quantityPerAssembly"), component.s("availableQuantity", "—"))) { if (editable) selected = component else navigate("resource/${component.s("resourceId")}") }
                if (editable) TextButton(onClick = { components = components.filter { it !== component } }) { Text(L10n.text(R.string.ui_remove_3828375a)) }
            }
            if (editable) {
                OutlinedButton(onClick = { picker = true }) { Text(L10n.text(R.string.ui_add_component_16e8ac36)) }
                Button(enabled = !model.busy, onClick = { model.run {
                    val values = components.mapIndexed { index, c -> obj("resourceId" to c.s("resourceId"), "slotKey" to c.s("slotKey"), "quantityPerAssembly" to c.optInt("quantityPerAssembly", 1), "position" to index, "note" to c.s("note")) }
                    model.mutate(api, "resources/$id/bom", "PUT", obj("components" to JSONArray(values)))
                } }) { Text(L10n.text(R.string.ui_save_bom_5ac30493)) }
                if (!data.isNull("inheritance")) TextButton(onClick = { reset = true }) { Text(L10n.text(R.string.ui_reset_overrides_fff71c61)) }
            }
        }
        if (picker) ResourcePicker(model, api, exclude = setOf(id), onDismiss = { picker = false }) { r -> components = components + obj("resourceId" to r.s("id"), "slotKey" to uuid(), "name" to r.s("name"), "quantityPerAssembly" to 1); picker = false }
        selected?.let { c -> FormDialog(c.s("name"), listOf(Field("quantityPerAssembly", L10n.text(R.string.ui_quantity_per_assembly_49ec6ecd), "int", required = true), Field("note", L10n.text(R.string.ui_note_74b487d9))), c, onDismiss = { selected = null }) { changed ->
            if (changed.optInt("quantityPerAssembly") <= 0) model.message = L10n.text(R.string.ui_the_quantity_must_be_greater_than_zero_e44d1e2e)
            else { components = components.map { if (it === c) c.copy().put("quantityPerAssembly", changed.optInt("quantityPerAssembly")).put("note", changed.s("note")) else it }; selected = null }
        } }
        if (reset) Confirm(L10n.text(R.string.ui_reset_overrides_606fe630), L10n.text(R.string.ui_the_bill_of_materials_will_be_inherited_ce40525c), model.busy, { reset = false }) { model.run { model.mutate(api, "resources/$id/bom", "DELETE"); reset = false } }
    }
}
