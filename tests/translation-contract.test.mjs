import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCurrentTranslations,
  emptyTranslationDocument,
  normalizeLanguageCode,
  resourceTranslationFields,
  translationFieldState,
  translationPolicyHash,
  translationSourceHash,
  translationWorkPlan,
} from "../lib/translation-contract.ts";

const mediaId = "5cd905ac-b037-4a31-9b64-dcd683d33034";
const resource = {
  name: "Track saw",
  description: "A precise plunge-cut saw.",
  notes: "Return it to the workshop.",
  type: "tool",
  categories: [{ name: "Woodworking" }],
  customFields: {
    care_instructions: "Keep the guide rail dry.",
    hidden_person_note: "Do not send this.",
    voltage: 230,
  },
  media: [
    {
      id: mediaId,
      name: "track-saw.jpg",
      kind: "image",
      altText: "Track saw on its guide rail.",
    },
  ],
  cover: null,
};

const definitions = [
  {
    key: "care_instructions",
    label: "Care instructions",
    description: "How to care for the tool",
    fieldType: "textarea",
    resourceTypes: ["tool"],
    categories: [],
  },
  {
    key: "hidden_person_note",
    label: "Person note",
    description: "Only for people",
    fieldType: "text",
    resourceTypes: ["person"],
    categories: [],
  },
  {
    key: "voltage",
    label: "Voltage",
    description: "Electrical voltage",
    fieldType: "number",
    resourceTypes: [],
    categories: [],
  },
];

const de = {
  code: "de",
  label: "German",
  instructions: "Use formal German.",
};

test("normalizes BCP 47 language codes", () => {
  assert.equal(normalizeLanguageCode("DE"), "de");
  assert.equal(normalizeLanguageCode("pt_br"), "pt-BR");
  assert.throws(() => normalizeLanguageCode("not a language"), /BCP 47/);
});

test("exposes only applicable narrative fields and media alt text", () => {
  assert.deepEqual(resourceTranslationFields(resource, definitions), {
    name: "Track saw",
    description: "A precise plunge-cut saw.",
    notes: "Return it to the workshop.",
    "custom.care_instructions": "Keep the guide rail dry.",
    [`media.${mediaId}.altText`]: "Track saw on its guide rail.",
  });
});

test("selects only missing, stale, or policy-invalid AI fields", () => {
  const fields = resourceTranslationFields(resource, definitions);
  const document = emptyTranslationDocument();
  document.translatedFields.name = "Tauchsäge";
  document.sourceHashes.name = translationSourceHash("name", resource.name);
  document.translatedFields.description = "Eine präzise Säge.";
  document.sourceHashes.description = translationSourceHash(
    "description",
    "Old description",
  );
  document.policyHash = translationPolicyHash(de);

  assert.equal(
    translationFieldState(
      "name",
      resource.name,
      document,
      translationPolicyHash(de),
    ),
    "current",
  );
  assert.equal(
    translationFieldState(
      "description",
      resource.description,
      document,
      translationPolicyHash(de),
    ),
    "stale",
  );
  assert.deepEqual(
    Object.keys(
      translationWorkPlan(fields, document, translationPolicyHash(de))
        .translatedFields,
    ),
    [
      "description",
      "notes",
      "custom.care_instructions",
      `media.${mediaId}.altText`,
    ],
  );

  const changedPolicy = translationPolicyHash({
    ...de,
    instructions: "Use informal German.",
  });
  assert.ok(
    Object.hasOwn(
      translationWorkPlan(fields, document, changedPolicy).translatedFields,
      "name",
    ),
  );
});

test("protects manual fields and requests a suggestion after source edits", () => {
  const fields = resourceTranslationFields(resource, definitions);
  const document = emptyTranslationDocument();
  document.translatedFields.name = "Tauchsäge";
  document.sourceHashes.name = translationSourceHash("name", "Old name");
  document.manualFields = ["name"];
  document.policyHash = translationPolicyHash(de);

  const plan = translationWorkPlan(fields, document, translationPolicyHash(de));
  assert.equal(plan.translatedFields.name, undefined);
  assert.equal(plan.suggestionFields.name, resource.name);

  document.suggestedFields.name = "Handkreissäge mit Führungsschiene";
  document.suggestionSourceHashes.name = translationSourceHash(
    "name",
    resource.name,
  );
  assert.equal(
    translationFieldState(
      "name",
      resource.name,
      document,
      translationPolicyHash(de),
    ),
    "needs_review",
  );
});

test("applies only current translations and falls back per field", () => {
  const document = emptyTranslationDocument();
  document.policyHash = translationPolicyHash(de);
  document.translatedFields = {
    name: "Tauchsäge",
    description: "Veraltet",
    "custom.care_instructions": "Führungsschiene trocken halten.",
    [`media.${mediaId}.altText`]: "Tauchsäge auf der Führungsschiene.",
  };
  document.sourceHashes = {
    name: translationSourceHash("name", resource.name),
    description: translationSourceHash("description", "Old description"),
    "custom.care_instructions": translationSourceHash(
      "custom.care_instructions",
      resource.customFields.care_instructions,
    ),
    [`media.${mediaId}.altText`]: translationSourceHash(
      `media.${mediaId}.altText`,
      resource.media[0].altText,
    ),
  };

  const localized = applyCurrentTranslations(
    resource,
    definitions,
    document,
    translationPolicyHash(de),
  );
  assert.equal(localized.resource.name, "Tauchsäge");
  assert.equal(localized.resource.description, resource.description);
  assert.equal(
    localized.resource.customFields.care_instructions,
    "Führungsschiene trocken halten.",
  );
  assert.equal(
    localized.resource.media[0].altText,
    "Tauchsäge auf der Führungsschiene.",
  );
});
