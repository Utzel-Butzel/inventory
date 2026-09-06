import assert from "node:assert/strict";
import test from "node:test";

import {
  draftToPayload,
  extractionFromDraft,
  extractionToDraft,
  payloadSignature,
  templateDraft,
  updateDraftExtraction,
  workflowToDraft,
} from "../components/stock-workflow/draft.ts";
import {
  extractIdentifier,
  validateDraft,
  workflowTargetIssues,
} from "../components/stock-workflow/validation.ts";
import {
  stockItemsFromResponse,
  stockUnitCustomFieldsFromResponse,
  workflowFromResponse,
  workflowsFromResponse,
} from "../components/stock-workflow/responses.ts";
import { workflowVariantOptions } from "../components/stock-workflow/variant-options.ts";

const t = (key) => key;
const resourceId = "4b277830-d4f3-42b6-9d13-f70801f32e76";
const makeDraft = () => templateDraft(t, resourceId);

test("scan variant selection persists independently of metadata input fields", () => {
  const draft = makeDraft();
  draft.allowVariantSelection = true;
  draft.inputFields = [];
  const payload = draftToPayload(draft);
  assert.equal(payload.allowVariantSelection, true);
  assert.deepEqual(payload.inputFields, []);
  const saved = { ...payload, id: "workflow-id", publicTriggerId: "public-id", revision: 1 };
  assert.equal(workflowToDraft(saved).allowVariantSelection, true);
  const disabled = { ...draft, allowVariantSelection: false };
  assert.notEqual(payloadSignature(disabled), payloadSignature(draft));
});

test("variant preview uses only direct product variants and matches runtime fallback", () => {
  const draft = { ...makeDraft(), allowVariantSelection: true };
  const primary = { resourceId, name: "OpenPaper 7", trackingMode: "serialized" };
  const black = { ...primary, resourceId: "black", name: "Black", variantOfResourceId: resourceId };
  const white = { ...black, resourceId: "white", name: "White" };
  const unrelated = { ...black, resourceId: "other", variantOfResourceId: "other-primary" };
  const resources = [white, primary, unrelated, black];
  const before = structuredClone(resources);
  assert.deepEqual(workflowVariantOptions(draft, primary, resources), [black, white]);
  assert.deepEqual(workflowVariantOptions({ allowVariantSelection: false }, primary, resources), [primary]);
  assert.deepEqual(workflowVariantOptions(draft, primary, [primary, unrelated]), [primary]);
  assert.deepEqual(workflowVariantOptions(draft, primary, [primary, black]), [black]);
  assert.deepEqual(resources, before);
});

test("assembly fields require serialized output and accept corrected stock settings", () => {
  const draft = makeDraft();
  const before = structuredClone(draft);
  const target = { resourceId, name: "OpenPaper 7", trackingMode: "bulk" };
  assert.equal(workflowTargetIssues(draft, [target])[0].messageKey, "workflows.validation.serializedTarget");
  assert.deepEqual(workflowTargetIssues(draft, [{ ...target, trackingMode: "serialized" }]), []);
  assert.deepEqual(draft, before);
  assert.deepEqual(workflowTargetIssues(draft, [{ ...target, resourceId: "unselected" }]), []);
});

test("execution-only bulk builds remain supported, but unit actions always require serialization", () => {
  const draft = makeDraft();
  const target = { resourceId, name: "OpenPaper 7", trackingMode: "bulk" };
  draft.identifierStorage = "execution";
  draft.fixedProperties.forEach((field) => { field.storage = "execution"; });
  draft.inputFields.forEach((field) => { field.storage = "execution"; });
  assert.deepEqual(workflowTargetIssues(draft, [target]), []);
  draft.operation = { type: "unit" };
  assert.equal(workflowTargetIssues(draft, [target])[0].messageKey, "workflows.validation.serializedTarget");
});

test("quantity adjustments reject unit storage and serialized stock", () => {
  const draft = makeDraft();
  draft.operation = { type: "stock-adjustment", delta: 1 };
  const target = { resourceId, name: "OpenPaper 7", trackingMode: "bulk" };
  assert.equal(workflowTargetIssues(draft, [target])[0].messageKey, "workflows.validation.executionStorage");
  assert.equal(workflowTargetIssues(draft, [{ ...target, trackingMode: "serialized" }])[0].messageKey, "workflows.validation.bulkTarget");
});

test("saved workflows round trip without persisting editor-only identifiers", () => {
  const draft = makeDraft();
  draft.name = "  Assembly  ";
  draft.description = "  Description  ";
  draft.publicTriggerCode = "  ";
  const payload = draftToPayload(draft);
  assert.equal(payload.name, "Assembly");
  assert.equal(payload.description, "Description");
  assert.equal(payload.publicTriggerCode, null);
  assert.ok(!JSON.stringify(payload).includes('"uid"'));
  const saved = { ...payload, id: "workflow-id", publicTriggerId: "public-id", revision: 7 };
  assert.deepEqual(draftToPayload(workflowToDraft(saved)), { ...payload, revision: 7 });
  assert.equal(workflowToDraft(saved).publicTriggerId, "public-id");
});

test("all extraction modes retain their settings through the editor", () => {
  for (const extraction of [
    { mode: "full" },
    { mode: "prefix", prefix: "EPD-" },
    { mode: "regex", pattern: "ID:(?<value>[0-9]+)", flags: "i", group: "value" },
    { mode: "url-query", parameter: "id" },
    { mode: "url-query", parameter: "id", sourceOrigin: "https://example.com", sourcePath: "/items" },
  ]) {
    assert.deepEqual(extractionFromDraft(extractionToDraft(extraction)), extraction);
  }
});

test("changing an extraction updates only the requested field without mutation", () => {
  const draft = makeDraft();
  draft.extractedFields = ["first", "second"].map((uid) => ({
    uid, key: uid, label: uid, storage: "execution", extraction: { ...draft.extraction },
  }));
  const before = structuredClone(draft);
  const next = updateDraftExtraction(draft, { mode: "regex", pattern: "(?<value>.+)" }, "second");
  assert.deepEqual(draft, before);
  assert.equal(next.extraction, draft.extraction);
  assert.equal(next.extractedFields[0], draft.extractedFields[0]);
  assert.equal(next.extractedFields[1].extraction.mode, "regex");
  assert.equal(next.extractedFields[1].extraction.parameter, draft.extraction.parameter);
  const primary = updateDraftExtraction(draft, { parameter: "serial" });
  assert.equal(primary.extraction.parameter, "serial");
  assert.equal(primary.extractedFields, draft.extractedFields);
});

test("dirty detection ignores local row ids but tracks saved field values", () => {
  const draft = makeDraft();
  const renamedIds = structuredClone(draft);
  renamedIds.fixedProperties[0].uid = "new-fixed-id";
  renamedIds.inputFields[0].uid = "new-input-id";
  renamedIds.inputFields[0].options[0].uid = "new-option-id";
  assert.equal(payloadSignature(draft), payloadSignature(renamedIds));
  renamedIds.inputFields[0].options[0].value = "changed-value";
  assert.notEqual(payloadSignature(draft), payloadSignature(renamedIds));
});

test("validation rejects duplicate property keys and invalid quantity sources", () => {
  const draft = makeDraft();
  assert.equal(validateDraft(draft, t), null);
  draft.fixedProperties[0].key = draft.identifierPropertyKey;
  assert.equal(validateDraft(draft, t), "workflows.validation.uniqueKeys");
  const quantityDraft = makeDraft();
  quantityDraft.quantityInputKey = quantityDraft.inputFields[0].key;
  assert.equal(validateDraft(quantityDraft, t), "workflows.validation.quantityInput");
  quantityDraft.inputFields[0].type = "number";
  assert.equal(validateDraft(quantityDraft, t), null);
  quantityDraft.inputFields[0].required = false;
  assert.equal(validateDraft(quantityDraft, t), "workflows.validation.quantityInput");
});

test("preview extraction checks origins, paths, and ambiguous query values", () => {
  const extraction = makeDraft().extraction;
  assert.deepEqual(extractIdentifier("https://paperlesspaper.de/b?d=123", extraction, t), { value: "123", error: null });
  for (const [input, error] of [
    ["https://other.example/b?d=123", "originMismatch"],
    ["https://paperlesspaper.de/other?d=123", "pathMismatch"],
    ["https://paperlesspaper.de/b?d=123&d=456", "queryCount"],
    ["https://paperlesspaper.de/b?d=", "queryEmpty"],
  ]) {
    assert.equal(extractIdentifier(input, extraction, t).error, `workflows.extractionErrors.${error}`);
  }
});

test("API response readers preserve supported envelopes and filter invalid rows", () => {
  const workflow = { id: "workflow-id" };
  for (const payload of [[workflow], { workflows: [workflow] }, { items: [workflow] }, { data: [workflow] }]) {
    assert.deepEqual(workflowsFromResponse(payload), [workflow]);
  }
  for (const payload of [workflow, { workflow }, { data: workflow }]) {
    assert.equal(workflowFromResponse(payload), workflow);
  }
  assert.deepEqual(workflowsFromResponse(null), []);
  assert.equal(workflowFromResponse({ id: 123 }), null);
  const stock = { resourceId, name: "Frame", trackingMode: "serialized" };
  assert.deepEqual(stockItemsFromResponse({ items: [stock, null, { name: "incomplete" }] }), [stock]);
  const field = { key: "serial", label: "Serial", fieldType: "text" };
  assert.deepEqual(stockUnitCustomFieldsFromResponse({ definitions: [null, field, { key: "missing" }] }), [field]);
});
