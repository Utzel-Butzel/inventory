package de.internetderdinge.inventory.data

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfDocument
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.File

object DocumentPDF {
    /** Draw text first, then cover it with the scanned page. The PDF keeps real
     * searchable glyphs without changing the visible scan (zero-alpha text can
     * be discarded by Android's PDF canvas). Work one page at a time. */
    suspend fun create(context: Context, pages: List<Uri>): Upload = withContext(Dispatchers.IO) {
        require(pages.isNotEmpty() && pages.size <= 12)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val target = File(context.cacheDir, "document-${uuid()}.pdf")
        val pdf = PdfDocument()
        try {
                pages.forEachIndexed { index, uri ->
                    val photo = Imaging.import(context, uri, 2200)
                    val bitmap = BitmapFactory.decodeFile(photo.file.path) ?: error("Dokumentseite konnte nicht gelesen werden.")
                    try {
                        val result = recognizer.process(InputImage.fromBitmap(bitmap, 0)).await()
                        val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, index + 1).create())
                        val scale = minOf(559f / bitmap.width, 806f / bitmap.height)
                        val left = (595 - bitmap.width * scale) / 2; val top = (842 - bitmap.height * scale) / 2
                        page.canvas.drawColor(Color.WHITE)
                        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; typeface = Typeface.create("sans-serif", Typeface.NORMAL) }
                        result.textBlocks.flatMap { it.lines }.forEach { line ->
                            line.boundingBox?.let { bounds ->
                                paint.textSize = (bounds.height() * scale).coerceAtLeast(4f); paint.textScaleX = 1f
                                val measured = paint.measureText(line.text)
                                if (measured > 0) paint.textScaleX = (bounds.width() * scale / measured).coerceIn(.1f, 10f)
                                page.canvas.drawText(line.text, left + bounds.left * scale, top + bounds.bottom * scale, paint)
                            }
                        }
                        page.canvas.drawBitmap(bitmap, null, RectF(left, top, left + bitmap.width * scale, top + bitmap.height * scale), Paint(Paint.FILTER_BITMAP_FLAG))
                        pdf.finishPage(page)
                    } finally { bitmap.recycle(); photo.file.delete() }
                }
                target.outputStream().use { pdf.writeTo(it) }
            require(target.length() in 1..(50L * 1024 * 1024)) { "Der Dokumentscan ist zu groß." }
            Upload(target, "Inventar-Dokumentscan.pdf", "application/pdf")
        } catch (e: Exception) { target.delete(); throw e }
        finally { pdf.close(); recognizer.close() }
    }
}
