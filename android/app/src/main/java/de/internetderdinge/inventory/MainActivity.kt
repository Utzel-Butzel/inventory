@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package de.internetderdinge.inventory

import android.content.Intent
import android.os.Bundle
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import de.internetderdinge.inventory.data.*
import de.internetderdinge.inventory.ui.*

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge(); handleIntent(intent)
        setContent { InventoryTheme { InventoryRoot(model) } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(intent: Intent?) {
        intent?.data?.takeIf { it.scheme == "inventory" }?.toString()?.let { value ->
            val link = InventoryLink.parse(value)
            if (link != null) model.pendingLink = link else model.message = "Dieser Inventarlink ist ungültig."
        }
    }
}

@Composable fun InventoryTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val colors = if (Build.VERSION.SDK_INT >= 31) { if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context) }
    else if (dark) darkColorScheme(primary = Color(0xFFB6C4FF)) else lightColorScheme(primary = Color(0xFF254EDB), background = Color(0xFFF7F9FC))
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable fun InventoryRoot(model: AppModel) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(model.message) { model.message?.let { snackbar.showSnackbar(it); model.message = null } }
    val api = model.api
    if (model.loading) { Surface(Modifier.fillMaxSize()) { Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) { CircularProgressIndicator() } }; return }
    if (api == null) {
        Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding -> Box(Modifier.padding(padding)) { LoginScreen(model) } }
        return
    }
    key(api.session.context) {
        val imageContext = LocalContext.current
        val imageLoader = remember { coil.ImageLoader.Builder(imageContext).okHttpClient(Api.client).diskCache(null).build() }
        DisposableEffect(imageLoader) { onDispose { imageLoader.shutdown() } }
        CompositionLocalProvider(LocalInventoryImageLoader provides imageLoader) {
        var route by rememberSaveable { mutableStateOf("inventory") }
        var history by rememberSaveable { mutableStateOf(listOf<String>()) }
        fun navigate(next: String) { history = history + route; route = next }
        fun back() { route = history.lastOrNull() ?: "inventory"; history = history.dropLast(1) }
        BackHandler(history.isNotEmpty()) { back() }
        LaunchedEffect(model.pendingCode) { if (model.pendingCode != null && route != "camera/scan") navigate("camera/scan") }
        LaunchedEffect(model.pendingLink) { model.pendingLink?.let { link ->
            model.pendingLink = null
            if (link.matches(api.session)) navigate(if (link.unitId == null) "resource/${link.resourceId}" else "stock/${link.resourceId}?unit=${link.unitId}")
            else model.message = "Dieser Link gehört zu einem anderen Server oder Arbeitsbereich. Bitte zuerst das passende Konto auswählen und den Link erneut öffnen."
        } }
        val destinations = listOf(Triple("inventory", "Inventar", Icons.Outlined.Inventory2), Triple("map", "Karte", Icons.Outlined.Map)) +
            (if (api.session.allows("spatial.read")) listOf(Triple("rooms", "Räume", Icons.Outlined.ViewInAr)) else emptyList()) +
            listOf(Triple("settings", "Mehr", Icons.Outlined.MoreHoriz))
        BoxWithConstraints {
            val rail = maxWidth >= 840.dp
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = {
                TopAppBar(title = { Text(if (history.isEmpty()) "Inventory" else screenTitle(route)) }, navigationIcon = {
                    if (history.isNotEmpty()) IconButton(onClick = { back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Zurück") }
                }, actions = {
                    if (route == "inventory") IconButton(onClick = { navigate("notifications") }) { Icon(Icons.Outlined.Notifications, "Benachrichtigungen") }
                    if (model.busy) CircularProgressIndicator(Modifier.padding(12.dp).size(22.dp), strokeWidth = 2.dp)
                })
            }, bottomBar = {
                if (!rail && history.isEmpty()) NavigationBar { destinations.forEach { (id, title, icon) ->
                    NavigationBarItem(selected = route == id, onClick = { route = id }, icon = { Icon(icon, title) }, label = { Text(title) })
                } }
            }) { padding -> Row(Modifier.padding(padding).fillMaxSize()) {
                if (rail) NavigationRail { destinations.forEach { (id, title, icon) -> NavigationRailItem(selected = route == id, onClick = { history = emptyList(); route = id }, icon = { Icon(icon, title) }, label = { Text(title) }) } }
                Box(Modifier.weight(1f)) {
                    val id = route.substringAfter('/', "")
                    when (route.substringBefore('/')) {
                        "inventory" -> InventoryScreen(model, api, ::navigate)
                        "resource" -> ResourceScreen(model, api, id, ::navigate, ::back)
                        "edit" -> ResourceEditor(model, api, id.ifEmpty { null }, ::back)
                        "new" -> ResourceEditor(model, api, null, ::back)
                        "stock" -> StockScreen(model, api, id.substringBefore('?'), ::navigate, id.substringAfter("?unit=", "").ifBlank { null })
                        "assignments" -> AssignmentsScreen(model, api, id)
                        "family" -> FamilyScreen(model, api, id, ::navigate)
                        "relations" -> RelationsScreen(model, api, id, ::navigate)
                        "bom" -> BomScreen(model, api, id, ::navigate)
                        "translations" -> TranslationsScreen(model, api, id)
                        "ai" -> AIScreen(model, api, id)
                        "media" -> MediaScreen(model, api, id)
                        "camera" -> CameraScreen(model, api, id, ::navigate, ::back)
                        "flow" -> FlowScreen(model, api, id, ::back)
                        "map" -> MapScreen(model, api, ::navigate)
                        "rooms" -> RoomsScreen(model, api, ::navigate)
                        "room" -> RoomScreen(model, api, id, ::navigate)
                        "loans" -> LoansScreen(model, api, ::navigate)
                        "requests" -> RequestsScreen(model, api, ::navigate)
                        "request" -> RequestScreen(model, api, id, ::navigate)
                        "new-request" -> NewRequestScreen(model, api, ::back)
                        "notifications" -> NotificationsScreen(model, api, ::navigate)
                        "notification-settings" -> NotificationSettingsScreen(model, api)
                        "jobs" -> JobsScreen(model, api, ::navigate)
                        "settings" -> SettingsScreen(model, api, ::navigate)
                        "references" -> ReferenceScreen(model, api, id)
                        "ai-settings" -> AISettingsScreen(model, api)
                        else -> Empty()
                    }
                }
            } }
        }
        }
    }
}
private fun screenTitle(route: String): String = mapOf("resource" to "Details", "edit" to "Bearbeiten", "new" to "Neuer Eintrag", "stock" to "Bestand", "assignments" to "Ausleihe & Zuweisung", "family" to "Varianten", "relations" to "Beziehungen", "bom" to "Stückliste", "translations" to "Übersetzungen", "ai" to "KI-Werkzeuge", "media" to "Medien", "camera" to "Kamera", "flow" to "Aktionsablauf", "room" to "Raum", "loans" to "Ausleihen", "requests" to "Anfragen", "request" to "Anfrage", "new-request" to "Neue Anfrage", "notifications" to "Benachrichtigungen", "notification-settings" to "Benachrichtigungen", "jobs" to "Uploads & Vorgänge", "references" to "Arbeitsbereich", "ai-settings" to "KI-Vorgaben")[route.substringBefore('/')] ?: "Inventory"
