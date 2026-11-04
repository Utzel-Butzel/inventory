package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray

@Composable fun NotificationsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var unread by remember { mutableStateOf(false) }
    Remote(model, api, "notifications", mapOf("limit" to "100", "unreadOnly" to unread.toString())) { data -> Page {
        Heading(L10n.text(R.string.ui_notifications_f7205df4), L10n.text(R.string.ui_0_unread_d2a37de5, data.optInt("unread")))
        Toggle(L10n.text(R.string.ui_unread_only_e7f3c3d5), unread) { unread = it }
        Row { TextButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "notifications/read-all", "POST") } }) { Text(L10n.text(R.string.ui_all_read_fbaa45b3)) }; TextButton(onClick = { navigate("notification-settings") }) { Text(L10n.text(R.string.ui_settings_f5750a5d)) } }
        if (data.a("notifications").length() == 0) Empty(L10n.text(R.string.ui_no_notifications_d4c242c5))
        data.a("notifications").objects().forEach { notification ->
            ElevatedCard { Column(androidx.compose.ui.Modifier.padding(Spacing)) {
                Text((if (notification.isNull("readAt")) "● " else "") + notification.s("title"), style = MaterialTheme.typography.titleMedium)
                Text(notification.s("body")); Text(notification.s("createdAt"), style = MaterialTheme.typography.bodySmall)
                if (notification.s("resourceId").isNotBlank()) TextButton(onClick = { navigate("resource/${notification.s("resourceId")}") }) { Text(L10n.text(R.string.ui_open_item_1d55cb86)) }
                if (notification.isNull("readAt")) TextButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "notifications/${notification.s("id")}", "PATCH") } }) { Text(L10n.text(R.string.ui_mark_as_read_2bd6f01e)) }
            } }
        }
    } }
}
@Composable fun NotificationSettingsScreen(model: AppModel, api: Api) {
    val numeric = listOf("digestHour" to L10n.text(R.string.ui_daily_report_hour_0_23_2ac092f0), "cooldownHours" to L10n.text(R.string.ui_interval_between_notifications_hours_102c0f73), "lowStockThresholdPercent" to L10n.text(R.string.ui_minimum_stock_threshold_ed9a1479), "expiryWindowDays" to L10n.text(R.string.ui_expiry_warning_days_b8e6df13), "maintenanceWindowDays" to L10n.text(R.string.ui_maintenance_warning_days_8b5fc0e1), "returnDueWindowDays" to L10n.text(R.string.ui_return_notice_days_80f3b890))
    val channels = listOf("email" to L10n.text(R.string.ui_email_2fae6fb3), "push" to L10n.text(R.string.ui_web_push_612db5b2), "slack" to L10n.text(R.string.ui_slack_b27fb38b), "teams" to "Teams", "webhook" to "Webhook")
    var preview by remember { mutableStateOf<String?>(null) }
    Remote(model, api, "notifications/preferences") { data ->
        var value by remember(data.toString()) { mutableStateOf(data.o("preference").copy()) }
        fun set(key: String, v: Any) { value = value.copy().put(key, v) }
        Page {
            Heading(L10n.text(R.string.ui_configure_notifications_7a0d5403))
            Section(L10n.text(R.string.ui_events_39ad2342)) { listOf("low_stock" to L10n.text(R.string.ui_low_stock_a6c3211e), "expiry" to L10n.text(R.string.ui_expiry_fa1bc3d0), "maintenance" to L10n.text(R.string.ui_maintenance_854f69bd), "return_due" to L10n.text(R.string.ui_return_due_7a36c8b2)).forEach { (key, title) ->
                val enabled = value.a("enabledEventTypes").strings(); Toggle(title, key in enabled) { set("enabledEventTypes", JSONArray(if (it) enabled + key else enabled - key)) }
            } }
            Choice(L10n.text(R.string.ui_frequency_19e70841), value.s("frequency"), listOf("daily" to L10n.text(R.string.ui_daily_39d3b69f), "immediate" to L10n.text(R.string.ui_immediate_02f195c0))) { set("frequency", it) }
            Choice(L10n.text(R.string.ui_language_f2a1cc71), value.s("locale"), listOf("de" to "Deutsch", "en" to "English")) { set("locale", it) }
            TextInput(L10n.text(R.string.ui_time_zone_00507b23), value.s("timezone"), { set("timezone", it) })
            numeric.forEach { (key, title) -> TextInput(title, value.s(key), { set(key, it) }, true) }
            TextInput(L10n.text(R.string.ui_expiry_date_field_a59b7f17), value.s("expiryFieldKey"), { set("expiryFieldKey", it) })
            TextInput(L10n.text(R.string.ui_maintenance_field_5badf6ea), value.s("maintenanceFieldKey"), { set("maintenanceFieldKey", it) })
            Section(L10n.text(R.string.ui_channels_d459d5e6)) { channels.forEach { (key, title) ->
                Toggle(title, value.optBoolean("${key}Enabled")) { set("${key}Enabled", it) }
                Text(if (data.o("runtime").o(key).optBoolean("configured")) L10n.text(R.string.ui_configured_on_server_41fc5ba8) else L10n.text(R.string.ui_not_configured_on_server_3d080ba0), style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !model.busy, onClick = {
                    model.run {
                        val result = api.call("notifications/test", "POST", obj("channel" to key))
                        preview = result.o("preview").let { p ->
                            "${p.s("subject")}\n" + p.a("events").objects().joinToString("\n\n") {
                                "${it.s("title")}\n${it.s("body") }"
                            }
                        }.trim().ifBlank { L10n.text(R.string.ui_preview_loaded_for_0_9c306673, title) }
                    }
                }) { Text(L10n.text(R.string.ui_preview_69337f6d)) }
            } }
            Notice(L10n.text(R.string.ui_web_push_uses_subscriptions_registered_in_the_4821f555))
            Button(enabled = !model.busy, onClick = { model.run {
                val body = obj()
                (listOf("enabledEventTypes", "frequency", "timezone", "locale", "expiryFieldKey", "maintenanceFieldKey") + channels.map { "${it.first}Enabled" }).forEach { key -> body.put(key, value.opt(key)) }
                numeric.forEach { (key, _) -> body.put(key, value.s(key).toInt()) }
                model.mutate(api, "notifications/preferences", "PATCH", body)
            } }) { Text(L10n.text(R.string.ui_save_settings_337972dc)) }
            preview?.let { Notice(it) }
        }
    }
}
