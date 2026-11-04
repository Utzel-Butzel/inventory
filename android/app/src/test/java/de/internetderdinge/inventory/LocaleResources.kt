package de.internetderdinge.inventory

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.json.JSONArray

/** Real source resources for JVM tests, which do not run an Android Application. */
fun localeResources(language: String = "en"): Map<Int, String> {
    val folder = if (language == "de") "values-de" else "values"
    val document = DocumentBuilderFactory.newInstance().newDocumentBuilder()
        .parse(File("src/main/res/$folder/strings.xml"))
    val nodes = document.getElementsByTagName("string")
    val ids = R.string::class.java.fields.associate { it.name to it.getInt(null) }
    return (0 until nodes.length).associate { index ->
        val node = nodes.item(index)
        val key = node.attributes.getNamedItem("name").nodeValue
        ids.getValue(key) to JSONArray("[${node.textContent.replace("\\'", "'")}]").getString(0)
    }
}

fun installLocaleResources(language: String = "en") {
    val strings = localeResources(language)
    L10n.stringResource = { strings.getValue(it) }
}
