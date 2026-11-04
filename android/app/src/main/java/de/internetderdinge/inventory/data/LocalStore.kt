package de.internetderdinge.inventory.data

import de.internetderdinge.inventory.L10n
import de.internetderdinge.inventory.R

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Credentials never enter backups, logs, WorkManager data, or ordinary preferences. */
class Credentials(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "session.aes"))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("inventory-session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("inventory-session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(): Session? = synchronized(lock) { readVault().active?.takeUnless { it.expired } }
    fun readVault(): AccountVault = synchronized(lock) {
        if (!file.baseFile.exists()) return AccountVault()
        val j = JSONObject(String(file.readFully(), Charsets.UTF_8))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(j.getString("iv"), Base64.NO_WRAP)))
        val plaintext = JSONObject(String(cipher.doFinal(Base64.decode(j.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8))
        AccountVault.from(plaintext).also { if (!plaintext.has("version")) writeVault(it) }
    }
    fun write(session: Session): Session = synchronized(lock) {
        val vault = readVault().withSession(session)
        writeVault(vault)
        vault.active!!
    }
    fun removeAccount(id: String) = synchronized(lock) { writeVault(readVault().without(id)) }
    fun savePending(pending: BrowserSignIn?) = synchronized(lock) { writeVault(readVault().copy(pending = pending)) }
    private fun writeVault(vault: AccountVault) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(vault.json().toString().toByteArray(Charsets.UTF_8))
        val j = obj("iv" to Base64.encodeToString(cipher.iv, Base64.NO_WRAP), "data" to Base64.encodeToString(encrypted, Base64.NO_WRAP))
        val stream = file.startWrite()
        try { stream.write(j.toString().toByteArray(Charsets.UTF_8)); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
    fun clear() = synchronized(lock) { file.delete() }
    companion object { private val lock = Any() }
}

class LocalStore(context: Context) : SQLiteOpenHelper(context, "inventory-jobs.db", null, 1) {
    val files = File(context.noBackupFilesDir, "uploads").apply { mkdirs() }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, context TEXT NOT NULL, payload TEXT NOT NULL)")
        db.execSQL("CREATE TABLE operations (fingerprint TEXT PRIMARY KEY, context TEXT NOT NULL, payload TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    @Synchronized fun saveJob(job: JSONObject) {
        writableDatabase.insertWithOnConflict("jobs", null, ContentValues().apply {
            put("id", job.getString("id")); put("context", job.getString("context")); put("payload", job.toString())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun jobs(context: String): List<JSONObject> = readableDatabase.query("jobs", arrayOf("payload"), "context=?", arrayOf(context), null, null, "rowid DESC").use {
        buildList { while (it.moveToNext()) add(JSONObject(it.getString(0))) }
    }
    fun job(id: String): JSONObject? = readableDatabase.query("jobs", arrayOf("payload"), "id=?", arrayOf(id), null, null, null).use { if (it.moveToFirst()) JSONObject(it.getString(0)) else null }
    @Synchronized fun removeJob(id: String) {
        require(job(id)?.s("status") in listOf("done", "error", "paused")) { L10n.text(R.string.ui_wait_for_the_running_upload_to_finish_ca3258dd) }
        writableDatabase.delete("jobs", "id=?", arrayOf(id)); File(files, id).deleteRecursively()
    }
    @Synchronized fun operation(context: String, path: String, method: String, body: JSONObject): JSONObject {
        // The complete request is retained before sending. Uncertain retries cannot
        // accidentally receive a fresh idempotency key after process death.
        val fingerprint = "$context#$method#$path#${canonical(body)}".sha256()
        readableDatabase.query("operations", arrayOf("payload"), "fingerprint=?", arrayOf(fingerprint), null, null, null).use {
            if (it.moveToFirst()) return JSONObject(it.getString(0))
        }
        require(operations(context).none { it.s("path") == path && it.s("method") == method }) {
            L10n.text(R.string.ui_a_server_response_is_still_missing_for_95a8661e)
        }
        val operation = obj("fingerprint" to fingerprint, "context" to context, "path" to path, "method" to method, "body" to body, "key" to uuid())
        writableDatabase.insertOrThrow("operations", null, ContentValues().apply { put("fingerprint", fingerprint); put("context", context); put("payload", operation.toString()) })
        return operation
    }
    fun operations(context: String): List<JSONObject> = readableDatabase.query("operations", arrayOf("payload"), "context=?", arrayOf(context), null, null, null).use {
        buildList { while (it.moveToNext()) add(JSONObject(it.getString(0))) }
    }
    fun complete(operation: JSONObject) { writableDatabase.delete("operations", "fingerprint=?", arrayOf(operation.getString("fingerprint"))) }
}
