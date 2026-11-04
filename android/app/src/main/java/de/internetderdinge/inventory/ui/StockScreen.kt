package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

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
            Heading(data.o("resource").s("name"), "${data.o("resource").s("quantity")} ${config.s("unitName")} · ${if (config.s("trackingMode") == "serialized") "Einzelverfolgung" else L10n.text(R.string.ui_bulk_8dff8f29)}")
            if (manage) {
                Row { Button(onClick = { dialog = "movement" }) { Text(L10n.text(R.string.ui_book_stock_e4df72bd)) }; TextButton(onClick = { dialog = "config" }) { Text(L10n.text(R.string.ui_configure_4a51c9b7)) } }
                if (api.session.allows("ai.use", "ai")) OutlinedButton(onClick = { navigate("camera/count:$id") }) { Text(L10n.text(R.string.ui_count_with_camera_21d68c90)) }
            }
            Section(L10n.text(R.string.ui_planning_e6639d06)) {
                Text(L10n.text(R.string.ui_minimum_stock_0_reorder_1_a453f888, config.s("minimumStock"), config.s("reorderQuantity")))
                val f = data.o("forecast")
                Text(L10n.text(R.string.ui_average_daily_usage_0_b4b74efe, f.s("averageDailyUsage")))
                if (!f.isNull("daysUntilStockout")) Text(L10n.text(R.string.ui_days_of_stock_0_b70acec1, f.s("daysUntilStockout")))
                if (f.optBoolean("isBelowMinimum")) Notice(L10n.text(R.string.ui_below_minimum_stock_suggestion_reorder_0_3c6c18cc, f.s("suggestedReorderQuantity")))
                Text(L10n.text(R.string.ui_ordered_0_expected_stock_1_7286a57e, data.o("procurement").s("onOrder", "0"), data.o("procurement").s("projectedQuantity", "0")))
            }
            if (config.s("trackingMode") == "serialized") Section(L10n.text(R.string.ui_units_f2e92114)) {
                if (manage) OutlinedButton(onClick = { dialog = "units" }) { Text(L10n.text(R.string.ui_add_units_6f8e267d)) }
                data.a("units").objects().forEach { unit -> LinkRow(unit.s("code"), "${label(unit.s("status"))} · ${unit.s("location")}") { if (manage) { selected = unit; dialog = "unit" } } }
            }
            Section(L10n.text(R.string.ui_movements_06e68223)) {
                data.a("movements").objects().forEach { move -> ListItem(headlineContent = { Text("${move.s("delta")} → ${move.s("balanceAfter")}") }, supportingContent = { Text("${move.s("occurredAt")} · ${label(move.s("type"))}\n${move.s("note")}") }) }
                if (data.a("movements").length() == 0) Text(L10n.text(R.string.ui_no_movements_yet_beb57478))
            }
        }
        when (dialog) {
            "movement" -> FormDialog(L10n.text(R.string.ui_stock_movement_e740ea2d), listOf(Field("delta", L10n.text(R.string.ui_change_43f9b762), "int", required = true), Field("type", L10n.text(R.string.ui_kind_75df3579), "choice", listOf("receipt" to L10n.text(R.string.ui_goods_receipt_d84ec7ae), "issue" to L10n.text(R.string.ui_goods_issue_6a5beb89), "adjustment" to L10n.text(R.string.ui_adjustment_62bc7c7f), "return" to L10n.text(R.string.ui_return_6223760a), "waste" to L10n.text(R.string.ui_waste_295b9e6f), "transfer" to L10n.text(R.string.ui_transfer_dde8bef7))), Field("reason", L10n.text(R.string.ui_reason_b45f40c7)), Field("note", L10n.text(R.string.ui_note_74b487d9)), Field("location", L10n.text(R.string.ui_location_ecf34cc8))), obj("delta" to 1, "type" to "receipt"), onDismiss = { dialog = "" }) { review = it; dialog = "" }
            "config" -> FormDialog(L10n.text(R.string.ui_configure_stock_c1c0c5cc), listOf(Field("trackingMode", L10n.text(R.string.ui_tracking_28e5d3d4), "choice", listOf("bulk" to L10n.text(R.string.ui_quantity_1bece813), "serialized" to L10n.text(R.string.ui_individual_units_b2614fdf))), Field("minimumStock", L10n.text(R.string.ui_minimum_stock_0c96df5c), "int", required = true), Field("reorderQuantity", L10n.text(R.string.ui_reorder_quantity_aff18853), "int", required = true), Field("leadTimeDays", L10n.text(R.string.ui_lead_time_in_days_6a859361), "int", required = true), Field("unitName", L10n.text(R.string.ui_unit_d5ba1549))), config, model.busy, { dialog = "" }) { body -> model.run { model.mutate(api, "resources/$id/stock/config", "PATCH", body); dialog = "" } }
            "units" -> FormDialog(L10n.text(R.string.ui_add_units_6f8e267d), listOf(Field("count", L10n.text(R.string.ui_count_1_100_5e45ba49), "int"), Field("codes", L10n.text(R.string.ui_codes_one_per_line_eb642f60), "multiline"), Field("location", L10n.text(R.string.ui_location_ecf34cc8))), obj("count" to 1), model.busy, { dialog = "" }) { body -> model.run {
                val codes = body.s("codes").lines().map(String::trim).filter(String::isNotBlank); body.remove("codes")
                if (codes.isNotEmpty()) { body.remove("count"); body.put("codes", JSONArray(codes)) }
                require((if (codes.isEmpty()) body.optInt("count") else codes.size) in 1..100)
                model.mutate(api, "resources/$id/stock/units", "POST", body); dialog = ""
            } }
            "unit" -> FormDialog(selected.s("code"), listOf(Field("status", L10n.text(R.string.ui_status_920e413c), "choice", (listOf("available", "reserved", "in-use", "maintenance", "consumed", "lost", "retired")).map { it to label(it) }), Field("location", L10n.text(R.string.ui_location_ecf34cc8)), Field("reason", L10n.text(R.string.ui_reason_b45f40c7)), Field("note", L10n.text(R.string.ui_note_74b487d9))), selected, model.busy, { dialog = "" }) { body -> model.run { body.put("occurredAt", Instant.now().toString()); if (body.s("location").isBlank()) body.put("location", JSONObject.NULL); model.mutate(api, "resources/$id/stock/units/${selected.s("id")}", "PATCH", body); dialog = "" } }
        }
        review?.let { body -> Confirm(L10n.text(R.string.ui_review_stock_change_6bb00922), "${data.o("resource").s("name")}: ${data.o("resource").optInt("quantity")} → ${data.o("resource").optInt("quantity") + body.optInt("delta")}\n${body.s("note")}", model.busy, { review = null }) {
            model.run { require(body.optInt("delta") != 0) { L10n.text(R.string.ui_the_stock_change_must_not_be_zero_d6e19580) }; model.mutate(api, "resources/$id/stock/movements", "POST", body, true); review = null }
        } }
    }
}
