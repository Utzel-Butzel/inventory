package de.internetderdinge.inventory.ui

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
        require(uris.size in 1..12) { "Maximal 12 Dateien pro Upload." }
        val uploads = mutableListOf<Upload>()
        try {
            uris.forEach { uploads += Imaging.import(context, it, model.setting("uploadSize", "2200").toInt(), false) }
            model.app.queue.enqueue(api.session, obj("name" to "Medienupload"), uploads, false, null, obj(), id)
            model.message = "Dateien zur Upload-Warteschlange hinzugefügt."
        } finally { uploads.forEach { it.file.delete() } }
    } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { if (it.isNotEmpty()) enqueue(it) }
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.let { scanned ->
            scanned.pages?.map { it.imageUri }?.let { pages -> model.run {
                val pdf = DocumentPDF.create(context, pages)
                try { model.app.queue.enqueue(api.session, obj("name" to "Dokumentscan"), listOf(pdf), false, null, obj(), id); model.message = "Durchsuchbares PDF zum Upload hinzugefügt." }
                finally { pdf.file.delete() }
            } }
        }
    }
    Remote(model, api, "resources/$id") { data ->
        val media = data.o("resource").a("media").objects()
        Page {
            Heading("Medien", "${media.size} Dateien")
            if (canEdit) {
                Button(onClick = { picker.launch(arrayOf("image/*", "application/pdf", "video/*", "model/*", "application/zip")) }, enabled = !model.busy) { Text("Dateien hinzufügen") }
                OutlinedButton(onClick = {
                    val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(12).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
                    GmsDocumentScanning.getClient(options).getStartScanIntent(context as Activity).addOnSuccessListener { scanner.launch(IntentSenderRequest.Builder(it).build()) }.addOnFailureListener { model.message = "Dokumentscanner nicht verfügbar. Du kannst Fotos oder PDFs über Dateien hinzufügen wählen." }
                }) { Text("Dokument scannen") }
            }
            media.forEachIndexed { index, m ->
                ElevatedCard { Column(Modifier.padding(Spacing)) {
                    if (m.s("kind") == "image") ResourceImage(api, m.s("url"), Modifier.fillMaxWidth().height(200.dp), m.s("altText"))
                    Text(m.s("name", m.s("filename", "Datei")), style = MaterialTheme.typography.titleMedium)
                    Text(m.s("mimeType"), style = MaterialTheme.typography.bodySmall)
                    TextButton(enabled = !model.busy, onClick = { model.run {
                        val bytes = api.bytes(m.s("url"))
                        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                        val safeName = m.s("name", "Datei").substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
                        val file = File(dir, "${uuid()}-$safeName").apply { writeBytes(bytes) }
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, m.s("mimeType", "application/octet-stream")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        context.startActivity(Intent.createChooser(intent, "Datei öffnen"))
                    } }) { Text("Öffnen / teilen") }
                    if (canEdit) Row {
                        if (index > 0) TextButton(enabled = !model.busy, onClick = { model.run { val order = media.map { it.s("id") }.toMutableList(); java.util.Collections.swap(order, index, index - 1); model.mutate(api, "resources/$id/media", "PATCH", obj("order" to JSONArray(order))) } }) { Text("Nach vorne") }
                        TextButton(onClick = { remove = m }) { Text("Entfernen") }
                    }
                } }
            }
        }
    }
    remove?.let { m -> Confirm("Datei entfernen?", "Diese Datei wird vom Eintrag gelöscht.", model.busy, { remove = null }) { model.run { model.mutate(api, "resources/$id/media/${m.s("id")}", "DELETE"); remove = null } } }
}
