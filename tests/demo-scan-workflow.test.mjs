import assert from "node:assert/strict";
import test from "node:test";
import { scanWorkflowCreateSchema } from "../lib/scan-workflow-contract.ts";
import { matchesActionConditions, resolveActionValue } from "../lib/action-chain-contract.ts";
import { DEMO_SCAN_WORKFLOWS, DEMO_RESOURCES } from "../scripts/demo-seed-manifest.mjs";

test("demo goods receipt uses the actual workflow contract and current stock", () => {
  for (const { id, ...data } of DEMO_SCAN_WORKFLOWS) {
    const workflow = scanWorkflowCreateSchema.parse(data);
    const resource = DEMO_RESOURCES.find(({ id }) => id === workflow.resourceId);
    const context = { identifier: resource.sku, raw: resource.sku, inputs: { menge: 100, verwendung: "lastenrad" }, results: {} };
    const checks = workflow.actions.filter(({ type }) => type === "assert");
    assert.ok(checks.every(({ check }) => matchesActionConditions(check, context)), id);
    assert.ok(checks.some(({ check }) => !matchesActionConditions(check, { ...context, identifier: "WRONG-ARTICLE" })));
    assert.ok(checks.some(({ check }) => !matchesActionConditions(check, { ...context, inputs: { ...context.inputs, menge: -2 } })));
    const adjustment = workflow.actions.find(({ type }) => type === "stock-adjustment");
    assert.equal(resource.quantity + resolveActionValue(adjustment.delta, context) * adjustment.factor, 134);
    assert.equal(workflow.publicTriggerEnabled, false);
    assert.equal(workflow.triggerWebhook, false);
    assert.ok(workflow.inputFields.every(({ storage }) => storage === "execution"));
  }
});
