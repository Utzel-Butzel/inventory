package de.internetderdinge.inventory.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray

@Composable fun NotificationsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var unread by remember { mutableStateOf(false) }
    Remote(model, api, "notifications", mapOf("limit" to "100", "unreadOnly" to unread.toString())) { data -> Page {
        Heading("Benachrichtigungen", "${data.optInt("unread")} ungelesen")
        Toggle("Nur ungelesene", unread) { unread = it }
        Row { TextButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "notifications/read-all", "POST") } }) { Text("Alle gelesen") }; TextButton(onClick = { navigate("notification-settings") }) { Text("Einstellungen") } }
        if (data.a("notifications").length() == 0) Empty("Keine Benachrichtigungen")
        data.a("notifications").objects().forEach { notification ->
            ElevatedCard { Column(androidx.compose.ui.Modifier.padding(Spacing)) {
                Text((if (notification.isNull("readAt")) "● " else "") + notification.s("title"), style = MaterialTheme.typography.titleMedium)
                Text(notification.s("body")); Text(notification.s("createdAt"), style = MaterialTheme.typography.bodySmall)
                if (notification.s("resourceId").isNotBlank()) TextButton(onClick = { navigate("resource/${notification.s("resourceId")}") }) { Text("Eintrag öffnen") }
                if (notification.isNull("readAt")) TextButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "notifications/${notification.s("id")}", "PATCH") } }) { Text("Als gelesen markieren") }
            } }
        }
    } }
}
@Composable fun NotificationSettingsScreen(model: AppModel, api: Api) {
    val numeric = listOf("digestHour" to "Uhrzeit des Tagesberichts (0–23)", "cooldownHours" to "Pause zwischen Meldungen (Stunden)", "lowStockThresholdPercent" to "Mindestbestand-Schwelle (%)", "expiryWindowDays" to "Ablaufwarnung (Tage)", "maintenanceWindowDays" to "Wartungswarnung (Tage)", "returnDueWindowDays" to "Rückgabevorlauf (Tage)")
    val channels = listOf("email" to "E-Mail", "push" to "Web-Push", "slack" to "Slack", "teams" to "Teams", "webhook" to "Webhook")
    var preview by remember { mutableStateOf<String?>(null) }
    Remote(model, api, "notifications/preferences") { data ->
        var value by remember(data.toString()) { mutableStateOf(data.o("preference").copy()) }
        fun set(key: String, v: Any) { value = value.copy().put(key, v) }
        Page {
            Heading("Benachrichtigungen einstellen")
            Section("Ereignisse") { listOf("low_stock" to "Niedriger Bestand", "expiry" to "Ablaufdatum", "maintenance" to "Wartung", "return_due" to "Fällige Rückgabe").forEach { (key, title) ->
                val enabled = value.a("enabledEventTypes").strings(); Toggle(title, key in enabled) { set("enabledEventTypes", JSONArray(if (it) enabled + key else enabled - key)) }
            } }
            Choice("Häufigkeit", value.s("frequency"), listOf("daily" to "Täglich", "immediate" to "Sofort")) { set("frequency", it) }
            Choice("Sprache", value.s("locale"), listOf("de" to "Deutsch", "en" to "English")) { set("locale", it) }
            TextInput("Zeitzone", value.s("timezone"), { set("timezone", it) })
            numeric.forEach { (key, title) -> TextInput(title, value.s(key), { set(key, it) }, true) }
            TextInput("Feld für Ablaufdatum", value.s("expiryFieldKey"), { set("expiryFieldKey", it) })
            TextInput("Feld für Wartung", value.s("maintenanceFieldKey"), { set("maintenanceFieldKey", it) })
            Section("Kanäle") { channels.forEach { (key, title) ->
                Toggle(title, value.optBoolean("${key}Enabled")) { set("${key}Enabled", it) }
                Text(if (data.o("runtime").o(key).optBoolean("configured")) "Auf dem Server eingerichtet" else "Auf dem Server nicht eingerichtet", style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = !model.busy, onClick = {
                    model.run {
                        val result = api.call("notifications/test", "POST", obj("channel" to key))
                        preview = result.o("preview").let { p ->
                            "${p.s("subject")}\n" + p.a("events").objects().joinToString("\n\n") {
                                "${it.s("title")}\n${it.s("body") }"
                            }
                        }.trim().ifBlank { "Vorschau für $title geladen." }
                    }
                }) { Text("Vorschau") }
            } }
            Notice("Web-Push verwendet die im Browser registrierten Abonnements. Die Inbox ist direkt in der App verfügbar.")
            Button(enabled = !model.busy, onClick = { model.run {
                val body = obj()
                (listOf("enabledEventTypes", "frequency", "timezone", "locale", "expiryFieldKey", "maintenanceFieldKey") + channels.map { "${it.first}Enabled" }).forEach { key -> body.put(key, value.opt(key)) }
                numeric.forEach { (key, _) -> body.put(key, value.s(key).toInt()) }
                model.mutate(api, "notifications/preferences", "PATCH", body)
            } }) { Text("Einstellungen speichern") }
            preview?.let { Notice(it) }
        }
    }
}
