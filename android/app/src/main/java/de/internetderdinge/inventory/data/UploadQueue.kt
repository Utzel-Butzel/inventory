package de.internetderdinge.inventory.data

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class UploadQueue(private val context: Context, private val store: LocalStore) {
    suspend fun enqueue(session: Session, resource: JSONObject, uploads: List<Upload>, analyze: Boolean, cover: JSONObject?, analysis: JSONObject, resourceId: String? = null, research: Boolean = false, submissionId: String = uuid()): String = withContext(Dispatchers.IO) {
        require(uploads.size in 1..12)
        val id = java.util.UUID.fromString(submissionId).toString()
        store.job(id)?.let { existing ->
            require(existing.s("context") == session.context)
            schedule(id)
            return@withContext id
        }
        // An interrupted import can leave an unregistered directory. There is
        // no visible job until all files and the SQLite manifest are committed.
        File(store.files, id).takeIf(File::exists)?.deleteRecursively()
        val temporary = File(store.files, "$id.importing").apply { mkdirs() }
        try {
            val manifest = JSONArray()
            uploads.forEachIndexed { index, upload ->
                val target = File(temporary, "$index.bin")
                upload.file.inputStream().use { input -> FileOutputStream(target).use { output -> input.copyTo(output); output.fd.sync() } }
                require(target.length() > 0)
                manifest.put(obj("file" to target.name, "name" to upload.name, "mime" to upload.mime, "sha256" to digest(target)))
            }
            check(temporary.renameTo(File(store.files, id)))
            val job = obj("id" to id, "context" to session.context, "server" to session.server, "organization" to session.organization,
                "resource" to resource.copy(), "resourceId" to resourceId, "files" to manifest, "analyze" to analyze,
                "analysis" to analysis.copy(), "cover" to cover?.copy(), "stage" to if (resourceId == null) 0 else 1,
                "research" to research, "researchCompleted" to false,
                "keys" to obj("create" to uuid(), "media" to uuid(), "analyze" to uuid(), "research" to uuid(), "cover" to uuid()), "status" to "waiting")
            store.saveJob(job)
            schedule(id)
            id
        } catch (e: Exception) { temporary.deleteRecursively(); if (store.job(id) == null) File(store.files, id).deleteRecursively(); throw e }
    }
    fun schedule(id: String) {
        val work = OneTimeWorkRequestBuilder<UploadWorker>().setInputData(workDataOf("id" to id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("inventory-uploads", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
    }
    fun resume(session: Session) { store.jobs(session.context).filter { it.s("status") in listOf("waiting", "running", "paused") }.reversed().forEach { schedule(it.getString("id")) } }
    companion object {
        fun digest(file: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input -> val buffer = ByteArray(8192); while (true) { val n = input.read(buffer); if (n < 0) break; md.update(buffer, 0, n) } }
            return md.digest().joinToString("") { "%02x".format(it) }
        }
    }
}

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val store = LocalStore(applicationContext)
        try {
            val job = store.job(inputData.getString("id") ?: return@withContext Result.failure()) ?: return@withContext Result.success()
            if (job.s("status") == "done") return@withContext Result.success()
            fun save(status: String, message: String = "") { job.put("status", status).put("error", message); store.saveJob(job) }
            try {
                val session = Credentials(applicationContext).read()
                if (session == null || session.context != job.s("context")) { save("paused", "Zum ursprünglichen Konto und Arbeitsbereich wechseln."); return@withContext Result.success() }
                val api = Api(session)
                val files = job.a("files").objects().map { item ->
                    val file = File(File(store.files, job.getString("id")), item.getString("file"))
                    check(file.isFile && UploadQueue.digest(file) == item.getString("sha256")) { "Die gespeicherten Bilder sind unvollständig oder beschädigt." }
                    Upload(file, item.getString("name"), item.getString("mime"))
                }
                save("running")
                fun next(stage: Int) { job.put("stage", stage); store.saveJob(job) }
                // Re-check account before every stage. A request already sent always
                // retains its immutable original organization header.
                fun verify() { check(Credentials(applicationContext).read()?.context == session.context) { "Arbeitsbereich gewechselt. Upload pausiert." } }
                if (job.optInt("stage") == 0) {
                    verify(); val created = api.call("resources", "POST", job.o("resource"), job.o("keys").getString("create"))
                    job.put("resourceId", created.o("resource").getString("id")); next(1)
                }
                val id = job.getString("resourceId")
                if (job.optInt("stage") == 1) {
                    verify(); val reply = api.multipart("resources/$id/media", files, job.o("keys").getString("media"))
                    if (reply.status == 202) throw ApiError(202, "Upload wird verarbeitet.", reply.retryAfter)
                    next(2)
                }
                if (job.optInt("stage") == 2) {
                    verify(); if (job.optBoolean("analyze")) api.call("resources/$id/analyze", "POST", job.o("analysis"), job.o("keys").getString("analyze"))
                    next(3)
                }
                if (job.optInt("stage") == 3) {
                    if (job.optBoolean("research") && !job.optBoolean("researchCompleted")) {
                        verify(); api.call("resources/$id/research", "POST", obj(), job.o("keys").getString("research"))
                        job.put("researchCompleted", true); store.saveJob(job)
                    }
                    verify(); if (!job.isNull("cover")) api.call("resources/$id/cover", "POST", job.o("cover"), job.o("keys").getString("cover"))
                    next(4)
                }
                save("done"); File(store.files, job.getString("id")).deleteRecursively(); Result.success()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                val retry = (e is IOException && (e !is ApiError || e.retryable)) && runAttemptCount < 8
                val paused = e is ApiError && e.status == 401
                save(if (retry) "waiting" else if (paused) "paused" else "error", e.message ?: "Upload fehlgeschlagen")
                if (retry) Result.retry() else Result.success()
            }
        } finally { store.close() }
    }
}
