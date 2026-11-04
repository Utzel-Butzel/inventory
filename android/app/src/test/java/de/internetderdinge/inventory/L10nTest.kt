package de.internetderdinge.inventory

import org.junit.Assert.*
import org.junit.Test

class L10nTest {
    @Test fun preferredLanguagesUseEnglishAsTheFallback() {
        assertEquals("de", L10n.resolveLanguage(listOf("de-DE")))
        assertEquals("de", L10n.resolveLanguage(listOf("de-AT", "en-US")))
        assertEquals("en", L10n.resolveLanguage(listOf("en-GB", "de-DE")))
        assertEquals("en", L10n.resolveLanguage(listOf("fr-FR", "en-US", "de-DE")))
        assertEquals("de", L10n.resolveLanguage(listOf("fr-FR", "de-CH", "en-US")))
        assertEquals("en", L10n.resolveLanguage(listOf("fr-FR", "es-ES")))
        assertEquals("en", L10n.resolveLanguage(emptyList()))
    }
    @Test fun bothLanguagesHaveTheSameNonemptyResources() {
        val english = localeResources("en")
        val german = localeResources("de")
        assertEquals(english.keys, german.keys)
        assertTrue(english.values.all { it.isNotBlank() })
        assertTrue(german.values.all { it.isNotBlank() })
        val login = R.string::class.java.fields.single { it.name == "ui_sign_in_a329a322" }.getInt(null)
        assertEquals("Sign in", english[login])
        assertEquals("Anmelden", german[login])
    }

    @Test fun interpolationPreservesUserContentAndSupportsReordering() {
        assertEquals("12 / Part {1}", L10n.render("{1} / {0}", "Part {1}", 12))
        assertEquals("50% · $5", L10n.render("{0} · {1}", "50%", "$5"))
        assertEquals("{3}", L10n.render("{3}", "one"))
        assertEquals("null", L10n.render("{0}", null))
    }

    @Test fun serverStatusAndMovementCodesHaveLocalizedDisplayNames() {
        installLocaleResources("de")
        assertEquals("Reservierung", de.internetderdinge.inventory.ui.label("reservation"))
        assertEquals("Wareneingang", de.internetderdinge.inventory.ui.label("receipt"))
        installLocaleResources("en")
        assertEquals("Reservation", de.internetderdinge.inventory.ui.label("reservation"))
        assertEquals("Goods receipt", de.internetderdinge.inventory.ui.label("receipt"))
        assertEquals("custom-status", de.internetderdinge.inventory.ui.label("custom-status"))
    }
}
