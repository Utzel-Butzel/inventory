package de.internetderdinge.inventory

import android.app.Application
import de.internetderdinge.inventory.data.*

class InventoryApplication : Application() {
    val credentials by lazy { Credentials(this) }
    val store by lazy { LocalStore(this) }
    val queue by lazy { UploadQueue(this, store) }
    override fun onCreate() {
        super.onCreate()
        runCatching { credentials.read() }.getOrNull()?.let { queue.resume(it) }
    }
}
