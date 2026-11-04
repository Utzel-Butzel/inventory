package de.internetderdinge.inventory.ui

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.google.mlkit.vision.documentscanner.*
import de.internetderdinge.inventory.AppModel
import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

@Composable fun MediaScreen(model: AppModel, api: Api, id: String) {
    val context = LocalContext.current
    val canEdit = api.session.allows("inventory.update", "write")
    var remove by remember { mutableStateOf<JSONObject?>(null) }
    fun enqueue(uris: List<android.net.Uri>) { model.run {
        require(uris.size in 1..12) { L10n.text(R.string.ui_maximum_12_files_per_upload_2cddb816) }
        val uploads = mutableListOf<Upload>()
        try {
            uris.forEach { uploads += Imaging.import(context, it, model.setting("uploadSize", "2200").toInt(), false) }
            model.app.queue.enqueue(api.session, obj("name" to L10n.text(R.string.ui_media_upload_ca85cac7)), uploads, false, null, obj(), id)
            model.message = L10n.text(R.string.ui_files_added_to_the_upload_queue_f7c90f8e)
        } finally { uploads.forEach { it.file.delete() } }
    } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { if (it.isNotEmpty()) enqueue(it) }
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.let { scanned ->
            scanned.pages?.map { it.imageUri }?.let { pages -> model.run {
                val pdf = DocumentPDF.create(context, pages)
                try { model.app.queue.enqueue(api.session, obj("name" to L10n.text(R.string.ui_document_scan_b35e65cd)), listOf(pdf), false, null, obj(), id); model.message = L10n.text(R.string.ui_searchable_pdf_added_to_upload_1fad66f9) }
                finally { pdf.file.delete() }
            } }
        }
    }
    Remote(model, api, "resources/$id") { data ->
        val media = data.o("resource").a("media").objects()
        Page {
            Heading(L10n.text(R.string.ui_media_0031e362), L10n.text(R.string.ui_files_0_98dcd6a9, media.size))
            if (canEdit) {
                Button(onClick = { picker.launch(arrayOf("image/*", "application/pdf", "video/*", "model/*", "application/zip")) }, enabled = !model.busy) { Text(L10n.text(R.string.ui_add_files_0eb8ddab)) }
                OutlinedButton(onClick = {
                    val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(12).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
                    GmsDocumentScanning.getClient(options).getStartScanIntent(context as Activity).addOnSuccessListener { scanner.launch(IntentSenderRequest.Builder(it).build()) }.addOnFailureListener { model.message = L10n.text(R.string.ui_document_scanner_unavailable_you_can_select_add_2dcff9e5) }
                }) { Text(L10n.text(R.string.ui_scan_document_6d091d0c)) }
            }
            media.forEachIndexed { index, m ->
                ElevatedCard { Column(Modifier.padding(Spacing)) {
                    if (m.s("kind") == "image") ResourceImage(api, m.s("url"), Modifier.fillMaxWidth().height(200.dp), m.s("altText"))
                    Text(m.s("name", m.s("filename", L10n.text(R.string.ui_file_e9028a56))), style = MaterialTheme.typography.titleMedium)
                    Text(m.s("mimeType"), style = MaterialTheme.typography.bodySmall)
                    TextButton(enabled = !model.busy, onClick = { model.run {
                        val bytes = api.bytes(m.s("url"))
                        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                        val safeName = m.s("name", L10n.text(R.string.ui_file_e9028a56)).substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
                        val file = File(dir, "${uuid()}-$safeName").apply { writeBytes(bytes) }
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, m.s("mimeType", "application/octet-stream")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        context.startActivity(Intent.createChooser(intent, L10n.text(R.string.ui_open_file_c2d56aff)))
                    } }) { Text(L10n.text(R.string.ui_open_share_20c050aa)) }
                    if (canEdit) Row {
                        if (index > 0) TextButton(enabled = !model.busy, onClick = { model.run { val order = media.map { it.s("id") }.toMutableList(); java.util.Collections.swap(order, index, index - 1); model.mutate(api, "resources/$id/media", "PATCH", obj("order" to JSONArray(order))) } }) { Text(L10n.text(R.string.ui_bring_to_front_fb7ae7e3)) }
                        TextButton(onClick = { remove = m }) { Text(L10n.text(R.string.ui_remove_3828375a)) }
                    }
                } }
            }
        }
    }
    remove?.let { m -> Confirm(L10n.text(R.string.ui_remove_file_db7b2578), L10n.text(R.string.ui_this_file_will_be_deleted_from_the_c8e06b50), model.busy, { remove = null }) { model.run { model.mutate(api, "resources/$id/media/${m.s("id")}", "DELETE"); remove = null } } }
}
