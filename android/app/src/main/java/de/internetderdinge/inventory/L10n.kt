package de.internetderdinge.inventory

import android.content.Context
import androidx.annotation.StringRes

/** Native resources follow the system's per-app language, including in background jobs. */
object L10n {
    private lateinit var context: Context
    internal var stringResource: (Int) -> String = { context.getString(it) }

    fun initialize(context: Context) {
        this.context = context.applicationContext
    }

    fun text(@StringRes key: Int, vararg arguments: Any?): String =
        render(stringResource(key), *arguments)

    // Replace in one pass: a value containing {1} is content, not another placeholder.
    internal fun render(template: String, vararg arguments: Any?): String =
        Regex("\\{([0-9]+)\\}").replace(template) { match ->
            val index = match.groupValues[1].toIntOrNull()
            if (index != null && index in arguments.indices) arguments[index].toString() else match.value
        }

    val language: String
        get() {
            val locales = context.resources.configuration.locales
            return resolveLanguage((0 until locales.size()).map { locales[it].toLanguageTag() })
        }

    internal fun resolveLanguage(preferences: List<String>): String = preferences
        .map { it.substringBefore('-').lowercase(java.util.Locale.ROOT) }
        .firstOrNull { it == "en" || it == "de" } ?: "en"
}
