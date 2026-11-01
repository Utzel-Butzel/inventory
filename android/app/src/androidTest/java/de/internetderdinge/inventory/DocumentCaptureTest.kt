package de.internetderdinge.inventory

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import de.internetderdinge.inventory.data.DocumentPDF
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DocumentCaptureTest {
    @Test fun scannedPagesProduceAReadableMultiPagePdf(): Unit = runBlocking {
        val app = ApplicationProvider.getApplicationContext<InventoryApplication>()
        val bitmap = Bitmap.createBitmap(1000, 1400, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply {
            drawColor(Color.WHITE)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.BLACK; textSize = 52f; typeface = Typeface.DEFAULT_BOLD
            }
            drawText("INVENTORY DOCUMENT", 80f, 180f, paint)
            drawText("Serial number 2026", 80f, 280f, paint)
        }
        val input = File(app.cacheDir, "synthetic-document.png")
        input.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        try {
            val upload = DocumentPDF.create(app, listOf(Uri.fromFile(input), Uri.fromFile(input)))
            assertEquals("application/pdf", upload.mime)
            assertTrue(upload.file.length() > 5000)
            val descriptor = ParcelFileDescriptor.open(upload.file, ParcelFileDescriptor.MODE_READ_ONLY)
            val renderer = PdfRenderer(descriptor)
            try { assertEquals(2, renderer.pageCount) } finally { renderer.close(); descriptor.close() }
            // Retain only this synthetic document for host-side text extraction QA.
            val copy = File(app.getExternalFilesDir(null), "document-qa.pdf")
            upload.file.copyTo(copy, overwrite = true)
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /sdcard/Download/inventory-qa")).use { it.readBytes() }
            ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("cp ${copy.absolutePath} /sdcard/Download/inventory-qa/document.pdf")).use { it.readBytes() }
            upload.file.delete(); copy.delete()
        } finally { input.delete() }
        Unit
    }
}
