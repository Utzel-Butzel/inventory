package de.internetderdinge.inventory.data

import org.json.JSONArray
import org.json.JSONObject

object FlowRules {
    fun visible(fields: List<JSONObject>, identifier: String, raw: String, inputs: JSONObject): List<JSONObject> {
        val visibleInputs = obj()
        return fields.filter { field ->
            val show = field.isNull("visibleWhen") || matches(field.o("visibleWhen"), identifier, raw, visibleInputs)
            if (show && inputs.has(field.s("key"))) visibleInputs.put(field.s("key"), inputs.opt(field.s("key")))
            show
        }
    }
    private fun resolve(value: JSONObject, identifier: String, raw: String, inputs: JSONObject): Any? = when (value.s("source")) {
        "literal" -> value.opt("value") ?: JSONObject.NULL
        "scan" -> if (value.s("field") == "raw") raw else identifier
        "input" -> inputs.opt(value.s("key"))
        else -> null
    }
    fun matches(conditions: JSONObject, identifier: String, raw: String, inputs: JSONObject): Boolean {
        val results = conditions.a("rules").objects().map { rule ->
            val l = resolve(rule.o("left"), identifier, raw, inputs); val r = resolve(rule.o("right"), identifier, raw, inputs)
            val present = l != null && l != JSONObject.NULL && l != ""
            val equal = if (l is JSONArray || l is JSONObject) l === r else if (l is Number && r is Number) l.toDouble() == r.toDouble() else l == r
            when (rule.s("operator")) {
                "exists" -> present; "missing" -> !present
                "equals" -> l != null && r != null && equal
                "not-equals" -> l != null && r != null && !equal
                "gt", "gte", "lt", "lte" -> if (l is Number && r is Number) when (rule.s("operator")) { "gt" -> l.toDouble() > r.toDouble(); "gte" -> l.toDouble() >= r.toDouble(); "lt" -> l.toDouble() < r.toDouble(); else -> l.toDouble() <= r.toDouble() } else false
                else -> false
            }
        }
        return when (conditions.s("mode")) { "all" -> results.all { it }; "any" -> results.any { it }; else -> false }
    }
    fun inputs(fields: List<JSONObject>, values: JSONObject): JSONObject = obj().apply {
        fields.forEach { f ->
            val key = f.s("key"); val value = values.opt(key)
            val missing = value == null || value == JSONObject.NULL || value == "" || (value is JSONArray && value.length() == 0)
            require(!f.optBoolean("required") || !missing) { "${f.s("label")} fehlt." }
            if (!missing) {
                if (f.s("type") in listOf("select", "radio")) require(f.a("options").objects().any { it.s("value") == value }) { "${f.s("label")}: ungültige Auswahl." }
                put(key, value)
            }
        }
    }
}
