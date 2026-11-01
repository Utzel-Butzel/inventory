package de.internetderdinge.inventory.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapView
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.maps.MapLibreMap
import kotlin.math.*

@Composable fun MapScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    var resources by remember { mutableStateOf(emptyList<JSONObject>()) }; var error by remember { mutableStateOf<String?>(null) }; var loading by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(api.session.context, model.revision) {
        try {
            val all = mutableListOf<JSONObject>(); var page = 1
            do { val response = api.call("resources", query = mapOf("page" to "$page", "pageSize" to "100")); all += response.a("resources").objects(); val pages = response.o("pagination").optInt("pages"); page++ } while (page <= pages)
            resources = all
        } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message } finally { loading = false }
    }
    val filtered = resources.filter { r -> query.trim().split(Regex("\\s+")).all { term -> listOf(r.s("name"), r.s("sku"), r.s("location"), r.a("tags").strings().joinToString()).any { it.contains(term, ignoreCase = true) } } }
    val positioned = filtered.filter { !it.isNull("gpsLatitude") && !it.isNull("gpsLongitude") }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(20.dp)) {
            Heading("Inventar auf der Karte", "${positioned.size} Einträge mit GPS-Position")
            TextInput("Name, SKU, Tag oder Ort", query, { query = it })
            if (positioned.size < filtered.size) Text("${filtered.size - positioned.size} Treffer ohne GPS-Position", style = MaterialTheme.typography.bodySmall)
            error?.let { Notice(it, true) }; if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        NativeMap(positioned, Modifier.weight(1f)) { navigate("resource/$it") }
    }
}
@Suppress("DEPRECATION")
@Composable private fun NativeMap(resources: List<JSONObject>, modifier: Modifier, onSelect: (String) -> Unit) {
    val context = LocalContext.current; val lifecycle = LocalLifecycleOwner.current.lifecycle
    val view = remember { MapLibre.getInstance(context); MapView(context).apply { onCreate(null) } }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }; var ready by remember { mutableStateOf(false) }
    val latest by rememberUpdatedState(onSelect)
    val ids = remember { mutableMapOf<Long, String>() }
    AndroidView({ view }, modifier)
    DisposableEffect(view, lifecycle) {
        view.getMapAsync { m ->
            map = m
            m.setStyle("https://tiles.openfreemap.org/styles/liberty") { ready = true }
            m.setOnInfoWindowClickListener { marker -> ids[marker.id]?.let(latest); true }
        }
        val observer = LifecycleEventObserver { _, event -> when (event) {
            Lifecycle.Event.ON_START -> view.onStart(); Lifecycle.Event.ON_RESUME -> view.onResume(); Lifecycle.Event.ON_PAUSE -> view.onPause(); Lifecycle.Event.ON_STOP -> view.onStop(); else -> Unit
        } }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        onDispose { lifecycle.removeObserver(observer); view.onPause(); view.onStop(); view.onDestroy() }
    }
    LaunchedEffect(ready, resources) {
        val m = map ?: return@LaunchedEffect
        if (!ready) return@LaunchedEffect
        m.clear(); ids.clear()
        val points = resources.map { LatLng(it.optDouble("gpsLatitude"), it.optDouble("gpsLongitude")) }
        resources.zip(points).forEach { (r, position) -> val marker = m.addMarker(MarkerOptions().position(position).title(r.s("name")).snippet("${r.s("location")} · Details öffnen")); ids[marker.id] = r.s("id") }
        if (points.size == 1) m.cameraPosition = CameraPosition.Builder().target(points.first()).zoom(15.0).build()
        else if (points.size > 1) m.animateCamera(org.maplibre.android.camera.CameraUpdateFactory.newLatLngBounds(LatLngBounds.Builder().includes(points).build(), 80))
        else m.cameraPosition = CameraPosition.Builder().target(LatLng(51.0, 10.0)).zoom(4.0).build()
    }
}
@Composable fun RoomsScreen(model: AppModel, api: Api, navigate: (String) -> Unit) {
    Remote(model, api, "room-scans") { data -> Page {
        Heading("Räume", "Gespeicherte Räume, Etagen und Inventarplätze")
        if (data.a("scans").length() == 0) Empty("Noch keine Raumscans", "Gespeicherte Scans werden hier angezeigt.")
        data.a("scans").objects().groupBy { it.s("structureName", "Einzelne Räume") }.forEach { (structure, scans) -> Section(structure) {
            scans.forEach { scan -> LinkRow(scan.s("roomName"), listOf(scan.s("floorIdentifier"), "${scan.s("placementCount", "0")} Einträge", "Version ${scan.s("revision")}").filter { it.isNotBlank() }.joinToString(" · ")) { navigate("room/${scan.s("id")}") } }
        } }
        Notice("Die RoomPlan-Raumerfassung und das Wiederfinden einer gespeicherten ARWorldMap benötigen ein unterstütztes Apple-Gerät. Vorhandene Raumgeometrie und Platzierungen sind hier sichtbar.")
    } }
}
@Composable fun RoomScreen(model: AppModel, api: Api, id: String, navigate: (String) -> Unit) {
    Remote(model, api, "room-scans/$id") { data ->
        val manifest = data.o("scene"); val scene = manifest.o("scan").o("scene")
        var top by remember { mutableStateOf(false) }
        Page {
            Heading(manifest.o("room").s("name"), manifest.o("scan").s("structureName"))
            Toggle("Grundriss von oben", top) { top = it }
            RoomCanvas(scene, manifest.a("placements").objects(), top, Modifier.fillMaxWidth().height(380.dp))
            Text("Mit zwei Fingern zoomen, drehen und verschieben.", style = MaterialTheme.typography.bodySmall)
            Section("Inventar im Raum") {
                manifest.a("placements").objects().forEach { p -> LinkRow(p.o("resource").s("name"), "${p.o("resource").s("location")} · ${(p.optDouble("confidence") * 100).toInt()} %") { navigate("resource/${p.o("resource").s("id")}") } }
                if (manifest.a("placements").length() == 0) Text("Noch keine Einträge platziert.")
            }
            Section("Raumansichten") { manifest.o("scan").a("keyframes").objects().forEach { frame -> ResourceImage(api, frame.s("url").ifEmpty { "/api/v1/room-scans/$id/keyframes/${frame.s("id")}" }, Modifier.fillMaxWidth().height(200.dp), "Gespeicherte Raumansicht") } }
        }
    }
}

/** Projects the server's column-major room geometry directly into a native canvas.
 * No ARKit world map is interpreted or mixed with a new Android tracking origin. */
@Composable private fun RoomCanvas(scene: JSONObject, placements: List<JSONObject>, top: Boolean, modifier: Modifier) {
    var rotation by remember { mutableFloatStateOf(.55f) }; var zoom by remember { mutableFloatStateOf(1f) }; var pan by remember { mutableStateOf(Offset.Zero) }
    val primary = MaterialTheme.colorScheme.primary
    val line = MaterialTheme.colorScheme.onSurfaceVariant
    Canvas(modifier.pointerInput(Unit) { detectTransformGestures { _, move, scale, angle -> pan += move; zoom = (zoom * scale).coerceIn(.2f, 8f); rotation += angle * PI.toFloat() / 180 } }) {
        val bounds = scene.o("bounds"); val min = bounds.a("min"); val max = bounds.a("max")
        val cx = (min.optDouble(0, -2.0) + max.optDouble(0, 2.0)) / 2
        val cy = (min.optDouble(1, 0.0) + max.optDouble(1, 3.0)) / 2
        val cz = (min.optDouble(2, -2.0) + max.optDouble(2, 2.0)) / 2
        val span = maxOf(max.optDouble(0, 2.0) - min.optDouble(0, -2.0), max.optDouble(2, 2.0) - min.optDouble(2, -2.0), max.optDouble(1, 3.0) - min.optDouble(1, 0.0), 1.0)
        val scale = minOf(size.width, size.height) / span * .65 * zoom
        fun project(x: Double, y: Double, z: Double): Offset {
            val a = (x - cx) * cos(rotation) - (z - cz) * sin(rotation)
            val b = (x - cx) * sin(rotation) + (z - cz) * cos(rotation)
            val height = if (top) b else b * .5 - (y - cy) * .85
            return Offset(size.width / 2 + (a * scale).toFloat(), size.height / 2 + (height * scale).toFloat()) + pan
        }
        (scene.a("surfaces").objects() + scene.a("objects").objects()).forEach { part ->
            val d = part.a("dimensions"); val m = part.a("transform")
            if (m.length() != 16) return@forEach
            val corners = (0..7).map { i ->
                val x = d.optDouble(0) * if (i and 1 == 0) -.5 else .5
                val y = d.optDouble(1) * if (i and 2 == 0) -.5 else .5
                val z = d.optDouble(2) * if (i and 4 == 0) -.5 else .5
                project(m.optDouble(0) * x + m.optDouble(4) * y + m.optDouble(8) * z + m.optDouble(12), m.optDouble(1) * x + m.optDouble(5) * y + m.optDouble(9) * z + m.optDouble(13), m.optDouble(2) * x + m.optDouble(6) * y + m.optDouble(10) * z + m.optDouble(14))
            }
            val color = if (part.s("category") in listOf("wall", "floor", "door", "window")) line else primary
            listOf(listOf(0, 1, 5, 4), listOf(2, 3, 7, 6), listOf(0, 1, 3, 2), listOf(4, 5, 7, 6), listOf(0, 2, 6, 4), listOf(1, 3, 7, 5)).forEach { face ->
                val path = Path().apply { moveTo(corners[face.first()].x, corners[face.first()].y); face.drop(1).forEach { lineTo(corners[it].x, corners[it].y) }; close() }
                drawPath(path, color.copy(alpha = .06f)); drawPath(path, color.copy(alpha = .6f), style = Stroke(1.dp.toPx()))
            }
        }
        placements.forEach { p -> val v = p.a("position"); drawCircle(primary, 7.dp.toPx(), project(v.optDouble(0), v.optDouble(1), v.optDouble(2))) }
    }
}
