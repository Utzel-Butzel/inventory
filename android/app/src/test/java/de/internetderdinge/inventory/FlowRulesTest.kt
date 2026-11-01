package de.internetderdinge.inventory

import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class FlowRulesTest {
    private fun condition(key: String, expected: Any) = obj("mode" to "all", "rules" to JSONArray(listOf(obj("left" to obj("source" to "input", "key" to key), "operator" to "equals", "right" to obj("source" to "literal", "value" to expected)))))
    @Test fun hiddenAnswersCannotMakeLaterFieldsVisibleOrLeakToExecution() {
        val fields = listOf(obj("key" to "choice"), obj("key" to "hidden", "visibleWhen" to condition("choice", "yes")), obj("key" to "dependent", "visibleWhen" to condition("hidden", "secret")))
        val answers = obj("choice" to "no", "hidden" to "secret", "dependent" to "must-not-send")
        val visible = FlowRules.visible(fields, "id", "raw", answers)
        assertEquals(listOf("choice"), visible.map { it.s("key") })
        val payload = FlowRules.inputs(visible, answers)
        assertFalse(payload.has("hidden")); assertFalse(payload.has("dependent"))
    }
    @Test fun unknownActionResultsDoNotSatisfyConditions() {
        val rules = obj("mode" to "all", "rules" to JSONArray(listOf(obj("left" to obj("source" to "action", "actionId" to "create"), "operator" to "equals", "right" to obj("source" to "action", "actionId" to "create")))))
        assertFalse(FlowRules.matches(rules, "id", "raw", obj()))
    }
    @Test fun comparisonsAreTypedAndRequiredChoicesAreValidated() {
        assertTrue(FlowRules.matches(condition("value", 1.0), "id", "raw", obj("value" to 1)))
        assertFalse(FlowRules.matches(condition("value", "1"), "id", "raw", obj("value" to 1)))
        val fields = listOf(obj("key" to "color", "label" to "Farbe", "type" to "radio", "required" to true, "options" to JSONArray(listOf(obj("value" to "red")))))
        assertTrue(runCatching { FlowRules.inputs(fields, obj()) }.isFailure)
        assertTrue(runCatching { FlowRules.inputs(fields, obj("color" to "unknown")) }.isFailure)
        assertEquals("red", FlowRules.inputs(fields, obj("color" to "red")).s("color"))
    }
    @Test fun collectionEqualityMatchesServerIdentitySemantics() {
        val values = obj("a" to JSONArray(listOf("x")), "b" to JSONArray(listOf("x")))
        val left = obj("source" to "input", "key" to "a")
        fun compare(right: String) = obj("mode" to "all", "rules" to JSONArray(listOf(obj("left" to left, "operator" to "equals", "right" to obj("source" to "input", "key" to right)))))
        assertTrue(FlowRules.matches(compare("a"), "id", "raw", values)); assertFalse(FlowRules.matches(compare("b"), "id", "raw", values))
    }
}
