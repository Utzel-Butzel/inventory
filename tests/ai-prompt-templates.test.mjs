import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  aiPromptCollectionSchema,
  aiPromptKinds,
  builtInPrompt,
  defaultAiPromptCollection,
  renderAiPrompt,
  selectAiPrompt,
  AiPromptSelectionError,
} from "../lib/ai-prompt-templates.ts";
import {
  analyzeInputSchema,
  researchInputSchema,
  coverInputSchema,
  inventoryImageInputSchema,
} from "../lib/validators.ts";

test("every built-in is valid, selectable and resettable", () => {
  const collection = defaultAiPromptCollection();
  assert.equal(aiPromptCollectionSchema.safeParse(collection).success, true);
  for (const kind of aiPromptKinds)
    assert.equal(selectAiPrompt(collection, kind), builtInPrompt(kind));
  collection.templates[0].prompt = "Changed";
  assert.notDeepEqual(collection, defaultAiPromptCollection());
  collection.templates[0].prompt = builtInPrompt("analysis");
  assert.deepEqual(collection, defaultAiPromptCollection());
});

test("named templates and per-category defaults select independently", () => {
  const collection = defaultAiPromptCollection();
  const template = {
    id: randomUUID(),
    kind: "cover",
    name: "Studio",
    prompt: "Show {{name}} on white.",
  };
  collection.templates.push(template);
  collection.defaults.cover = template.id;
  assert.equal(aiPromptCollectionSchema.safeParse(collection).success, true);
  assert.equal(selectAiPrompt(collection, "cover"), template.prompt);
  assert.equal(
    selectAiPrompt(collection, "cover", { promptTemplateId: "builtin-cover" }),
    builtInPrompt("cover"),
  );
  assert.equal(
    selectAiPrompt(collection, "cover", { prompt: "  Custom {{name}}  " }),
    "Custom {{name}}",
  );
  assert.equal(
    selectAiPrompt(collection, "analysis"),
    builtInPrompt("analysis"),
  );
});

test("missing and wrong-category templates never silently select another prompt", () => {
  const collection = defaultAiPromptCollection();
  for (const promptTemplateId of [randomUUID(), "builtin-research"]) {
    assert.throws(
      () => selectAiPrompt(collection, "cover", { promptTemplateId }),
      AiPromptSelectionError,
    );
  }
});

test("placeholder expansion is single-pass, preserves replacement characters and blanks missing data", () => {
  assert.equal(
    renderAiPrompt("{{ name }} | {{description}} | {{sku}} | {{name}}", {
      name: "$& {{language}}",
      description: "Line 1\nLine 2",
    }),
    "$& {{language}} | Line 1\nLine 2 |  | $& {{language}}",
  );
  assert.equal(
    renderAiPrompt("{{language}}: {{allowedTypes}}", {
      language: "German",
      allowedTypes: "tool, object",
    }),
    "German: tool, object",
  );
});

test("templates reject unknown placeholders, duplicates, wrong defaults and missing built-ins", () => {
  const invalid = (change) => {
    const c = defaultAiPromptCollection();
    change(c);
    assert.equal(aiPromptCollectionSchema.safeParse(c).success, false);
  };
  invalid((c) => (c.templates[0].prompt = "{{password}}"));
  invalid((c) => (c.templates[0].prompt = " "));
  invalid((c) => (c.templates[0].prompt = "x".repeat(5001)));
  invalid((c) => c.templates.push({ ...c.templates[0], id: randomUUID() }));
  invalid((c) => c.templates.push({ ...c.templates[0], name: "Other" }));
  invalid((c) => (c.defaults.cover = "builtin-analysis"));
  invalid((c) => (c.templates = c.templates.slice(1)));
  assert.throws(
    () =>
      selectAiPrompt(defaultAiPromptCollection(), "analysis", {
        prompt: "{{secrets}}",
      }),
    AiPromptSelectionError,
  );
});

test("template selection is accepted only by AI generation inputs, preserving omitted input", () => {
  for (const schema of [
    analyzeInputSchema,
    researchInputSchema,
    coverInputSchema,
  ]) {
    assert.equal(
      schema.parse({ promptTemplateId: "builtin-cover" }).promptTemplateId,
      "builtin-cover",
    );
    assert.equal(schema.safeParse({ promptTemplateId: "" }).success, false);
  }
  assert.deepEqual(researchInputSchema.parse({}), {});
  assert.deepEqual(analyzeInputSchema.parse({}), { overwrite: true });
  assert.equal(
    inventoryImageInputSchema.safeParse({
      mode: "generate",
      promptTemplateId: "builtin-image",
    }).success,
    true,
  );
  assert.equal(
    inventoryImageInputSchema.safeParse({
      mode: "search",
      promptTemplateId: "builtin-image",
    }).success,
    false,
  );
});
