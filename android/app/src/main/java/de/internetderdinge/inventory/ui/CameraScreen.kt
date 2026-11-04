@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

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
    val modes = listOfNotNull(if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) "capture" to L10n.text(R.string.ui_capture_ef5c867a) else null,
        if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) "video" to L10n.text(R.string.ui_video_d534be82) else null,
        if (api.session.allows("inventory.create", "write") && api.session.allows("inventory.update", "write")) "document" to L10n.text(R.string.ui_document_836ae935) else null,
        "scan" to L10n.text(R.string.ui_scan_2a53b078), if (api.session.allows("ai.use", "ai")) "recognize" to L10n.text(R.string.ui_recognize_6f20ddeb) else null, if (api.session.allows("ai.use", "ai")) "count" to L10n.text(R.string.ui_count_eb491fc2) else null)
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
            require(code.length <= 2048) { L10n.text(R.string.ui_the_code_is_too_long_09ffe78e) }
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
                val uri = if (destination.length() > 0) FileProvider.getUriForFile(context, "${context.packageName}.files", destination) else response.data?.data ?: error(L10n.text(R.string.ui_video_was_not_saved_be7ce24a))
                val upload = Imaging.import(context, uri, photo = false)
                try {
                    val retriever = android.media.MediaMetadataRetriever()
                    try {
                        retriever.setDataSource(upload.file.path)
                        require((retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: Long.MAX_VALUE) <= 61_000) { L10n.text(R.string.ui_videos_must_not_exceed_60_seconds_11d0abd7) }
                    } finally { retriever.release() }
                    require(upload.file.length() <= 23L * 1024 * 1024) { L10n.text(R.string.ui_video_exceeds_23_mb_please_record_a_8056249e) }
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
        if (mode == "scan" && workflows.isNotEmpty()) Choice(L10n.text(R.string.ui_workflow_0560f3a1), workflow, listOf("" to L10n.text(R.string.ui_find_item_1e9789c3)) + workflows.map { it.s("id") to it.s("name") }) { if (!working) { workflow = it; model.selectedWorkflow = it; scanPaused = false; resource = null } }
        val image = transient
        if (image != null && mode in listOf("count", "recognize")) {
            val bitmap = remember(image.file.path) { android.graphics.BitmapFactory.decodeFile(image.file.path) }
            DisposableEffect(bitmap) { onDispose { bitmap?.recycle() } }
            if (bitmap != null) Box(Modifier.fillMaxWidth().aspectRatio(3f / 4)) {
                Image(bitmap.asImageBitmap(), L10n.text(R.string.ui_captured_photo_4afe64a4), Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                if (mode == "count") Canvas(Modifier.fillMaxSize()) {
                    val scale = minOf(size.width / bitmap.width, size.height / bitmap.height)
                    val width = bitmap.width * scale; val height = bitmap.height * scale
                    result?.a("markers")?.objects()?.forEach { marker -> drawCircle(Color(0xFF7CFF59), radius = 5.dp.toPx(), center = Offset((size.width - width) / 2 + width * marker.optDouble("x").toFloat() / 1000, (size.height - height) / 2 + height * marker.optDouble("y").toFloat() / 1000)) }
                }
            }
        } else if (permission) CameraPreview(Modifier.fillMaxWidth().aspectRatio(3f / 4), mode == "scan" && !working && !scanPaused, front, torch, { capture = it }, ::scan, { error = it })
        else { Notice(L10n.text(R.string.ui_camera_access_is_not_granted_you_can_8db3dad0)); OutlinedButton(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) { Text(L10n.text(R.string.ui_allow_camera_access_463fd5b8)) } }
        if (working) { LinearProgressIndicator(Modifier.fillMaxWidth()); TextButton(onClick = { job?.cancel() }) { Text(L10n.text(R.string.ui_stop_waiting_e19d6220)) } }
        if (permission && transient == null) Row {
            IconButton(onClick = { front = !front; torch = false }) { Icon(Icons.Outlined.FlipCameraAndroid, L10n.text(R.string.ui_switch_camera_698db125)) }
            IconButton(onClick = { torch = !torch }, enabled = !front) { Icon(if (torch) Icons.Outlined.FlashOn else Icons.Outlined.FlashOff, L10n.text(R.string.ui_camera_light_4efed323)) }
        }
        error?.let { Notice(it, true) }
        if (mode == "scan") {
            TextInput(L10n.text(R.string.ui_enter_code_manually_0162322b), code, { code = it; scanPaused = false })
            Button(enabled = !working && code.isNotBlank(), onClick = { scanPaused = false; scan(code) }) { Text(L10n.text(R.string.ui_check_code_96b96ac4)) }
            resource?.let { r -> ResourceRow(api, r) { navigate("resource/${r.s("id")}") }
                if (api.session.allows("stock.manage", "write")) { OutlinedButton(enabled = !model.busy, onClick = { model.run { model.mutate(api, "resources/${r.s("id")}/stock/movements", "POST", obj("delta" to 1, "type" to "receipt"), true); resource = api.call("resources/${r.s("id")}").o("resource") } }) { Text(L10n.text(R.string.ui_1_goods_receipt_1201a43e)) }; TextButton(onClick = { countResource = r; count = "1"; book = -1 }) { Text(L10n.text(R.string.ui_1_goods_issue_190d6da1)) } }
            }
            if (unknown) { Notice(L10n.text(R.string.ui_this_code_is_not_assigned_to_an_a19888c1)); if (api.session.allows("inventory.create", "write")) Button(onClick = { mode = "capture"; unknown = false; name = L10n.text(R.string.ui_new_item_c325efcf); if (code.length <= 80) sku = code; if (code.length <= 180) serial = code }) { Text(L10n.text(R.string.ui_create_with_this_code_cfa0de14)) } }
            if (scanPaused) TextButton(onClick = { scanPaused = false; resource = null; unknown = false; code = "" }) { Text(L10n.text(R.string.ui_scan_another_code_583eca16)) }
        } else {
            if (mode == "video") Button(enabled = !working && photos.size < 12, onClick = {
                val directory = File(context.cacheDir, "captures").apply { mkdirs() }; val file = File(directory, "video-${uuid()}.mp4"); videoPath = file.path
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                try { video.launch(Intent(MediaStore.ACTION_VIDEO_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri).putExtra(MediaStore.EXTRA_DURATION_LIMIT, 60).putExtra(MediaStore.EXTRA_SIZE_LIMIT, 23L * 1024 * 1024).putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                catch (e: Exception) { error = L10n.text(R.string.ui_no_video_camera_available_videos_can_be_31556985) }
            }) { Text(L10n.text(R.string.ui_record_video_up_to_60_seconds_1d9e05c7)) }
            else if (mode == "document") Button(enabled = !working && photos.size < 12, onClick = {
                val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(12).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
                GmsDocumentScanning.getClient(options).getStartScanIntent(context as Activity).addOnSuccessListener { documents.launch(IntentSenderRequest.Builder(it).build()) }.addOnFailureListener { error = L10n.text(R.string.ui_the_document_scanner_is_not_available_on_5e4c4d8c) }
            }) { Text(L10n.text(R.string.ui_scan_document_pdf_with_text_recognition_27fd03a3)) }
            else if (transient == null || mode == "capture") Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledIconButton(enabled = permission && capture != null && !working && (mode != "capture" || photos.size < 12), onClick = { run {
                    val file = File(context.cacheDir, "camera-${uuid()}.jpg")
                    try { capture!!.takePhoto(context, file); processPhoto(Imaging.jpeg(context, file, if (mode == "capture") model.setting("uploadSize", "2200").toInt() else 1600)) } finally { file.delete() }
                } }, modifier = Modifier.size(64.dp)) { Icon(Icons.Outlined.PhotoCamera, L10n.text(R.string.ui_take_photo_dd824d64)) }
                OutlinedButton(enabled = !working && (mode != "capture" || photos.size < 12), onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) { Text(L10n.text(R.string.ui_select_photos_507da54a)) }
            }
            if (intake) {
                Text(L10n.text(R.string.ui_0_12_media_files_294c6b40, photos.size))
                photos.forEachIndexed { index, photo -> Row(verticalAlignment = Alignment.CenterVertically) {
                    if (photo.mime.startsWith("image/")) coil.compose.AsyncImage(photo.file, L10n.text(R.string.ui_photo_0_9f1847b1, index + 1), Modifier.size(64.dp), contentScale = ContentScale.Crop)
                    else Text(if (photo.mime.startsWith("video/")) L10n.text(R.string.ui_video_d534be82) else "PDF + OCR")
                    TextButton(enabled = !working, onClick = { photos = photos - photo; photo.file.delete() }) { Text(L10n.text(R.string.ui_remove_3828375a)) }
                } }
                TextInput(L10n.text(R.string.ui_name_optional_with_ai_analysis_0de80eda), name, { name = it })
                Choice(L10n.text(R.string.ui_type_1b024183), captureType, types) { captureType = it }
                TextInput(L10n.text(R.string.ui_location_ecf34cc8), captureLocation, { captureLocation = it })
                TextInput("SKU", sku, { sku = it }); TextInput(L10n.text(R.string.ui_barcode_a401f372), barcode, { barcode = it }); TextInput(L10n.text(R.string.ui_serial_number_760abc3d), serial, { serial = it })
                if (api.session.allows("ai.analyze", "ai")) Toggle(L10n.text(R.string.ui_analyze_after_upload_448a880a), analyze) { analyze = it }
                if (api.session.allows("ai.research", "ai")) Toggle(L10n.text(R.string.ui_research_after_upload_8f2b77b2), research) { research = it }
                if (api.session.allows("ai.images", "ai")) Toggle(L10n.text(R.string.ui_create_ai_cover_91b69886), cover) { cover = it }
                Toggle(L10n.text(R.string.ui_save_gps_location_a584c5fd), gps) { if (it) locationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) else gps = false }
                Button(enabled = photos.isNotEmpty() && !working && ((analyze && photos.any { it.mime.startsWith("image/") }) || name.isNotBlank()), onClick = { run {
                    val body = obj("name" to name.ifBlank { L10n.text(R.string.ui_new_item_c325efcf) }, "type" to captureType, "status" to "available", "quantity" to 1)
                    if (sku.isNotBlank()) body.put("sku", sku); if (barcode.isNotBlank()) body.put("barcode", barcode); if (serial.isNotBlank()) body.put("serialNumber", serial); if (captureLocation.isNotBlank()) body.put("location", captureLocation)
                    if (gps) { val location = currentLocation(context); body.put("gpsLatitude", location.latitude).put("gpsLongitude", location.longitude); if (location.hasAltitude()) body.put("gpsAltitude", location.altitude) }
                    val hasImages = photos.any { it.mime.startsWith("image/") }
                    model.app.queue.enqueue(api.session, body, photos, analyze && hasImages, if (cover && hasImages) model.coverBody() else null, model.analysisBody().put("overwrite", overwrite), research = research, submissionId = submissionId)
                    submissionId = uuid()
                    photos.forEach { it.file.delete() }; photos = emptyList(); model.message = L10n.text(R.string.ui_capture_saved_upload_is_running_in_the_26c76c17); back()
                } }) { Text(L10n.text(R.string.ui_save_capture_aa21bd42)) }
            } else {
                if (mode == "count" && transient == null) {
                    TextInput(L10n.text(R.string.ui_what_should_be_counted_66191450), hint, { hint = it.take(240) })
                    if (countModels.isNotEmpty()) Choice(L10n.text(R.string.ui_counting_model_53a0a0cb), countModel, listOf("" to L10n.text(R.string.ui_server_default_67fd1f92)) + countModels.map { it.s("id") to it.s("label", it.s("id")) }) { countModel = it }
                }
                result?.let { r ->
                    if (mode == "recognize") {
                        Heading(r.o("detected").s("label", L10n.text(R.string.ui_recognition_41ded7e1)), if (r.optBoolean("isConfident")) L10n.text(R.string.ui_matching_items_please_select_one_f656a5b1) else L10n.text(R.string.ui_uncertain_result_review_suggestions_67bda1a5))
                        r.a("matches").objects().forEach { match ->
                            ResourceRow(api, match.o("resource")) { navigate("resource/${match.o("resource").s("id")}") }
                            Text("${(match.optDouble("confidence") * 100).toInt()} % · ${match.s("reason")}")
                        }
                        if (r.a("matches").length() == 0) Text(L10n.text(R.string.ui_no_matching_inventory_item_found_30bdc51c))
                    } else {
                        Heading(L10n.text(R.string.ui_0_detected_039f38d9, r.s("count")), L10n.text(R.string.ui_0_confidence_1_4511fd6d, (r.optDouble("confidence") * 100).toInt(), if (r.optBoolean("isExact")) "Exakte Zählung" else "Schätzung"))
                        Text(r.s("explanation")); r.a("warnings").strings().forEach { Notice(it) }
                        TextInput(L10n.text(R.string.ui_verified_count_8f357c11), count, { count = it }, true)
                        if (api.session.allows("stock.manage", "write")) {
                            OutlinedButton(onClick = { picker = true }) { Text(countResource?.s("name") ?: L10n.text(R.string.ui_select_inventory_item_d6c230d4)) }
                            Row { Button(enabled = countResource != null && (count.toIntOrNull() ?: 0) > 0, onClick = { book = 1 }) { Text(L10n.text(R.string.ui_book_receipt_27e830e4)) }; TextButton(enabled = countResource != null && (count.toIntOrNull() ?: 0) > 0, onClick = { book = -1 }) { Text(L10n.text(R.string.ui_book_removal_5a2c91e4)) } }
                        }
                    }
                }
                if (transient != null && !working) {
                    if (result == null) OutlinedButton(onClick = { run { val r = if (mode == "count") VisualAI.count(api, transient!!, aiKey, frozenHint, countResource?.s("id"), frozenModel) else VisualAI.recognize(api, transient!!, aiKey); result = r; count = r.s("count") } }) { Text(L10n.text(R.string.ui_retrieve_the_same_analysis_again_c6dac12b)) }
                    TextButton(onClick = { transient?.file?.delete(); transient = null; result = null; error = null }) { Text(L10n.text(R.string.ui_new_photo_f2620ec5)) }
                }
            }
        }
    }
    if (picker) ResourcePicker(model, api, onDismiss = { picker = false }) { countResource = it; picker = false }
    if (book != 0) Confirm(L10n.text(R.string.ui_confirm_stock_change_6532b8ff), "${countResource?.s("name")}: ${if (book > 0) "+" else "−"}$count", model.busy, { book = 0 }) { model.run {
        val quantity = count.toInt(); require(quantity > 0)
        model.mutate(api, "resources/${countResource!!.getString("id")}/stock/movements", "POST", obj("delta" to quantity * book, "type" to if (book > 0) "receipt" else "issue"), true)
        book = 0; model.message = L10n.text(R.string.ui_stock_booked_bca3296f)
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
            require(provider!!.hasCamera(selector)) { L10n.text(R.string.ui_this_camera_is_unavailable_e801b9dd) }
            camera = provider!!.bindToLifecycle(owner, selector, live, capture, analysis); onCapture(capture)
            val pinch = android.view.ScaleGestureDetector(context, object : android.view.ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: android.view.ScaleGestureDetector): Boolean { camera?.cameraInfo?.zoomState?.value?.let { zoom -> camera?.cameraControl?.setZoomRatio((zoom.zoomRatio * detector.scaleFactor).coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio)) }; return true }
            })
            val tap = android.view.GestureDetector(context, object : android.view.GestureDetector.SimpleOnGestureListener() {
                override fun onSingleTapUp(e: android.view.MotionEvent): Boolean { preview.performClick(); camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(preview.meteringPointFactory.createPoint(e.x, e.y)).build()); return true }
            })
            preview.setOnTouchListener { _, e -> pinch.onTouchEvent(e); tap.onTouchEvent(e); true }
        } catch (e: Exception) { onError(e.message ?: L10n.text(R.string.ui_could_not_start_camera_09b65c3f)) } }, ContextCompat.getMainExecutor(context))
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
