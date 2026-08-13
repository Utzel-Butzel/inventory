import assert from "node:assert/strict";
import test from "node:test";

import {
  inventoryRecognitionIsConfident,
  inventoryRecognitionObservationSchema,
  shortlistInventoryRecognitionCandidates,
} from "../lib/inventory-recognition-contract.ts";

const observation = inventoryRecognitionObservationSchema.parse({
  label: "hair dryer",
  category: "small appliance",
  brand: "Philips",
  model: "Series 5000",
  color: "black",
  material: "plastic",
  visibleText: ["Philips", "Series 5000"],
  searchTerms: ["hair dryer", "Haartrockner", "Fön", "Philips Series 5000"],
  confidence: 0.96,
});

const candidate = (overrides = {}) => ({
  id: crypto.randomUUID(),
  name: "Unrelated item",
  description: "",
  type: "object",
  sku: null,
  barcode: null,
  serialNumber: null,
  tags: [],
  categories: [],
  customFields: {},
  imageAltTexts: [],
  updatedAt: new Date("2026-08-13T10:00:00Z"),
  ...overrides,
});

test("shortlists bilingual object names and prioritizes exact model evidence", () => {
  const exact = candidate({
    id: "11111111-1111-4111-8111-111111111111",
    name: "Philips Series 5000 Haartrockner",
    description: "Schwarzer Fön für den Materialschrank.",
    sku: "BHD510",
    tags: ["Fön", "Elektrogerät"],
  });
  const generic = candidate({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Reise-Fön",
    description: "Kompakter Haartrockner",
  });
  const unrelated = candidate({
    id: "33333333-3333-4333-8333-333333333333",
    name: "Akkuschrauber",
    tags: ["Werkzeug"],
  });

  const result = shortlistInventoryRecognitionCandidates(observation, [
    unrelated,
    generic,
    exact,
  ]);

  assert.deepEqual(
    result.map((entry) => entry.candidate.id),
    [exact.id, generic.id],
  );
  assert.equal(result[0].score > result[1].score, true);
});

test("does not fill the shortlist with unrelated inventory records", () => {
  const result = shortlistInventoryRecognitionCandidates(observation, [
    candidate({ name: "Werkbank", description: "Großer Holztisch" }),
    candidate({ name: "Kabeltrommel", tags: ["Strom"] }),
  ]);
  assert.deepEqual(result, []);
});

test("requires both a strong best score and a clear lead for auto-confidence", () => {
  assert.equal(inventoryRecognitionIsConfident([{ confidence: 0.91 }]), true);
  assert.equal(
    inventoryRecognitionIsConfident([
      { confidence: 0.91 },
      { confidence: 0.74 },
    ]),
    true,
  );
  assert.equal(
    inventoryRecognitionIsConfident([
      { confidence: 0.91 },
      { confidence: 0.84 },
    ]),
    false,
  );
  assert.equal(inventoryRecognitionIsConfident([{ confidence: 0.7 }]), false);
  assert.equal(
    inventoryRecognitionIsConfident([{ confidence: 0.91 }], {
      observationConfidence: 0.62,
      leadingMatchHasReferenceImage: true,
    }),
    false,
  );
  assert.equal(
    inventoryRecognitionIsConfident([{ confidence: 0.91 }], {
      observationConfidence: 0.95,
      leadingMatchHasReferenceImage: false,
    }),
    false,
  );
});
