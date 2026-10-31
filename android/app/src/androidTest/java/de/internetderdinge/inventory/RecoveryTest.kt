package de.internetderdinge.inventory

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.workDataOf
import androidx.work.testing.TestListenableWorkerBuilder
import de.internetderdinge.inventory.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class RecoveryTest {
    @Test fun uncertainOperationsKeepTheirRequestAcrossDatabaseReopen() {
        val app = ApplicationProvider.getApplicationContext<InventoryApplication>()
        val context = uuid()
        val store = LocalStore(app)
        val body = obj("delta" to -2, "type" to "issue")
        val first = store.operation(context, "resources/test/stock/movements", "POST", body)
        store.close()
        val reopened = LocalStore(app)
        val retry = reopened.operation(context, "resources/test/stock/movements", "POST", obj("type" to "issue", "delta" to -2))
        assertEquals(first.s("key"), retry.s("key"))
        assertTrue(runCatching { reopened.operation(context, "resources/test/stock/movements", "POST", obj("delta" to -3)) }.isFailure)
        assertTrue(reopened.operations("another-org").isEmpty())
        reopened.complete(retry); reopened.close()
    }
    @Test fun uploadResumesAfterMediaFailureWithoutCreatingAnotherItem() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<InventoryApplication>()
        val store = LocalStore(app)
        MockWebServer().use { server ->
            val session = Session(server.url("/").toString(), "test-token", "recovery-org", "recovery-user", obj())
            app.credentials.write(session)
            val id = uuid(); val dir = File(store.files, id).apply { mkdirs() }; val photo = File(dir, "0.bin").apply { writeBytes(byteArrayOf(1, 2, 3)) }
            val job = obj("id" to id, "context" to session.context, "resource" to obj("name" to "Test"), "stage" to 0, "status" to "waiting", "analyze" to false,
                "files" to JSONArray(listOf(obj("file" to "0.bin", "name" to "photo.jpg", "mime" to "image/jpeg", "sha256" to UploadQueue.digest(photo)))), "keys" to obj("create" to uuid(), "media" to uuid()))
            store.saveJob(job)
            server.enqueue(MockResponse().setBody("{\"resource\":{\"id\":\"created-id\"}}"))
            server.enqueue(MockResponse().setResponseCode(503).setBody("{\"error\":\"Try again\"}"))
            val worker = TestListenableWorkerBuilder<UploadWorker>(app, inputData = workDataOf("id" to id)).build()
            assertEquals(ListenableWorker.Result.retry(), worker.doWork())
            assertEquals(1, store.job(id)!!.optInt("stage"))
            assertTrue(photo.exists())
            val create = server.takeRequest(); val media = server.takeRequest()
            assertEquals("/api/v1/resources", create.path)
            server.enqueue(MockResponse().setBody("{\"uploaded\":[]}"))
            val retry = TestListenableWorkerBuilder<UploadWorker>(app, inputData = workDataOf("id" to id)).build()
            assertEquals(ListenableWorker.Result.success(), retry.doWork())
            val replay = server.takeRequest()
            assertEquals("/api/v1/resources/created-id/media", replay.path)
            assertEquals(media.getHeader("Idempotency-Key"), replay.getHeader("Idempotency-Key"))
            assertEquals("recovery-org", replay.getHeader("X-Organization-ID"))
            assertEquals("done", store.job(id)!!.s("status")); assertFalse(photo.exists())
            store.removeJob(id); app.credentials.clear()
        }
        store.close()
    }
    @Test fun foreignWorkspaceUploadsPauseBeforeAnyRequest() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<InventoryApplication>()
        val store = LocalStore(app)
        val id = uuid()
        app.credentials.write(Session("https://example.org", "token", "org-b", "user", obj()))
        store.saveJob(obj("id" to id, "context" to "foreign-context", "status" to "waiting", "stage" to 0))
        val worker = TestListenableWorkerBuilder<UploadWorker>(app, inputData = workDataOf("id" to id)).build()
        assertEquals(ListenableWorker.Result.success(), worker.doWork())
        assertEquals("paused", store.job(id)!!.s("status"))
        store.removeJob(id); store.close(); app.credentials.clear()
    }
    @Test fun credentialsAreEncryptedAndCanBeRecovered() {
        val app = ApplicationProvider.getApplicationContext<InventoryApplication>()
        val token = "sensitive-test-${uuid()}"
        val s = Session("https://example.org", token, "org", "user", obj())
        app.credentials.write(s)
        assertFalse(File(app.noBackupFilesDir, "session.aes").readText().contains(token))
        assertEquals(token, Credentials(app).read()!!.token)
        app.credentials.clear(); assertNull(Credentials(app).read())
    }
}
