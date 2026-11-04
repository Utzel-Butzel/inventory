@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package de.internetderdinge.inventory

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

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
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }
    private fun handleIntent(intent: Intent?) {
        if (intent?.data?.scheme == BrowserSignIn.SCHEME) {
            val callback = intent.data.toString()
            intent.data = null
            model.handleBrowserCallback(callback)
            return
        }
        intent?.data?.takeIf { it.scheme == "inventory" }?.toString()?.let { value ->
            val link = InventoryLink.parse(value)
            if (link != null) model.pendingLink = link else model.message = L10n.text(R.string.ui_this_inventory_link_is_invalid_c2b61cdd)
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
    if (model.pendingBrowser != null) {
        androidx.compose.ui.window.Dialog(onDismissRequest = { model.cancelBrowserSignIn() }) {
            Surface(shape = MaterialTheme.shapes.large) {
                Column(Modifier.padding(24.dp)) {
                    Text(L10n.text(R.string.ui_browser_sign_in_pending))
                    TextButton(onClick = { model.cancelBrowserSignIn() }, enabled = !model.busy) { Text(L10n.text(R.string.ui_cancel_f7ff1178)) }
                }
            }
        }
    }
    if (model.loading) { Surface(Modifier.fillMaxSize()) { Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) { CircularProgressIndicator() } }; return }
    if (api == null && model.recoveryError != null) {
        Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
            Column(Modifier.padding(padding).padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.Center) {
                Text(L10n.text(R.string.ui_connection_unavailable), style = MaterialTheme.typography.headlineSmall)
                Text(model.recoveryError.orEmpty())
                Button(onClick = { model.restoreSession() }, enabled = !model.busy) { Text(L10n.text(R.string.ui_retry_session)) }
                if (!model.credentialLoadFailed) AccountSwitcher(model) { model.showLoginAfterRecovery() }
            }
        }
        return
    }
    if (api == null) {
        Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding -> Box(Modifier.padding(padding)) { LoginScreen(model) } }
        return
    }
    // A successful reconnect to the same account also returns from the login form.
    key(api.session.context, model.connectionRevision) {
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
            else model.message = L10n.text(R.string.ui_this_link_belongs_to_another_server_or_242a142c)
        } }
        val destinations = listOf(Triple("inventory", L10n.text(R.string.ui_inventory_d602900f), Icons.Outlined.Inventory2), Triple("map", L10n.text(R.string.ui_map_36a8c499), Icons.Outlined.Map)) +
            (if (api.session.allows("spatial.read")) listOf(Triple("rooms", L10n.text(R.string.ui_rooms_c8bb1368), Icons.Outlined.ViewInAr)) else emptyList()) +
            listOf(Triple("settings", L10n.text(R.string.ui_more_80dc77bc), Icons.Outlined.MoreHoriz))
        BoxWithConstraints {
            val rail = maxWidth >= 840.dp
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = {
                TopAppBar(title = { Text(if (history.isEmpty()) "Inventory" else screenTitle(route)) }, navigationIcon = {
                    if (history.isNotEmpty()) IconButton(onClick = { back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, L10n.text(R.string.ui_previous_548611ce)) }
                }, actions = {
                    if (route == "inventory") AccountSwitcher(model) { navigate("login") }
                    if (route == "inventory") IconButton(onClick = { navigate("notifications") }) { Icon(Icons.Outlined.Notifications, L10n.text(R.string.ui_notifications_f7205df4)) }
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
                        "login" -> LoginScreen(model)
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
private fun screenTitle(route: String): String = mapOf("resource" to L10n.text(R.string.ui_details_45989de4), "edit" to L10n.text(R.string.ui_edit_84e45ee7), "new" to L10n.text(R.string.ui_new_item_c325efcf), "stock" to L10n.text(R.string.ui_stock_82cb99ec), "assignments" to L10n.text(R.string.ui_loans_assignments_931054aa), "family" to L10n.text(R.string.ui_variants_741cba75), "relations" to L10n.text(R.string.ui_relationships_80a6bf24), "bom" to L10n.text(R.string.ui_bill_of_materials_2a456394), "translations" to L10n.text(R.string.ui_translations_22c9ef6d), "ai" to L10n.text(R.string.ui_ai_tools_ac717458), "media" to L10n.text(R.string.ui_media_0031e362), "camera" to L10n.text(R.string.ui_camera_32edeecd), "flow" to L10n.text(R.string.ui_workflow_0560f3a1), "room" to L10n.text(R.string.ui_room_d2fc5e58), "loans" to L10n.text(R.string.ui_loans_ca70339f), "requests" to L10n.text(R.string.ui_requests_5dfb5bcd), "request" to L10n.text(R.string.ui_request_d131ffca), "new-request" to L10n.text(R.string.ui_new_request_d6b3176f), "notifications" to L10n.text(R.string.ui_notifications_f7205df4), "notification-settings" to L10n.text(R.string.ui_notifications_f7205df4), "jobs" to L10n.text(R.string.ui_uploads_operations_5c8e7a6f), "references" to L10n.text(R.string.ui_workspace_6a85b576), "ai-settings" to L10n.text(R.string.ui_ai_defaults_dec724c7))[route.substringBefore('/')] ?: "Inventory"
