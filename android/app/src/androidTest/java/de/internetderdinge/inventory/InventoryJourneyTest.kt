package de.internetderdinge.inventory

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import de.internetderdinge.inventory.data.*
import okhttp3.mockwebserver.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import androidx.compose.ui.graphics.asAndroidBitmap
import java.io.File
import androidx.test.platform.app.InstrumentationRegistry
import android.os.ParcelFileDescriptor

@RunWith(AndroidJUnit4::class)
class InventoryJourneyTest {
    @get:Rule val ui = createEmptyComposeRule()
    private lateinit var server: MockWebServer
    private lateinit var scenario: ActivityScenario<MainActivity>
    private val writes = CopyOnWriteArrayList<RecordedRequest>()
    private val resource = obj("id" to "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "name" to "Akku-Bohrschrauber", "type" to "tool", "status" to "available", "quantity" to 12, "sku" to "WERK-0042", "location" to "Werkstatt · Regal A", "description" to "Kompakter Bohrschrauber für Montagearbeiten.")
    private lateinit var session: Session
    @Before fun setup() {
        val app = ApplicationProvider.getApplicationContext<InventoryApplication>()
        app.credentials.clear()
        server = MockWebServer()
        val caps = obj("name" to "Android Test", "principal" to "test-user", "scopes" to JSONArray(listOf("read", "write")), "organization" to obj("id" to "test-org", "name" to "Werkstatt", "slug" to "werkstatt"))
        session = Session(server.url("/").toString(), "test-token", "test-org", "test-user", caps)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.method !in listOf("GET", "HEAD")) writes += request
                val path = request.requestUrl!!.encodedPath
                val value = when {
                    path.endsWith("/auth/capabilities") -> caps
                    path.endsWith("/resources") -> obj("resources" to JSONArray(listOf(resource)), "pagination" to obj("page" to 1, "pageSize" to 24, "total" to 1, "pages" to 1))
                    path.endsWith("/stock/movements") -> obj("resource" to resource.copy().put("quantity", 13))
                    path.endsWith("/stock") -> obj("resource" to resource, "config" to obj("trackingMode" to "bulk", "unitName" to "Stück", "minimumStock" to 2, "reorderQuantity" to 5), "forecast" to obj("averageDailyUsage" to 0), "procurement" to obj())
                    path.endsWith("/${resource.s("id")}") -> obj("resource" to resource, "access" to obj("update" to true, "stock" to true))
                    path.endsWith("/inventory-types") -> obj("types" to JSONArray(listOf(obj("key" to "tool", "label" to "Werkzeug"))))
                    path.endsWith("/custom-fields") -> obj("definitions" to JSONArray())
                    else -> obj()
                }
                return MockResponse().setHeader("Content-Type", "application/json").setBody(value.toString())
            }
        }
        app.credentials.write(session)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        ui.waitUntil(30_000) { ui.onAllNodesWithText("Akku-Bohrschrauber").fetchSemanticsNodes().isNotEmpty() }
    }
    @After fun teardown() {
        if (::scenario.isInitialized) scenario.close()
        ApplicationProvider.getApplicationContext<InventoryApplication>().credentials.clear()
        if (::server.isInitialized) server.shutdown()
    }
    @Test fun stockChangesAreReviewedBeforeSendingAndUseWorkspaceAndKey() {
        screenshot("inventory")
        ui.onNodeWithText("Akku-Bohrschrauber").performClick()
        ui.waitUntil(15_000) { ui.onAllNodesWithText("Bestand & Einheiten").fetchSemanticsNodes().isNotEmpty() }
        screenshot("details")
        ui.onNodeWithText("Bestand & Einheiten").performScrollTo().performClick()
        ui.waitUntil(15_000) { ui.onAllNodesWithText("Bestand buchen").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("Bestand buchen").performClick()
        ui.onNodeWithText("Speichern").performClick()
        ui.onNodeWithText("Bestandsänderung prüfen").assertIsDisplayed()
        screenshot("stock-confirmation")
        assertTrue(writes.none { it.path!!.contains("/stock/movements") })
        ui.onNodeWithText("Bestätigen").performClick()
        ui.waitUntil(15_000) { writes.any { it.path!!.contains("/stock/movements") } }
        val request = writes.first { it.path!!.contains("/stock/movements") }
        assertEquals("test-org", request.getHeader("X-Organization-ID"))
        assertEquals("Bearer test-token", request.getHeader("Authorization"))
        assertNotNull(request.getHeader("Idempotency-Key"))
        assertEquals(1, JSONObject(request.body.clone().readUtf8()).getInt("delta"))
    }
    private fun screenshot(name: String) {
        val context = ApplicationProvider.getApplicationContext<InventoryApplication>()
        val directory = File(context.getExternalFilesDir(null), "screenshots").apply { mkdirs() }
        ui.waitForIdle()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val file = File(directory, "$name.png")
        file.outputStream().use { automation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        // Preserve synthetic QA images after Gradle uninstalls the test app.
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /sdcard/Download/inventory-qa")).use { it.readBytes() }
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("cp ${file.absolutePath} /sdcard/Download/inventory-qa/$name.png")).use { it.readBytes() }
    }
    @Test fun listAndDetailSurviveActivityRecreation() {
        ui.onNodeWithText("Akku-Bohrschrauber").performClick()
        ui.waitUntil(15_000) { ui.onAllNodesWithText("Bearbeiten").fetchSemanticsNodes().isNotEmpty() }
        scenario.recreate()
        ui.waitUntil(15_000) { ui.onAllNodesWithText("Bearbeiten").fetchSemanticsNodes().isNotEmpty() }
        ui.onNodeWithText("Akku-Bohrschrauber").assertExists()
    }
}
