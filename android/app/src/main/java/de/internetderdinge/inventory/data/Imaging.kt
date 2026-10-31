package de.internetderdinge.inventory.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.OpenableColumns
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

object Imaging {
    suspend fun import(context: Context, uri: Uri, maxSize: Int = 2200, photo: Boolean = true): Upload = withContext(Dispatchers.IO) {
        val mime = context.contentResolver.getType(uri) ?: if (photo) "image/jpeg" else "application/octet-stream"
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "Datei"
        val source = File(context.cacheDir, "import-${uuid()}")
        try {
            context.contentResolver.openInputStream(uri)!!.use { input -> FileOutputStream(source).use { output ->
                val bytes = ByteArray(8192); var total = 0L
                while (true) { val count = input.read(bytes); if (count < 0) break; total += count; require(total <= 50L * 1024 * 1024) { "Datei ist größer als 50 MB." }; output.write(bytes, 0, count) }
            } }
            if (photo || mime.startsWith("image/")) { val result = jpeg(context, source, maxSize); source.delete(); result }
            else Upload(source, name, mime)
        } catch (e: Exception) { source.delete(); throw e }
    }
    suspend fun jpeg(context: Context, source: File, maxSize: Int): Upload = withContext(Dispatchers.IO) {
        require(maxSize in 512..4096)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(source.path, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Das Bildformat kann nicht gelesen werden." }
        var sample = 1; while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSize) sample *= 2
        val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("Bild konnte nicht geladen werden.")
        val exif = ExifInterface(source)
        val matrix = Matrix().apply {
            if (exif.isFlipped) postScale(-1f, 1f)
            postRotate(exif.rotationDegrees.toFloat())
            val scale = (maxSize.toFloat() / max(decoded.width, decoded.height)).coerceAtMost(1f)
            postScale(scale, scale)
        }
        val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        val target = File(context.cacheDir, "photo-${uuid()}.jpg")
        try { FileOutputStream(target).use { check(upright.compress(Bitmap.CompressFormat.JPEG, 88, it)); it.fd.sync() } }
        finally { if (upright !== decoded) upright.recycle(); decoded.recycle() }
        Upload(target)
    }
}
