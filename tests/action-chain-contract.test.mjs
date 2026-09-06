import assert from "node:assert/strict";
import test from "node:test";
import { chainActionsSchema, actionChainReferenceErrors, matchesActionConditions, resolveActionValue, visibleFlowInputs } from "../lib/action-chain-contract.ts";
import { scanWorkflowCreateSchema } from "../lib/scan-workflow-contract.ts";
import { legacyWorkflowActions } from "../components/stock-workflow/chain-draft.ts";

const literal = (value) => ({ source: "literal", value });
const action = (id) => ({ id, label: id, type: "unit", target: { source: "selected" }, mode: "update" });
const condition = (left, operator, right) => ({ mode: "all", rules: [{ left, operator, ...(right ? { right } : {}) }] });
const context = { identifier: "PCB-123", raw: "https://example.test?id=PCB-123", inputs: { color: "black", amount: 2 }, results: { board: { resourceId: "pcb", metadata: { "board.serial": "123" } } } };
test("values resolve scan, inputs, prior results and dotted property keys without prototype traversal", () => {
  assert.equal(resolveActionValue({ source: "scan", field: "identifier" }, context), "PCB-123");
  assert.equal(resolveActionValue({ source: "input", key: "color" }, context), "black");
  assert.equal(resolveActionValue({ source: "result", actionId: "board", path: "metadata.board.serial" }, context), "123");
  assert.equal(resolveActionValue({ source: "result", actionId: "constructor", path: "name" }, context), undefined);
  assert.equal(resolveActionValue({ source: "input", key: "toString" }, context), undefined);
});
test("conditions preserve types, missing values and all/any semantics", () => {
  assert.equal(matchesActionConditions(condition({ source: "input", key: "amount" }, "gte", literal(2)), context), true);
  assert.equal(matchesActionConditions(condition(literal("2"), "gte", literal(2)), context), false);
  assert.equal(matchesActionConditions(condition(literal(false), "exists"), context), true);
  assert.equal(matchesActionConditions(condition({ source: "input", key: "absent" }, "not-equals", literal("black")), context), false);
  const rules = [condition(literal(1), "equals", literal(1)).rules[0], condition(literal(false), "equals", literal(true)).rules[0]];
  assert.equal(matchesActionConditions({ mode: "any", rules }, context), true);
  assert.equal(matchesActionConditions({ mode: "all", rules }, context), false);
});
test("hidden inputs cannot influence later visibility even when stale values are submitted", () => {
  const fields = [{ key: "color" }, { key: "hidden", visibleWhen: condition({ source: "input", key: "color" }, "equals", literal("white")) }, { key: "dependent", visibleWhen: condition({ source: "input", key: "hidden" }, "exists") }];
  assert.deepEqual(visibleFlowInputs(fields, { ...context, inputs: { color: "black", hidden: "stale" } }).map((field) => field.key), ["color"]);
});
test("references must point backwards and name existing inputs", () => {
  const first = action("first");
  const second = { ...action("second"), target: { source: "result", actionId: "first" } };
  assert.deepEqual(actionChainReferenceErrors([first, second], []), []);
  assert.equal(actionChainReferenceErrors([second, first], []).length, 1);
  assert.equal(actionChainReferenceErrors([{ ...first, code: { source: "input", key: "missing" } }], []).length, 1);
});
test("ambiguous slots, duplicate properties and reserved keys are rejected", () => {
  assert.equal(chainActionsSchema.safeParse([{ ...action("a"), properties: [{ key: "__proto__", storage: "metadata", value: literal(1) }] }]).success, false);
  assert.equal(chainActionsSchema.safeParse([{ ...action("a"), enabled: false }]).success, false);
  assert.equal(chainActionsSchema.safeParse([action("a"), action("a")]).success, false);
  const property = { key: "color", storage: "metadata", value: literal("black") };
  assert.equal(chainActionsSchema.safeParse([{ ...action("a"), properties: [property, property] }]).success, false);
  const build = { id: "b", label: "Build", type: "assembly-build", target: { source: "selected" }, quantity: literal(1), components: [{ slotKey: "pcb", resource: literal("pcb"), unitFromAction: "a" }] };
  assert.equal(chainActionsSchema.safeParse([action("a"), build]).success, false);
});
test("workflow schema forbids visibility depending on later inputs or action results", () => {
  const base = { name: "Frame", resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", extraction: { mode: "full" }, identifierPropertyKey: "serial", actions: [action("a")] };
  for (const left of [{ source: "input", key: "later" }, { source: "result", actionId: "a", path: "found" }]) {
    assert.equal(scanWorkflowCreateSchema.safeParse({ ...base, inputFields: [{ key: "color", label: "Color", type: "text", required: true, visibleWhen: condition(left, "exists") }] }).success, false);
  }
});
test("legacy withdrawal quantity keeps its sign and webhook as separate actions", () => {
  const draft = { operation: { type: "stock-adjustment", delta: -3 }, quantityInputKey: "amount", name: "Withdraw", actions: [], triggerWebhook: true, webhookEventName: "withdrawn" };
  const actions = legacyWorkflowActions(draft);
  assert.equal(actions[0].factor, -1);
  assert.deepEqual(actions[0].delta, { source: "input", key: "amount" });
  assert.equal(actions[1].type, "webhook");
});
