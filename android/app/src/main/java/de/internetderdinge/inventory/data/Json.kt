package de.internetderdinge.inventory.data

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

fun obj(vararg fields: Pair<String, Any?>) = JSONObject().apply { fields.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }
fun JSONObject.s(key: String, default: String = ""): String = if (isNull(key)) default else optString(key, default)
fun JSONObject.o(key: String) = optJSONObject(key) ?: JSONObject()
fun JSONObject.a(key: String) = optJSONArray(key) ?: JSONArray()
fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray.strings() = (0 until length()).map { optString(it) }
fun JSONObject.copy() = JSONObject(toString())
fun canonical(value: Any?): String = when (value) {
    is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { "${JSONObject.quote(it)}:${canonical(value.opt(it))}" }
    is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.opt(it)) }
    null, JSONObject.NULL -> "null"
    is String -> JSONObject.quote(value)
    else -> value.toString()
}
fun uuid() = UUID.randomUUID().toString()
fun String.sha256() = MessageDigest.getInstance("SHA-256").digest(toByteArray()).joinToString("") { "%02x".format(it) }

data class Session(val server: String, val token: String, val organization: String, val principal: String, val capabilities: JSONObject) {
    val context: String get() = "$server#$organization#$principal".sha256()
    fun allows(permission: String, legacy: String = "read"): Boolean {
        if (capabilities.o("organization").optBoolean("isReadOnly") && legacy != "read") return false
        return if (capabilities.has("permissions") && !capabilities.isNull("permissions")) permission in capabilities.a("permissions").strings()
        else legacy in capabilities.a("scopes").strings()
    }
    fun json() = obj("server" to server, "token" to token, "organization" to organization, "principal" to principal, "capabilities" to capabilities)
    companion object { fun from(j: JSONObject) = Session(j.getString("server"), j.getString("token"), j.s("organization"), j.getString("principal"), j.o("capabilities")) }
}
