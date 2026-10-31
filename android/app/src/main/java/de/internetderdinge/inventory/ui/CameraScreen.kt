@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package de.internetderdinge.inventory.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.provider.MediaStore
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.google.mlkit.vision.documentscanner.*
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Composable fun CameraScreen(model: AppModel, api: Api, initial: String, navigate: (String) -> Unit, back: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var permission by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permission = it }
    var gps by remember { mutableStateOf(false) }
    val locationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { gps = it[Manifest.permission.ACCESS_FINE_LOCATION] == true || it[Manifest.permission.ACCESS_COARSE_LOCATION] == true }
    val itemId = initial.substringAfter(':', "").takeIf { it.isNotBlank() }
    val modes = listOfNotNull(if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) "capture" to "Erfassen" else null,
        if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) "video" to "Video" else null,
        if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) "document" to "Dokument" else null,
        "scan" to "Scannen", if (api.session.allows("ai.use", "ai")) "recognize" to "Erkennen" else null, if (api.session.allows("ai.use", "ai")) "count" to "Zählen" else null)
    var mode by remember { mutableStateOf(initial.substringBefore(':').takeIf { v -> modes.any { it.first == v } } ?: "scan") }
    val intake = mode in listOf("capture", "video", "document")
    var front by rememberSaveable { mutableStateOf(false) }; var torch by remember { mutableStateOf(false) }
    var capture by remember { mutableStateOf<ImageCapture?>(null) }
    var photos by rememberSaveable(stateSaver = UploadsSaver) { mutableStateOf(emptyList<Upload>()) }
    val currentPhotos by rememberUpdatedState(photos)
    var transient by remember { mutableStateOf<Upload?>(null) }
    val currentTransient by rememberUpdatedState(transient)
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }
    var job by remember { mutableStateOf<Job?>(null) }
    var code by remember { mutableStateOf("") }
    var scanPaused by remember { mutableStateOf(false) }
    var resource by remember { mutableStateOf<JSONObject?>(null) }
    var unknown by remember { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var analyze by remember { mutableStateOf(false) }
    var research by remember { mutableStateOf(false) }; var overwrite by remember { mutableStateOf(true) }
    var captureType by rememberSaveable { mutableStateOf("object") }; var captureLocation by rememberSaveable { mutableStateOf("") }
    var sku by rememberSaveable { mutableStateOf("") }; var barcode by rememberSaveable { mutableStateOf("") }; var serial by rememberSaveable { mutableStateOf("") }
    var videoPath by rememberSaveable { mutableStateOf("") }
    var submissionId by rememberSaveable { mutableStateOf(uuid()) }
    var cover by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf("") }; var count by remember { mutableStateOf("") }
    var countModels by remember { mutableStateOf(emptyList<JSONObject>()) }; var countModel by remember { mutableStateOf("") }
    var workflows by remember { mutableStateOf(emptyList<JSONObject>()) }; var workflow by remember { mutableStateOf(model.selectedWorkflow) }
    var aiKey by remember { mutableStateOf(uuid()) }; var frozenHint by remember { mutableStateOf("") }; var frozenModel by remember { mutableStateOf("") }
    var book by remember { mutableIntStateOf(0) }; var countResource by remember { mutableStateOf<JSONObject?>(null) }; var picker by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { if ((context as? android.app.Activity)?.isChangingConfigurations != true) currentPhotos.forEach { it.file.delete() }; currentTransient?.file?.delete() } }
    LaunchedEffect(Unit) {
        if (!permission) permissionLauncher.launch(Manifest.permission.CAMERA)
        try {
            if (api.session.allows("workflows.read")) workflows = api.call("stock/scan-workflows").a("workflows").objects().filter { it.optBoolean("enabled") }
            if (api.session.allows("ai.use", "ai")) countModels = api.call("ai/count-models").a("models").objects()
            if (itemId != null) countResource = api.call("resources/$itemId").o("resource")
            if (api.session.allows("ai.analyze", "ai") || api.session.allows("ai.research", "ai")) {
                val defaults = api.call("ai/prompts").o("inventorySettings")
                analyze = defaults.optBoolean("autoAnalyze") && api.session.allows("ai.analyze", "ai")
                research = defaults.optBoolean("autoResearch") && api.session.allows("ai.research", "ai")
                overwrite = defaults.optBoolean("overwrite", true)
            }
        } catch (e: Exception) { error = e.message }
    }
    fun run(block: suspend () -> Unit) {
        if (working) return
        working = true; error = null
        job = scope.launch { try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message } finally { working = false } }
    }
    fun scan(raw: String, format: String? = null) {
        if (scanPaused || working || raw.isBlank()) return
        scanPaused = true; code = raw.trim()
        if (workflow.isNotBlank()) { model.flowCode = code; model.flowCodeType = format; model.flowReview = de.internetderdinge.inventory.FlowReviewState(); navigate("flow/$workflow"); return }
        run {
            require(code.length <= 2048) { "Der Code ist zu lang." }
            try { resource = api.call("resources/lookup", query = mapOf("code" to code)).o("resource") }
            catch (e: ApiError) { if (e.status == 404) unknown = true else throw e }
        }
    }
    LaunchedEffect(model.pendingCode) { model.pendingCode?.let { model.pendingCode = null; scan(it) } }
    suspend fun processPhoto(image: Upload) {
        if (mode == "capture") { if (photos.size < 12) photos = photos + image else image.file.delete(); return }
        transient?.file?.delete(); transient = image; aiKey = uuid(); frozenHint = hint; frozenModel = countModel; result = null
        val response = if (mode == "count") VisualAI.count(api, image, aiKey, frozenHint, countResource?.s("id"), frozenModel)
            else VisualAI.recognize(api, image, aiKey)
        result = response; count = response.s("count")
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(12)) { uris ->
        if (uris.isNotEmpty()) run { for (uri in uris.take(if (mode == "capture") 12 - photos.size else 1)) processPhoto(Imaging.import(context, uri, if (mode == "capture") model.setting("uploadSize", "2200").toInt() else 1600)) }
    }
    val video = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { response ->
        val destination = videoPath.takeIf { it.isNotBlank() }?.let(::File)
        if (response.resultCode == Activity.RESULT_OK && destination != null) run {
            try {
                val uri = if (destination.length() > 0) FileProvider.getUriForFile(context, "${context.packageName}.files", destination) else response.data?.data ?: error("Video wurde nicht gespeichert.")
                val upload = Imaging.import(context, uri, photo = false)
                try {
                    val retriever = android.media.MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(upload.file.path)
                        require((retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: Long.MAX_VALUE) <= 61_000) { "Videos dürfen höchstens 60 Sekunden lang sein." }
                    } finally { retriever.release() }
                    require(upload.file.length() <= 23L * 1024 * 1024) { "Video ist größer als 23 MB. Bitte ein kürzeres Video aufnehmen." }
                    photos = photos + upload
                } catch (e: Exception) { upload.file.delete(); throw e }
            } finally { destination.delete(); videoPath = "" }
        } else { destination?.delete(); videoPath = "" }
    }
    val documents = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { response ->
        if (response.resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(response.data)?.pages?.map { it.imageUri }?.let { pages -> run { photos = photos + DocumentPDF.create(context, pages) } }
    }
    Page {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { modes.forEach { (key, title) -> FilterChip(mode == key, onClick = { if (!working) { mode = key; result = null; transient?.file?.delete(); transient = null; resource = null; scanPaused = false; unknown = false } }, label = { Text(title) }) } }
        if (mode == "scan" && workflows.isNotEmpty()) Choice("Aktionsablauf", workflow, listOf("" to "Eintrag suchen") + workflows.map { it.s("id") to it.s("name") }) { if (!working) { workflow = it; model.selectedWorkflow = it; scanPaused = false; resource = null } }
        val image = transient
        if (image != null && mode in listOf("count", "recognize")) {
            val bitmap = remember(image.file.path) { android.graphics.BitmapFactory.decodeFile(image.file.path) }
            DisposableEffect(bitmap) { onDispose { bitmap?.recycle() } }
            if (bitmap != null) Box(Modifier.fillMaxWidth().aspectRatio(3f / 4)) {
                Image(bitmap.asImageBitmap(), "Aufgenommenes Foto", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                if (mode == "count") Canvas(Modifier.fillMaxSize()) {
                    val scale = minOf(size.width / bitmap.width, size.height / bitmap.height)
                    val width = bitmap.width * scale; val height = bitmap.height * scale
                    result?.a("markers")?.objects()?.forEach { marker -> drawCircle(Color(0xFF7CFF59), radius = 5.dp.toPx(), center = Offset((size.width - width) / 2 + width * marker.optDouble("x").toFloat() / 1000, (size.height - height) / 2 + height * marker.optDouble("y").toFloat() / 1000)) }
                }
            }
        } else if (permission) CameraPreview(Modifier.fillMaxWidth().aspectRatio(3f / 4), mode == "scan" && !working && !scanPaused, front, torch, { capture = it }, ::scan, { error = it })
        else { Notice("Die Kamera ist nicht freigegeben. Du kannst Fotos auswählen oder einen Code eingeben."); OutlinedButton(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) { Text("Kamera freigeben") } }
        if (working) { LinearProgressIndicator(Modifier.fillMaxWidth()); TextButton(onClick = { job?.cancel() }) { Text("Warten abbrechen") } }
        if (permission && transient == null) Row {
            IconButton(onClick = { front = !front; torch = false }) { Icon(Icons.Outlined.FlipCameraAndroid, "Kamera wechseln") }
            IconButton(onClick = { torch = !torch }, enabled = !front) { Icon(if (torch) Icons.Outlined.FlashOn else Icons.Outlined.FlashOff, "Kameralicht") }
        }
        error?.let { Notice(it, true) }
        if (mode == "scan") {
            TextInput("Code manuell eingeben", code, { code = it; scanPaused = false })
            Button(enabled = !working && code.isNotBlank(), onClick = { scanPaused = false; scan(code) }) { Text("Code prüfen") }
            resource?.let { r -> ResourceRow(api, r) { navigate("resource/${r.s("id")}") }
                if (api.session.allows("stock.manage", "write")) { OutlinedButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "resources/${r.s("id")}/stock/movements", "POST", obj("delta" to 1, "type" to "receipt"), true); resource = api.call("resources/${r.s("id")}").o("resource") } }) { Text("+1 Wareneingang") }; TextButton(onClick = { countResource = r; count = "1"; book = -1 }) { Text("−1 Warenausgang") } }
            }
            if (unknown) { Notice("Dieser Code ist noch keinem Eintrag zugeordnet."); if (api.session.allows("inventory.create", "write")) Button(onClick = { mode = "capture"; unknown = false; name = "Neuer Eintrag"; if (code.length <= 80) sku = code; if (code.length <= 180) serial = code }) { Text("Mit diesem Code anlegen") } }
            if (scanPaused) TextButton(onClick = { scanPaused = false; resource = null; unknown = false; code = "" }) { Text("Nächsten Code scannen") }
        } else {
            if (mode == "video") Button(enabled = !working && photos.size < 12, onClick = {
                val directory = File(context.cacheDir, "captures").apply { mkdirs() }; val file = File(directory, "video-${uuid()}.mp4"); videoPath = file.path
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                try { video.launch(Intent(MediaStore.ACTION_VIDEO_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri).putExtra(MediaStore.EXTRA_DURATION_LIMIT, 60).putExtra(MediaStore.EXTRA_SIZE_LIMIT, 23L * 1024 * 1024).putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                catch (e: Exception) { error = "Keine Video-Kamera verfügbar. Videos können unter Medien aus Dateien hinzugefügt werden." }
            }) { Text("Video aufnehmen · bis 60 Sekunden") }
            else if (mode == "document") Button(enabled = !working && photos.size < 12, onClick = {
                val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(12).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
                GmsDocumentScanning.getClient(options).getStartScanIntent(context as Activity).addOnSuccessListener { documents.launch(IntentSenderRequest.Builder(it).build()) }.addOnFailureListener { error = "Der Dokumentscanner ist auf diesem Gerät nicht verfügbar. PDFs lassen sich unter Medien hinzufügen." }
            }) { Text("Dokument scannen · PDF mit Texterkennung") }
            else if (transient == null || mode == "capture") Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledIconButton(enabled = permission && capture != null && !working && (mode != "capture" || photos.size < 12), onClick = { run {
                    val file = File(context.cacheDir, "camera-${uuid()}.jpg")
                    try { capture!!.takePhoto(context, file); processPhoto(Imaging.jpeg(context, file, if (mode == "capture") model.setting("uploadSize", "2200").toInt() else 1600)) } finally { file.delete() }
                } }, modifier = Modifier.size(64.dp)) { Icon(Icons.Outlined.PhotoCamera, "Foto aufnehmen") }
                OutlinedButton(enabled = !working && (mode != "capture" || photos.size < 12), onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) { Text("Fotos auswählen") }
            }
            if (intake) {
                Text("${photos.size} / 12 Medien")
                photos.forEachIndexed { index, photo -> Row(verticalAlignment = Alignment.CenterVertically) {
                    if (photo.mime.startsWith("image/")) coil.compose.AsyncImage(photo.file, "Foto ${index + 1}", Modifier.size(64.dp), contentScale = ContentScale.Crop)
                    else Text(if (photo.mime.startsWith("video/")) "Video" else "PDF + OCR")
                    TextButton(enabled = !working, onClick = { photos = photos - photo; photo.file.delete() }) { Text("Entfernen") }
                } }
                TextInput("Name (optional bei KI-Analyse)", name, { name = it })
                Choice("Typ", captureType, types) { captureType = it }
                TextInput("Standort", captureLocation, { captureLocation = it })
                TextInput("SKU", sku, { sku = it }); TextInput("Barcode", barcode, { barcode = it }); TextInput("Seriennummer", serial, { serial = it })
                if (api.session.allows("ai.analyze", "ai")) Toggle("Nach dem Upload analysieren", analyze) { analyze = it }
                if (api.session.allows("ai.research", "ai")) Toggle("Nach dem Upload recherchieren", research) { research = it }
                if (api.session.allows("ai.images", "ai")) Toggle("KI-Cover erstellen", cover) { cover = it }
                Toggle("GPS-Standort speichern", gps) { if (it) locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) else gps = false }
                Button(enabled = photos.isNotEmpty() && !working && ((analyze && photos.any { it.mime.startsWith("image/") }) || name.isNotBlank()), onClick = { run {
                    val body = obj("name" to name.ifBlank { "Neuer Eintrag" }, "type" to captureType, "status" to "available", "quantity" to 1)
                    if (sku.isNotBlank()) body.put("sku", sku); if (barcode.isNotBlank()) body.put("barcode", barcode); if (serial.isNotBlank()) body.put("serialNumber", serial); if (captureLocation.isNotBlank()) body.put("location", captureLocation)
                    if (gps) { val location = currentLocation(context); body.put("gpsLatitude", location.latitude).put("gpsLongitude", location.longitude); if (location.hasAltitude()) body.put("gpsAltitude", location.altitude) }
                    val hasImages = photos.any { it.mime.startsWith("image/") }
                    model.app.queue.enqueue(api.session, body, photos, analyze && hasImages, if (cover && hasImages) model.coverBody() else null, model.analysisBody().put("overwrite", overwrite), research = research, submissionId = submissionId)
                    submissionId = uuid()
                    photos.forEach { it.file.delete() }; photos = emptyList(); model.message = "Erfassung gespeichert. Upload läuft im Hintergrund."; back()
                } }) { Text("Erfassung speichern") }
            } else {
                if (mode == "count" && transient == null) {
                    TextInput("Was soll gezählt werden?", hint, { hint = it.take(240) })
                    if (countModels.isNotEmpty()) Choice("Zählmodell", countModel, listOf("" to "Serverstandard") + countModels.map { it.s("id") to it.s("label", it.s("id")) }) { countModel = it }
                }
                result?.let { r ->
                    if (mode == "recognize") {
                        Heading(r.o("detected").s("label", "Erkennung"), if (r.optBoolean("isConfident")) "Passende Einträge – bitte selbst auswählen" else "Unsicheres Ergebnis – Vorschläge prüfen")
                        r.a("matches").objects().forEach { match ->
                            ResourceRow(api, match.o("resource")) { navigate("resource/${match.o("resource").s("id")}") }
                            Text("${(match.optDouble("confidence") * 100).toInt()} % · ${match.s("reason")}")
                        }
                        if (r.a("matches").length() == 0) Text("Kein passender Inventareintrag gefunden.")
                    } else {
                        Heading("${r.s("count")} erkannt", "${(r.optDouble("confidence") * 100).toInt()} % Konfidenz · ${if (r.optBoolean("isExact")) "Exakte Zählung" else "Schätzung"}")
                        Text(r.s("explanation")); r.a("warnings").strings().forEach { Notice(it) }
                        TextInput("Geprüfte Anzahl", count, { count = it }, true)
                        if (api.session.allows("stock.manage", "write")) {
                            OutlinedButton(onClick = { picker = true }) { Text(countResource?.s("name") ?: "Inventareintrag auswählen") }
                            Row { Button(enabled = countResource != null && (count.toIntOrNull() ?: 0) > 0, onClick = { book = 1 }) { Text("Zugang buchen") }; TextButton(enabled = countResource != null && (count.toIntOrNull() ?: 0) > 0, onClick = { book = -1 }) { Text("Abgang buchen") } }
                        }
                    }
                }
                if (transient != null && !working) {
                    if (result == null) OutlinedButton(onClick = { run { val r = if (mode == "count") VisualAI.count(api, transient!!, aiKey, frozenHint, countResource?.s("id"), frozenModel) else VisualAI.recognize(api, transient!!, aiKey); result = r; count = r.s("count") } }) { Text("Gleiche Auswertung erneut abrufen") }
                    TextButton(onClick = { transient?.file?.delete(); transient = null; result = null; error = null }) { Text("Neues Foto") }
                }
            }
        }
    }
    if (picker) ResourcePicker(model, api, onDismiss = { picker = false }) { countResource = it; picker = false }
    if (book != 0) Confirm("Bestandsänderung bestätigen?", "${countResource?.s("name")}: ${if (book > 0) "+" else "−"}$count", model.busy, { book = 0 }) { model.run {
        val quantity = count.toInt(); require(quantity > 0)
        model.mutate(api, "resources/${countResource!!.getString("id")}/stock/movements", "POST", obj("delta" to quantity * book, "type" to if (book > 0) "receipt" else "issue"), true)
        book = 0; model.message = "Bestand gebucht."
    } }
}

@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable private fun CameraPreview(modifier: Modifier, scanning: Boolean, front: Boolean, torch: Boolean, onCapture: (ImageCapture) -> Unit, onCode: (String, String?) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current; val owner = LocalLifecycleOwner.current
    val preview = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FIT_CENTER } }
    val active by rememberUpdatedState(scanning); val receive by rememberUpdatedState(onCode)
    var camera by remember { mutableStateOf<Camera?>(null) }
    LaunchedEffect(camera, torch) { camera?.cameraControl?.enableTorch(torch) }
    AndroidView({ preview }, modifier)
    DisposableEffect(owner, front) {
        var disposed = false
        var provider: ProcessCameraProvider? = null
        val executor = Executors.newSingleThreadExecutor()
        val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build())
        val capture = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
        val live = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        analysis.setAnalyzer(executor) { frame ->
            val media = frame.image
            if (!active || media == null || disposed) frame.close()
            else scanner.process(InputImage.fromMediaImage(media, frame.imageInfo.rotationDegrees)).addOnSuccessListener { codes ->
                if (!disposed && active) codes.firstOrNull { !it.rawValue.isNullOrBlank() }?.let { receive(it.rawValue!!, barcodeFormat(it.format)) }
            }.addOnCompleteListener { frame.close() }
        }
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({ if (!disposed) try {
            provider = future.get(); val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
            require(provider!!.hasCamera(selector)) { "Diese Kamera ist nicht verfügbar." }
            camera = provider!!.bindToLifecycle(owner, selector, live, capture, analysis); onCapture(capture)
            val pinch = android.view.ScaleGestureDetector(context, object : android.view.ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: android.view.ScaleGestureDetector): Boolean { camera?.cameraInfo?.zoomState?.value?.let { zoom -> camera?.cameraControl?.setZoomRatio((zoom.zoomRatio * detector.scaleFactor).coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio)) }; return true }
            })
            val tap = android.view.GestureDetector(context, object : android.view.GestureDetector.SimpleOnGestureListener() {
                override fun onSingleTapUp(e: android.view.MotionEvent): Boolean { preview.performClick(); camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(preview.meteringPointFactory.createPoint(e.x, e.y)).build()); return true }
            })
            preview.setOnTouchListener { _, e -> pinch.onTouchEvent(e); tap.onTouchEvent(e); true }
        } catch (e: Exception) { onError(e.message ?: "Kamera konnte nicht gestartet werden.") } }, ContextCompat.getMainExecutor(context))
        onDispose { disposed = true; analysis.clearAnalyzer(); provider?.unbind(live, capture, analysis); scanner.close(); executor.shutdown() }
    }
}
private fun barcodeFormat(format: Int): String? = mapOf(Barcode.FORMAT_QR_CODE to "qr_code", Barcode.FORMAT_EAN_13 to "ean_13", Barcode.FORMAT_EAN_8 to "ean_8", Barcode.FORMAT_UPC_A to "upc_a", Barcode.FORMAT_UPC_E to "upc_e", Barcode.FORMAT_CODE_128 to "code_128", Barcode.FORMAT_DATA_MATRIX to "data_matrix", Barcode.FORMAT_PDF417 to "pdf417", Barcode.FORMAT_AZTEC to "aztec", Barcode.FORMAT_CODE_39 to "code_39", Barcode.FORMAT_CODE_93 to "code_93", Barcode.FORMAT_CODABAR to "codabar", Barcode.FORMAT_ITF to "itf")[format]
private suspend fun ImageCapture.takePhoto(context: android.content.Context, file: File): Unit = suspendCancellableCoroutine { c ->
    takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(result: ImageCapture.OutputFileResults) { if (c.isActive) c.resume(Unit) else file.delete() }
        override fun onError(exception: ImageCaptureException) { if (c.isActive) c.resumeWithException(exception) }
    })
}
@Suppress("MissingPermission", "DEPRECATION")
private suspend fun currentLocation(context: android.content.Context): Location = withTimeout(15_000) {
    suspendCancellableCoroutine { c ->
        val manager = context.getSystemService(LocationManager::class.java)
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { manager.removeUpdates(this); if (c.isActive) c.resume(location) }
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        c.invokeOnCancellation { manager.removeUpdates(listener) }
        val provider = if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) LocationManager.GPS_PROVIDER else LocationManager.NETWORK_PROVIDER
        try { manager.requestSingleUpdate(provider, listener, Looper.getMainLooper()) } catch (e: Exception) { c.resumeWithException(e) }
    }
}
