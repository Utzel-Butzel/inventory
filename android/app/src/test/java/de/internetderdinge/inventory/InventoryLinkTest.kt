package de.internetderdinge.inventory

import de.internetderdinge.inventory.data.*
import org.junit.Assert.*
import org.junit.Test
import java.net.URLEncoder

class InventoryLinkTest {
    private val id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
    @Test fun wrappedLinksPinTheServerAndOrganization() {
        val link = InventoryLink.parse("inventory://open?url=" + URLEncoder.encode("https://inventory.example/team/inventory/$id/stock?unit=$id", "UTF-8"))!!
        assertEquals(id, link.unitId)
        val s = Session("https://inventory.example/", "token", "organization", "user", obj("organization" to obj("slug" to "team")))
        assertTrue(link.matches(s)); assertFalse(link.matches(s.copy(server = "https://other.example/")))
        assertFalse(link.matches(s.copy(capabilities = obj("organization" to obj("slug" to "different")))))
    }
    @Test fun malformedOrAmbiguousExternalLinksAreRejected() {
        listOf("inventory://open?url=inventory://resource/$id", "https://user:secret@inventory.example/inventory/$id", "https://inventory.example/unrelated/$id", "https://inventory.example/inventory/$id?unit=$id&unit=$id", "inventory://resource/$id?server=evil").forEach { assertNull(it, InventoryLink.parse(it)) }
        assertEquals(id, InventoryLink.parse("inventory://resource/$id")!!.resourceId)
        assertEquals(id, InventoryLink.parse("https://inventory.example/inventory/$id")!!.resourceId)
        assertNull(InventoryLink.parse("https://inventory.example/inventory/$id")!!.unitId)
    }
}
