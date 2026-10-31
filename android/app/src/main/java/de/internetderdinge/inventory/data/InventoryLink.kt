package de.internetderdinge.inventory.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URI
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.util.Base64
import java.util.UUID

data class InventoryLink(val resourceId: String, val unitId: String? = null, val server: String? = null, val organization: String? = null) {
    fun matches(session: Session): Boolean = (server == null || Api.sameOrigin(server.toHttpUrlOrNull()!!, session.server.toHttpUrlOrNull()!!)) &&
        (organization == null || organization == session.organization || organization == session.capabilities.o("organization").s("slug"))
    companion object {
        private val idPattern = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
        private fun id(value: String): String? = value.takeIf { idPattern.matches(it) }?.lowercase()
        private fun short(value: String): String? = runCatching {
            require(value.matches(Regex("[A-Za-z0-9_-]{22}")))
            val bytes = Base64.getUrlDecoder().decode(value)
            require(bytes.size == 16 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value)
            val b = ByteBuffer.wrap(bytes); id(UUID(b.long, b.long).toString())
        }.getOrNull()
        fun parse(raw: String): InventoryLink? = runCatching {
            require(raw.length <= 4096)
            val uri = URI(raw); require(uri.userInfo == null)
            if (uri.scheme == "inventory") {
                if (uri.host == "open") {
                    val params = uri.rawQuery.orEmpty().split('&').map { it.split('=', limit = 2) }.filter { it[0] == "url" }
                    require(params.size == 1 && params[0].size == 2)
                    val nested = URLDecoder.decode(params[0][1], "UTF-8")
                    require(nested.startsWith("https://") || nested.startsWith("http://"))
                    return parse(nested)
                }
                require(uri.query == null)
                val value = when { uri.host == "resource" -> uri.path.trim('/'); uri.isOpaque -> uri.schemeSpecificPart; else -> "" }
                return InventoryLink(id(value) ?: return null)
            }
            val url = raw.toHttpUrlOrNull() ?: return null
            require(url.username.isEmpty() && url.password.isEmpty())
            val parts = url.pathSegments.toMutableList()
            var org: String? = null
            if (parts.size >= 3 && parts[1] == "inventory") { org = parts.removeAt(0).lowercase(); require(org.matches(Regex("[a-z0-9]+(?:-[a-z0-9]+)*"))) }
            require(parts.size == 2 || (parts.size == 3 && parts[2] == "stock" && parts[0] == "inventory"))
            val resource = when (parts[0]) { "inventory" -> id(parts[1]); "r" -> short(parts[1]); else -> null } ?: return null
            val units = url.queryParameterValues("unit"); require(units.size <= 1)
            val unit = if (units.isEmpty()) null else (if (parts[0] == "r") short(units[0].orEmpty()) else id(units[0].orEmpty())) ?: return null
            InventoryLink(resource, unit, url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString(), org)
        }.getOrNull()
    }
}
