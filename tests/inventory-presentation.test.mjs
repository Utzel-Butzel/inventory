import assert from "node:assert/strict";
import test from "node:test";
import { inventoryTagSummary } from "../lib/inventory-presentation.ts";

test("tag summaries deduplicate case and spacing without losing or changing source data", () => {
  const tags = [" Metall ", "metall", "", "Werkzeug", "Blau", "Werkstatt", "Ersatzteil"];
  const original = [...tags];
  assert.deepEqual(inventoryTagSummary(tags), {
    visible: ["Metall", "Werkzeug", "Blau"], hidden: ["Werkstatt", "Ersatzteil"],
  });
  assert.deepEqual(tags, original);
  assert.deepEqual(inventoryTagSummary(["Ｍetall", "metall"]), { visible: ["Ｍetall"], hidden: [] });
  assert.deepEqual(inventoryTagSummary([]), { visible: [], hidden: [] });
});
